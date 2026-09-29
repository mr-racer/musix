"""The v2 HTTP API. Phase 0: liveness and readiness only."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from qdrant_client import AsyncQdrantClient

from musix import __version__
from musix.infra import db
from musix.settings import Settings

Check = Callable[[], Awaitable[None]]


class Health(BaseModel):
    status: str
    version: str


class Ready(BaseModel):
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
    return JSONResponse(body.model_dump(), status_code=200 if ok else 503)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = db.make_engine(settings)
        qdrant = AsyncQdrantClient(url=settings.qdrant_url, timeout=5)

        async def postgres() -> None:
            await db.ping(engine)

        async def qdrant_check() -> None:
            await qdrant.get_collections()

        app.state.checks = {"postgres": postgres, "qdrant": qdrant_check}
        yield
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
    app.include_router(router)
    return app
