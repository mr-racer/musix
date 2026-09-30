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
    import, a migration, or a new tier). `procrastinate defer media:backfill {}`. Most
    played first (the cutover's T−1 d step wants the top 2000's `high` copies soonest)."""
    import sqlalchemy as sa

    from musix.contexts.library.models import media_files, tracks
    from musix.contexts.listening.models import account_track_stats

    M, T, A = media_files.c, tracks.c, account_track_stats.c
    plays = (
        sa.select(T.media_file_id, sa.func.sum(A.plays).label("plays"))
        .join(account_track_stats, A.track_id == T.id)
        .group_by(T.media_file_id)
        .subquery()
    )
    async with sessionmaker()() as s:
        ids: list[uuid.UUID] = list(
            (
                await s.scalars(
                    sa.select(M.id)
                    .outerjoin(plays, plays.c.media_file_id == M.id)
                    .where(M.state == "registered")
                    .order_by(sa.func.coalesce(plays.c.plays, 0).desc(), M.id)
                )
            ).all()
        )
    for mf in ids:
        await enqueue(mf)
    return len(ids)


async def import_images(batch: dict[str, object]) -> dict[str, int]:
    """The migrator's covers and artist photos (the host has no libvips; this does)."""
    from musix.contexts.media.imports import import_images as run

    return await run(sessionmaker(), Path(settings().media_dir), batch)


def register(app: procrastinate.App) -> None:
    app.task(name="media:process", queue="media")(process)
    app.task(name="media:import_images", queue="media")(import_images)
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
