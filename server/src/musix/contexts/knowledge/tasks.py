"""Knowledge tasks. Queues: `net` (outbound sources, each in its own bucket), `ai` (the
one local LLM: its worker runs with concurrency 1, and interactive jobs — the assistant,
track chat — defer with a higher priority than this bulk enrichment)."""

from __future__ import annotations

import uuid
from functools import cache
from pathlib import Path

import httpx
import procrastinate
import sqlalchemy as sa

from musix.contexts.knowledge import jobs
from musix.errors import Unavailable
from musix.workers.context import llm, sessionmaker, settings

RETRY = procrastinate.RetryStrategy(
    max_attempts=6, wait=30, exponential_wait=2, retry_exceptions={Unavailable}
)
BULK = 0  # interactive LLM work defers with priority INTERACTIVE (Task 8)
INTERACTIVE = 10


@cache
def http() -> httpx.AsyncClient:
    from musix.contexts.knowledge.sources import client

    return client(settings().proxy_url)


async def _defer(name: str, lock: str, **kw: str) -> None:
    from musix.workers.app import app

    await app.configure_task(name, queueing_lock=f"{name}:{lock}", priority=BULK).defer_async(**kw)


async def start(media_file_id: str) -> None:
    song_ids, artist_ids = await jobs.subjects_of(sessionmaker(), uuid.UUID(media_file_id))
    for sid in song_ids:
        await _defer("knowledge:song", str(sid), song_id=str(sid))
    for aid in artist_ids:
        await _defer("knowledge:artist", str(aid), artist_id=str(aid))


async def song(song_id: str) -> None:
    if await jobs.song(sessionmaker(), http(), uuid.UUID(song_id)):
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
    has_facts = await jobs.artist(
        sessionmaker(), http(), Path(settings().media_dir), uuid.UUID(artist_id)
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


async def bio(artist_id: str, lang: str) -> bool:
    return await jobs.bio(sessionmaker(), llm(), uuid.UUID(artist_id), lang)


async def refine(kind: str, subject_id: str, lang: str) -> dict[str, int]:
    out = await jobs.refine(sessionmaker(), llm(), kind, uuid.UUID(subject_id), lang)
    if out.get("links"):
        await _defer("knowledge:verify", subject_id, song_id=subject_id)
    return out


async def verify(song_id: str) -> dict[str, int]:
    return await jobs.verify(sessionmaker(), http(), uuid.UUID(song_id))


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
    app.task(name="knowledge:refine", queue="ai", retry=RETRY)(refine)
    app.task(name="knowledge:relations", queue="ai", retry=RETRY)(relations)
    app.task(name="knowledge:vibe", queue="ai", retry=RETRY)(vibe)
    app.task(name="knowledge:bio", queue="ai", retry=RETRY)(bio)
    app.task(name="knowledge:backfill", queue="default")(backfill)
