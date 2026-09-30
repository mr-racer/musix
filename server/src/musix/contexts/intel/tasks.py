"""Worker tasks of the intel chain. Queues: `net` (outbound sources), `ml` (the model
host: its executor serialises anyway, so a small concurrency), `media` (ffmpeg)."""

from __future__ import annotations

import uuid

import procrastinate
import sqlalchemy as sa

from musix.contexts.intel import pipeline
from musix.contexts.library.models import media_files
from musix.errors import Unavailable
from musix.workers.context import ml, qdrant, sessionmaker

# only a busy or unreachable dependency is retried (10 s + 2^n); a broken file fails once
RETRY = procrastinate.RetryStrategy(
    max_attempts=6, wait=10, exponential_wait=2, retry_exceptions={Unavailable}
)


async def _defer(name: str, mf: str) -> None:
    from musix.workers.app import app

    await app.configure_task(name, queueing_lock=f"{name}:{mf}").defer_async(media_file_id=mf)


async def start(media_file_id: str) -> None:
    mf = uuid.UUID(media_file_id)
    async with sessionmaker()() as s:
        state = await s.scalar(sa.select(media_files.c.intel_state).where(media_files.c.id == mf))
        own = await pipeline.owners(s, mf)
    if state == "indexed":  # another account's file: membership only
        await pipeline.set_owners(await qdrant(), mf, own)
        return
    await _defer("intel:lyrics", media_file_id)
    await _defer("intel:envelope", media_file_id)


async def lyrics(media_file_id: str) -> None:
    await pipeline.lyrics_step(sessionmaker(), uuid.UUID(media_file_id))
    await _defer("intel:embed", media_file_id)


async def embed(media_file_id: str) -> None:
    mf = uuid.UUID(media_file_id)
    try:
        await pipeline.embed_step(sessionmaker(), ml(), await qdrant(), mf)
    except Unavailable:
        raise  # the model host is busy or down: the retry strategy waits it out
    except Exception as e:
        await pipeline.fail(sessionmaker(), mf, f"{type(e).__name__}: {e}")
        raise
    await _defer(
        "knowledge:start", media_file_id
    )  # sonic tags exist now (the vibe line reads them)


async def envelope(media_file_id: str) -> None:
    await pipeline.envelope_step(sessionmaker(), uuid.UUID(media_file_id))


async def backfill(account_id: str | None = None) -> int:
    """Start the chain for every file not indexed yet (optionally one account's).
    `procrastinate defer intel:backfill '{"account_id": "…"}'`."""
    from musix.contexts.library.models import tracks

    q = sa.select(media_files.c.id).where(media_files.c.intel_state != "indexed")
    if account_id:
        own = sa.select(tracks.c.media_file_id).where(tracks.c.account_id == uuid.UUID(account_id))
        q = q.where(media_files.c.id.in_(own))
    async with sessionmaker()() as s:
        ids: list[uuid.UUID] = list(await s.scalars(q))
    for mf in ids:
        await _defer("intel:start", str(mf))
    return len(ids)


def register(app: procrastinate.App) -> None:
    app.task(name="intel:start", queue="default")(start)
    app.task(name="intel:lyrics", queue="net", retry=RETRY)(lyrics)
    app.task(name="intel:embed", queue="ml", retry=RETRY)(embed)
    app.task(name="intel:envelope", queue="media", retry=2)(envelope)
    app.task(name="intel:backfill", queue="default")(backfill)
