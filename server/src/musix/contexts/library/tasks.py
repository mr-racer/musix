"""Worker tasks of the library context — thin wrappers over `ingest` (queue `ingest`).

Plain functions, registered per App by `register`: a Blueprint binds its tasks to the
first App it is added to, and the API and the worker (and tests) each build their own."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import procrastinate

from musix.contexts.library import ingest
from musix.contexts.media.tasks import enqueue as media
from musix.workers.context import sessionmaker, settings


async def scan_folder(account_id: str, root: str) -> dict[str, int]:
    return await ingest.scan_folder(
        sessionmaker(), uuid.UUID(account_id), Path(root), on_registered=media
    )


async def ingest_file(account_id: str, path: str, storage: str = "reference") -> str | None:
    t = await ingest.ingest_file(
        sessionmaker(), uuid.UUID(account_id), Path(path), storage, on_registered=media
    )
    return str(t) if t else None


async def register_existing(account_id: str, media_file_id: str) -> str | None:
    """A second account adds content the server already has: tags are re-read from the
    stored file, nothing is re-encoded."""
    import sqlalchemy as sa

    from musix.contexts.library.models import media_files

    sm = sessionmaker()
    async with sm() as s:
        path = await s.scalar(
            sa.select(media_files.c.path).where(media_files.c.id == uuid.UUID(media_file_id))
        )
    t = await ingest.ingest_file(sm, uuid.UUID(account_id), Path(str(path)), on_registered=media)
    return str(t) if t else None


async def finalize_upload(upload_id: str) -> str | None:
    t = await ingest.finalize_upload(
        sessionmaker(), Path(settings().media_dir), uuid.UUID(upload_id), on_registered=media
    )
    return str(t) if t else None


TASKS: dict[str, Callable[..., Awaitable[Any]]] = {
    "scan_folder": scan_folder,
    "ingest_file": ingest_file,
    "register_existing": register_existing,
    "finalize_upload": finalize_upload,
}


def register(app: procrastinate.App) -> None:
    for name, fn in TASKS.items():
        app.task(name=f"library:{name}", queue="ingest")(fn)
