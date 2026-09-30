"""Media worker tasks (queue `media`: ffmpeg is CPU-bound, so it has its own concurrency)."""

from __future__ import annotations

import uuid
from pathlib import Path

import procrastinate

from musix.contexts.media.process import process_media
from musix.workers.context import sessionmaker, settings


async def process(media_file_id: str) -> None:
    s = settings()
    await process_media(
        sessionmaker(), Path(s.media_dir), uuid.UUID(media_file_id), s.rendition_budget_gb
    )


async def backfill() -> int:
    """Enqueue processing for every registered file that has not finished it (after an
    import, a migration, or a new tier). `procrastinate defer media:backfill {}`."""
    import sqlalchemy as sa

    from musix.contexts.library.models import media_files

    async with sessionmaker()() as s:
        ids: list[uuid.UUID] = list(
            (
                await s.scalars(
                    sa.select(media_files.c.id).where(media_files.c.state == "registered")
                )
            ).all()
        )
    for mf in ids:
        await enqueue(mf)
    return len(ids)


def register(app: procrastinate.App) -> None:
    app.task(name="media:process", queue="media")(process)
    app.task(name="media:backfill", queue="default")(backfill)


async def enqueue(media_file_id: uuid.UUID) -> None:
    """Called by the ingest tasks, inside the worker, once a file is registered."""
    from musix.workers.app import app

    await app.configure_task("media:process", queueing_lock=f"media:{media_file_id}").defer_async(
        media_file_id=str(media_file_id)
    )
    await app.configure_task(
        "intel:start", queueing_lock=f"intel:start:{media_file_id}"
    ).defer_async(media_file_id=str(media_file_id))
