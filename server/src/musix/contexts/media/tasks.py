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


async def regen_images() -> dict[str, int]:
    """Bring migrated images up to `images.variants`' full-resolution rule: re-read the
    originals the migrator kept under `<media>/import/v1/` (content-addressed, so the bytes
    name their row) and fill in the missing steps. `procrastinate defer media:regen_images {}`."""
    import asyncio

    import sqlalchemy as sa

    from musix.contexts.library.models import images
    from musix.contexts.media import images as img
    from musix.contexts.media.process import store_image

    media = Path(settings().media_dir)
    n = {"seen": 0, "regenerated": 0}
    sm = sessionmaker()
    for sub in ("covers", "artists"):
        d = media / "import" / "v1" / sub
        for f in sorted(d.iterdir()) if d.is_dir() else []:
            data = await asyncio.to_thread(f.read_bytes)
            n["seen"] += 1
            async with sm() as s:
                q = sa.select(images.c.kind, images.c.width, images.c.height, images.c.variants)
                row = (await s.execute(q.where(images.c.id == img.image_id(data)))).first()
                if row is None or img.complete(row.variants, row.width, row.height):
                    continue  # never imported (nothing references it), or already whole
                await store_image(s, media, data, row.kind)
                await s.commit()
            n["regenerated"] += 1
    return n


def register(app: procrastinate.App) -> None:
    app.task(name="media:process", queue="media")(process)
    app.task(name="media:import_images", queue="media")(import_images)
    app.task(name="media:regen_images", queue="media")(regen_images)
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
