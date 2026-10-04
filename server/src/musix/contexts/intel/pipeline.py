"""The ingest intelligence chain (spec §2), after `register`, keyed by content: every
step reads and writes `media_files` (one row per sha256), so a second account owning the
same file costs a payload update, not a second pass.

    intel:start ─┬─ indexed already → owners only
                 ├─ intel:lyrics (net) → intel:embed (ml: text + CLAP + axes + upsert)
                 └─ intel:envelope (media: ffmpeg → 4-band RMS at 10 Hz)
                 └─ intel:spectrum (media: ffmpeg → 16-band RMS at 10 Hz)
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

import numpy as np
import sqlalchemy as sa
import structlog
from qdrant_client import AsyncQdrantClient, models
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.intel import envelope, sonic
from musix.contexts.intel import lyrics as online
from musix.contexts.intel.text import text_for_embedding
from musix.contexts.library.models import (
    albums,
    artists,
    lyrics,
    media_files,
    track_artists,
    tracks,
)
from musix.infra.changelog import notify
from musix.infra.ml_client import MlClient
from musix.infra.vectors import BM25, TRACKS, ensure

log = structlog.get_logger()
SM = async_sessionmaker[AsyncSession]
T, M = tracks.c, media_files.c
_prompt_cache: dict[str, np.ndarray] = {}


@dataclass(frozen=True)
class Meta:
    """The canonical (first registration's) metadata of one file."""

    path: str
    title: str
    artist: str  # the primary artist, for lyrics lookups
    artist_display: str
    album: str | None
    album_id: uuid.UUID | None
    genre: str | None
    year: int | None
    duration_ms: int | None
    artist_ids: list[str]
    lyrics: str | None


async def owners(s: AsyncSession, mf_id: uuid.UUID) -> list[str]:
    rows: Any = await s.scalars(
        sa.select(T.account_id).where(T.media_file_id == mf_id, T.deleted_at.is_(None)).distinct()
    )
    return sorted(str(a) for a in rows)


async def meta(s: AsyncSession, mf_id: uuid.UUID) -> Meta | None:
    first = (
        await s.execute(
            sa.select(
                T.id,
                T.title,
                T.title_display,
                T.artist_display,
                T.album_id,
                T.genre,
                T.year,
                T.duration_ms,
                M.path,
                albums.c.title.label("album"),
                lyrics.c.text,
            )
            .join(media_files, M.id == T.media_file_id)
            .outerjoin(albums, albums.c.id == T.album_id)
            .outerjoin(lyrics, lyrics.c.media_file_id == M.id)
            .where(T.media_file_id == mf_id)
            .order_by(T.added_at)
            .limit(1)
        )
    ).first()
    if first is None:
        return None
    arts = (
        await s.execute(
            sa.select(artists.c.id, artists.c.name)
            .join(track_artists, track_artists.c.artist_id == artists.c.id)
            .where(track_artists.c.track_id == first.id)
            .order_by(
                track_artists.c.role != "main", track_artists.c.position
            )  # main first, then feat
        )
    ).all()
    return Meta(
        path=first.path,
        title=first.title_display or first.title,
        artist=arts[0].name if arts else first.artist_display,
        artist_display=first.artist_display,
        album=first.album,
        album_id=first.album_id,
        genre=first.genre,
        year=first.year,
        duration_ms=first.duration_ms,
        artist_ids=[str(a.id) for a in arts],
        lyrics=first.text,
    )


async def set_owners(q: AsyncQdrantClient, mf_id: uuid.UUID, own: list[str]) -> None:
    """Library membership is a payload write, never a re-index (spec §3)."""
    await q.set_payload(TRACKS, payload={"owners": own}, points=[str(mf_id)], wait=True)


async def lyrics_step(sm: SM, mf_id: uuid.UUID) -> None:
    async with sm() as s:
        m = await meta(s, mf_id)
    if m is None:
        return
    if not m.lyrics:
        found = await online.find(
            sm, online.Query(m.title, m.artist, m.album, (m.duration_ms or 0) / 1000 or None)
        )
        if found:
            async with sm() as s:
                await s.execute(
                    pg_insert(lyrics)
                    .values(
                        media_file_id=mf_id,
                        text=found.text,
                        source=found.source,
                        synced_lrc=found.synced_lrc,
                        sanitized_at=sa.func.now(),
                    )
                    .on_conflict_do_nothing(index_elements=["media_file_id"])
                )
                await s.commit()
    async with sm() as s:
        await s.execute(
            sa.update(media_files)
            .where(M.id == mf_id, M.intel_state == "pending")
            .values(intel_state="lyrics")
        )
        await s.commit()


async def _prompts(ml: MlClient, key: str, texts: tuple[str, ...]) -> np.ndarray:
    if key not in _prompt_cache:
        _prompt_cache[key] = await ml.clap_text(list(texts), priority="bulk")
    return _prompt_cache[key]


async def embed_step(sm: SM, ml: MlClient, q: AsyncQdrantClient, mf_id: uuid.UUID) -> None:
    async with sm() as s:
        m = await meta(s, mf_id)
        own = await owners(s, mf_id)
    if m is None:
        return
    text = text_for_embedding(m.title, m.artist_display, m.album, m.genre, m.lyrics)
    dense = (await ml.embed_text([text], is_query=False, priority="bulk"))[0]
    audio = await ml.clap_audio(m.path, priority="bulk")
    vectors: dict[str, Any] = {
        "text": dense.tolist(),
        "bm25": models.Document(text=text, model=BM25),
    }
    axes: dict[str, float] = {}
    tags: list[dict[str, Any]] = []
    if audio is not None:
        mean, chunks = audio
        vectors["clap"], vectors["clap_chunks"] = mean.tolist(), chunks.tolist()
        axes = sonic.axes(mean, await _prompts(ml, "axes", tuple(sonic.AXIS_PROMPTS.values())))
        tags = sonic.tags(mean, await _prompts(ml, "tags", sonic.TAG_VOCAB))
    payload = {
        "owners": own,
        "artist_ids": m.artist_ids,
        "album_id": str(m.album_id) if m.album_id else None,
        "genre": m.genre,
        "year": m.year,
        "duration_ms": m.duration_ms,
        **axes,
    }
    await ensure(q)
    await q.upsert(
        TRACKS, [models.PointStruct(id=str(mf_id), vector=vectors, payload=payload)], wait=True
    )
    async with sm() as s:
        await s.execute(
            sa.update(media_files)
            .where(M.id == mf_id)
            .values(
                axes=axes or None, sonic_tags=tags or None, intel_state="indexed", intel_error=None
            )
        )
        await _progress(s, own)
        await s.commit()


async def _progress(s: AsyncSession, own: list[str]) -> None:
    """One "indexing n / N" stream per account (spec §2), every 25 files and at the end."""
    for acct in own:
        done, total = (
            await s.execute(
                sa.select(sa.func.count().filter(M.intel_state == "indexed"), sa.func.count())
                .select_from(tracks.join(media_files, M.id == T.media_file_id))
                .where(T.account_id == uuid.UUID(acct), T.deleted_at.is_(None))
            )
        ).one()
        if done == total or done % 25 == 0:
            await notify(
                s,
                uuid.UUID(acct),
                "job",
                job="index",
                done=done,
                total=total,
                **({"state": "done"} if done == total else {}),
            )


async def envelope_step(sm: SM, mf_id: uuid.UUID) -> None:
    async with sm() as s:
        path = await s.scalar(sa.select(M.path).where(M.id == mf_id, M.envelope.is_(None)))
    if path is None:
        return
    env = envelope.compute(await envelope.decode(path))
    async with sm() as s:
        await s.execute(
            sa.update(media_files).where(M.id == mf_id).values(envelope=envelope.pack(env))
        )
        await s.commit()


async def spectrum_step(sm: SM, mf_id: uuid.UUID) -> None:
    async with sm() as s:
        path = await s.scalar(sa.select(M.path).where(M.id == mf_id, M.spectrum.is_(None)))
    if path is None:
        return
    spec = envelope.spectrum(await envelope.decode(path, sr=envelope.SPEC_SR))
    async with sm() as s:
        await s.execute(
            sa.update(media_files).where(M.id == mf_id).values(spectrum=envelope.pack(spec))
        )
        await s.commit()


async def fail(sm: SM, mf_id: uuid.UUID, error: str) -> None:
    async with sm() as s:
        await s.execute(
            sa.update(media_files)
            .where(M.id == mf_id)
            .values(intel_state="failed", intel_error=error[:500])
        )
        await s.commit()
