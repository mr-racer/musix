"""The v2 HTTP API: system routes + every context's router under /api/v2."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import sqlalchemy as sa
from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix import __version__, errors, observability
from musix.api.idempotency import IdempotencyMiddleware
from musix.api.realtime import Hub
from musix.infra import db, secrets, vectors
from musix.infra.ml_client import MlClient
from musix.infra.queue import make_queue_app
from musix.schemas import Model
from musix.settings import Settings

Check = Callable[[], Awaitable[None]]


class Health(Model):
    status: str
    version: str


class Ready(Model):
    status: str
    checks: dict[str, str]


router = APIRouter(prefix="/api/v2", tags=["system"])


@router.get("/health", response_model=Health)
async def health() -> Health:
    """Liveness: the process answers. Never touches a dependency."""
    return Health(status="ok", version=__version__)


@router.get("/ready", response_model=Ready, responses={503: {"model": Ready}})
async def ready(request: Request) -> JSONResponse:
    """Readiness: every dependency answers. 503 names the ones that do not."""
    checks: dict[str, Check] = request.app.state.checks
    results: dict[str, str] = {}
    for name, check in checks.items():
        try:
            await check()
            results[name] = "ok"
        except Exception as e:
            results[name] = f"error: {type(e).__name__}"
    ok = all(v == "ok" for v in results.values())
    body = Ready(status="ok" if ok else "degraded", checks=results)
    return JSONResponse(body.model_dump(by_alias=True), status_code=200 if ok else 503)


async def _queue_depth_loop(sessionmaker: async_sessionmaker[AsyncSession]) -> None:
    while True:
        with contextlib.suppress(Exception):
            async with sessionmaker() as s:
                rows = await s.execute(
                    sa.text(
                        "select queue_name, status, count(*) from procrastinate_jobs group by 1, 2"
                    )
                )
                for q, st, n in rows:
                    observability.QUEUE_DEPTH.labels(q, st).set(n)
        await asyncio.sleep(5)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = db.make_engine(settings)
        app.state.engine = engine
        app.state.sessionmaker = db.make_sessionmaker(engine)
        app.state.settings = settings
        app.state.secrets = secrets.load_or_create(settings.secrets_dir)
        qdrant = vectors.client(settings.qdrant_url)
        app.state.qdrant = qdrant

        async def postgres() -> None:
            await db.ping(engine)

        async def qdrant_check() -> None:
            await qdrant.get_collections()

        app.state.checks = {"postgres": postgres, "qdrant": qdrant_check}
        depth = asyncio.create_task(_queue_depth_loop(app.state.sessionmaker))
        app.state.queue = make_queue_app(settings)
        await app.state.queue.open_async()
        app.state.hub = Hub(settings.procrastinate_conninfo)
        app.state.hub.start()
        app.state.ml = MlClient(settings.ml_url, read_timeout=60.0)
        yield
        await app.state.ml.close()
        await app.state.hub.stop()
        await app.state.queue.close_async()
        depth.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await depth  # let it release its pooled connection before the engine is disposed
        await qdrant.close()
        await engine.dispose()

    app = FastAPI(
        title="MusiX",
        version=__version__,
        lifespan=lifespan,
        openapi_url="/api/v2/openapi.json",
        docs_url=None,
        redoc_url=None,
    )
    errors.install(app)
    app.add_middleware(IdempotencyMiddleware)
    observability.install(app, settings)
    app.include_router(router)
    for r in context_routers():
        app.include_router(r, prefix="/api/v2")
    app.openapi = lambda: errors.document(app)  # type: ignore[method-assign]
    return app


def context_routers() -> list[APIRouter]:
    """Every bounded context's router. Explicit list (no import side effects)."""
    from musix.api.realtime import router as realtime
    from musix.contexts.assistant.router import router as assistant
    from musix.contexts.identity.router import router as identity
    from musix.contexts.knowledge.router import router as knowledge
    from musix.contexts.library.router import router as library
    from musix.contexts.listening.router import router as listening
    from musix.contexts.media.router import router as media
    from musix.contexts.models_public.router import router as models_public
    from musix.contexts.playlists.router import router as playlists
    from musix.contexts.screens.router import router as screens
    from musix.contexts.search.router import router as search
    from musix.contexts.stream.router import router as stream
    from musix.contexts.sync.router import router as sync

    return [
        identity,
        library,
        media,
        listening,
        playlists,
        screens,
        knowledge,
        assistant,
        search,
        stream,
        sync,
        realtime,
        models_public,
    ]
