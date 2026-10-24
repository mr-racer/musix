"""The `ml-sound` service's HTTP surface (spec §6.2). Internal: only the server's
`sound:batch` task calls it. One batch at a time; results show up per item as soon as its
CPU analysis ends, so a recreated worker re-attaches by id and loses nothing."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from musix_sound import guard
from musix_sound.batch import Batch, BatchItem, Runner

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
MEDIA_ROOTS = [
    Path(p)
    for p in os.environ.get("ML_MEDIA_ROOTS", "/mnt/data/music:/mnt/data/musix-v2-media").split(":")
]
MAX_ITEMS = 32


class ItemIn(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[0-9a-f-]+$")
    path: str
    lrc: str | None = None
    keep_stems: bool = False
    export_name: str | None = Field(default=None, max_length=200)


class BatchIn(BaseModel):
    items: list[ItemIn] = Field(min_length=1, max_length=MAX_ITEMS)


def _check_path(raw: str) -> str:
    p = Path(raw)
    if not p.is_absolute() or ".." in p.parts or not any(p.is_relative_to(r) for r in MEDIA_ROOTS):
        raise HTTPException(400, f"path is outside the media roots: {raw}")
    return str(p)


def create_app(runner: Runner | None = None) -> FastAPI:
    app = FastAPI(title="MusiX ml-sound", openapi_url=None)
    r = runner or Runner(
        models=os.environ.get("SOUND_MODELS", "/models"),
        scratch=os.environ.get("SOUND_SCRATCH", "/scratch"),
        export=os.environ.get("SOUND_EXPORT", "/export"),
        device=os.environ.get("SOUND_DEVICE", "cuda"),
    )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        b = r.current
        return {
            "ok": True,
            "gpu_free_mb": guard.gpu_free_mb(),
            "batch": b.id if b else None,
            "state": b.state if b else None,
            "stage": b.stage if b else None,
        }

    @app.post("/v1/batches", status_code=202, response_model=None)
    async def start(body: BatchIn) -> dict[str, Any] | JSONResponse:
        if r.current is not None:
            return JSONResponse({"error": "a batch is running", "batch_id": r.current.id}, status_code=409)
        items = [
            BatchItem(id=i.id, path=_check_path(i.path), lrc=i.lrc, keep_stems=i.keep_stems,
                      export_name=i.export_name)
            for i in body.items
        ]  # fmt: skip
        b = Batch(items)
        r.start(b)
        return {"batch_id": b.id}

    @app.get("/v1/batches/{batch_id}")
    async def status(batch_id: str, since: int = 0) -> dict[str, Any]:
        for b in (r.current, r.last):
            if b is not None and b.id == batch_id:
                return b.view(since)
        raise HTTPException(404, "no such batch (the service restarted?)")

    return app


app = create_app()
