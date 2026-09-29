"""The `ml` service skeleton. Models arrive in phase 2 (torch is an optional
dependency group then); phase 0 only reports which device it is configured for,
so the dev stack runs on a laptop without a GPU."""

from __future__ import annotations

from fastapi import FastAPI

from musix import __version__
from musix.settings import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="MusiX ml", version=__version__, openapi_url=None)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "device": settings.ml_device}

    return app


app = create_app()
