"""Knowledge tasks. Queues: `net` (outbound sources, each in its own bucket), `ai` (the
one local LLM: its worker runs with concurrency 1, and interactive jobs — the assistant,
track chat — defer with a higher priority than this bulk enrichment)."""

from __future__ import annotations

import contextlib
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import procrastinate
import sqlalchemy as sa

from musix.contexts.knowledge import jobs
from musix.errors import Unavailable
from musix.infra.llm import LlmRejected
from musix.workers.context import llm, sessionmaker, settings

# a source that fails trips its breaker and every queued job sees Unavailable at once: the
# old 6 tries in ~3.5 min lost 1 537 song and artist jobs to one evening of a choking VPN
# during a Yandex import (2026-10-15). 60 s + 5 min more each time: ~3 h of trouble survived.
RETRY = procrastinate.RetryStrategy(
    max_attempts=10, wait=60, linear_wait=300, retry_exceptions={Unavailable}
)


class _LlmRetry(procrastinate.RetryStrategy):
    """The LLM lives on the owner's GPU and he turns it off: its jobs wait for it, every
    10 min, forever (intel's GPU_RETRY); a few quick tries left vibes and bios undone for
    good. A request the LLM refused (LlmRejected) fails at once: it would be refused again."""

    def get_retry_decision(self, *, exception: BaseException, job: Any) -> Any:
        if isinstance(exception, LlmRejected):
            return None
        return super().get_retry_decision(exception=exception, job=job)


LLM_RETRY = _LlmRetry(wait=600, retry_exceptions={Unavailable})
BULK = 0  # interactive LLM work defers with priority INTERACTIVE (Task 8)
INTERACTIVE = 10


@contextlib.asynccontextmanager
async def http() -> AsyncIterator[httpx.AsyncClient]:
    """A client per job. One cached for the worker's life collected lost pool slots: after
    two days every request waited 15 s for a slot with no socket open (PoolTimeout), each
    one counted against the source, and its breaker stayed open (2026-10-16)."""
    from musix.contexts.knowledge.sources import client

    async with client(settings().proxy_url) as c:
        yield c


async def _defer(name: str, lock: str, **kw: str) -> None:
    from procrastinate.exceptions import AlreadyEnqueued

    from musix.workers.app import app

    task = app.configure_task(name, queueing_lock=f"{name}:{lock}", priority=BULK)
    # already waiting: a backfill re-run must not stop at the first one
    with contextlib.suppress(AlreadyEnqueued):
        await task.defer_async(**kw)


async def start(media_file_id: str) -> None:
    song_ids, artist_ids = await jobs.subjects_of(sessionmaker(), uuid.UUID(media_file_id))
    for sid in song_ids:
        await _defer("knowledge:song", str(sid), song_id=str(sid))
    for aid in artist_ids:
        await _defer("knowledge:artist", str(aid), artist_id=str(aid))
    async with sessionmaker()() as s:
        album_ids = list(
            await s.scalars(
                sa.text("""SELECT DISTINCT album_id FROM tracks WHERE media_file_id = :m
                           AND album_id IS NOT NULL AND deleted_at IS NULL"""),
                {"m": uuid.UUID(media_file_id)},
            )
        )
    for alid in album_ids:
        await _defer("knowledge:album_year", str(alid), album_id=str(alid))


async def song(song_id: str) -> None:
    async with http() as h:
        found = await jobs.song(sessionmaker(), h, uuid.UUID(song_id))
    if found:
        for lang in settings().knowledge_langs:
            await _defer(
                "knowledge:refine",
                f"song:{song_id}:{lang}",
                kind="song",
                subject_id=song_id,
                lang=lang,
            )
            await _defer("knowledge:vibe", f"{song_id}:{lang}", song_id=song_id, lang=lang)
        await _defer("knowledge:relations", song_id, song_id=song_id)


async def artist(artist_id: str) -> None:
    async with http() as h:
        has_facts = await jobs.artist(
            sessionmaker(), h, Path(settings().media_dir), uuid.UUID(artist_id)
        )
    for lang in settings().knowledge_langs:
        if has_facts:
            await _defer(
                "knowledge:refine",
                f"artist:{artist_id}:{lang}",
                kind="artist",
                subject_id=artist_id,
                lang=lang,
            )
        await _defer("knowledge:bio", f"{artist_id}:{lang}", artist_id=artist_id, lang=lang)
    await _defer("knowledge:apple", artist_id, artist_id=artist_id)


async def apple(artist_id: str) -> bool:
    async with http() as h:
        return await jobs.apple(sessionmaker(), h, Path(settings().media_dir), uuid.UUID(artist_id))


async def album_year(album_id: str) -> int | None:
    async with http() as h:
        return await jobs.album_year(sessionmaker(), h, uuid.UUID(album_id))


async def editorial_backfill(limit: int = 100_000) -> int:
    """The artist page's data for what came before it: Apple Music photos for every artist
    with songs of their own, first release years for every album, both once (the fetch
    log remembers hits and misses). `procrastinate defer knowledge:editorial_backfill '{}'`."""
    async with sessionmaker()() as s:
        artist_ids = list(
            await s.scalars(
                sa.text("""
                SELECT a.id FROM artists a WHERE EXISTS
                  (SELECT 1 FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
                   WHERE ta.artist_id = a.id AND ta.role = 'main' AND t.deleted_at IS NULL)
                  AND NOT EXISTS (SELECT 1 FROM source_fetch_log l WHERE l.source = 'apple' AND l.key = a.slug)
                LIMIT :n"""),
                {"n": limit},
            )
        )
        album_ids = list(
            await s.scalars(
                sa.text("""
                SELECT al.id FROM albums al WHERE al.album_artist_id IS NOT NULL AND EXISTS
                  (SELECT 1 FROM tracks t WHERE t.album_id = al.id AND t.deleted_at IS NULL)
                  AND NOT EXISTS (SELECT 1 FROM source_fetch_log l
                                  WHERE l.source = 'mb-album' AND l.key = al.id::text)
                LIMIT :n"""),
                {"n": limit},
            )
        )
    for aid in artist_ids:
        await _defer("knowledge:apple", str(aid), artist_id=str(aid))
    for alid in album_ids:
        await _defer("knowledge:album_year", str(alid), album_id=str(alid))
    return len(artist_ids) + len(album_ids)


async def bio(artist_id: str, lang: str) -> bool:
    return await jobs.bio(sessionmaker(), llm(), uuid.UUID(artist_id), lang)


async def refine(kind: str, subject_id: str, lang: str) -> dict[str, int]:
    out = await jobs.refine(sessionmaker(), llm(), kind, uuid.UUID(subject_id), lang)
    if out.get("links"):
        await _defer("knowledge:verify", subject_id, song_id=subject_id)
    return out


async def verify(song_id: str) -> dict[str, int]:
    async with http() as h:
        return await jobs.verify(sessionmaker(), h, uuid.UUID(song_id))


async def relations(song_id: str) -> int:
    return await jobs.relations(sessionmaker(), llm(), uuid.UUID(song_id))


async def vibe(song_id: str, lang: str) -> str | None:
    return await jobs.vibe(sessionmaker(), llm(), uuid.UUID(song_id), lang)


async def backfill(limit: int = 100_000) -> int:
    """Everything not enriched yet, in the same chain: songs and artists of live tracks
    that were never fetched, then refinements, relations and vibes that are missing.
    `procrastinate defer knowledge:backfill '{}'`."""
    langs = settings().knowledge_langs
    async with sessionmaker()() as s:
        songs_todo = list(
            await s.scalars(
                sa.text("""
                SELECT DISTINCT t.song_id FROM tracks t JOIN songs s ON s.id = t.song_id
                WHERE t.deleted_at IS NULL AND NOT EXISTS
                  (SELECT 1 FROM source_fetch_log l WHERE l.source = 'genius' AND l.key = s.slug)
                  AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.subject_kind = 'song' AND f.subject_id = s.id)
                LIMIT :n"""),
                {"n": limit},
            )
        )
        refine_todo = (
            await s.execute(
                sa.text("""
                SELECT DISTINCT f.subject_kind, f.subject_id, l.lang FROM facts f CROSS JOIN unnest(CAST(:langs AS text[])) l(lang)
                WHERE f.lang = 'en' AND NOT EXISTS
                  (SELECT 1 FROM fact_refinements r WHERE r.fact_id = f.id AND r.lang = l.lang)
                  AND EXISTS (SELECT 1 FROM tracks t WHERE t.deleted_at IS NULL AND
                      (f.subject_kind = 'song' AND t.song_id = f.subject_id OR f.subject_kind = 'artist' AND t.primary_artist_id = f.subject_id))
                LIMIT :n"""),
                {"langs": langs, "n": limit},
            )
        ).all()
    for sid in songs_todo:
        await _defer("knowledge:song", str(sid), song_id=str(sid))
    for kind, sid, lang in refine_todo:
        await _defer(
            "knowledge:refine", f"{kind}:{sid}:{lang}", kind=kind, subject_id=str(sid), lang=lang
        )
    return len(songs_todo) + len(refine_todo)


def register(app: procrastinate.App) -> None:
    app.task(name="knowledge:start", queue="default")(start)
    app.task(name="knowledge:song", queue="net", retry=RETRY)(song)
    app.task(name="knowledge:artist", queue="net", retry=RETRY)(artist)
    app.task(name="knowledge:verify", queue="net", retry=RETRY)(verify)
    app.task(name="knowledge:apple", queue="net", retry=RETRY)(apple)
    app.task(name="knowledge:album_year", queue="net", retry=RETRY)(album_year)
    app.task(name="knowledge:editorial_backfill", queue="default")(editorial_backfill)
    app.task(name="knowledge:refine", queue="ai", retry=LLM_RETRY)(refine)
    app.task(name="knowledge:relations", queue="ai", retry=LLM_RETRY)(relations)
    app.task(name="knowledge:vibe", queue="ai", retry=LLM_RETRY)(vibe)
    app.task(name="knowledge:bio", queue="ai", retry=LLM_RETRY)(bio)
    app.task(name="knowledge:backfill", queue="default")(backfill)
