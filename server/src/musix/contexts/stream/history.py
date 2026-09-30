"""An account's history as the replay reads it: track metadata, listens, signals."""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.library.models import media_files, tracks
from musix.contexts.listening.models import taste_signals
from musix.contexts.stream.jobs import listens
from musix.recsys.replay import Signal, TrackMeta
from musix.recsys.session import Listen

T = tracks.c


async def track_meta(s: AsyncSession, account_id: uuid.UUID) -> dict[str, TrackMeta]:
    rows = await s.execute(
        sa.select(
            T.id,
            T.primary_artist_id,
            T.album_id,
            T.genre,
            T.duration_ms,
            T.added_at,
            media_files.c.axes,
        )
        .join(media_files, media_files.c.id == T.media_file_id)
        .where(T.account_id == account_id)
    )
    out = {}
    for r in rows:
        ax = r.axes or {}
        out[str(r.id)] = TrackMeta(
            artist=str(r.primary_artist_id) if r.primary_artist_id else None,
            album=str(r.album_id) if r.album_id else None,
            genre=r.genre or "Other",
            dur_s=r.duration_ms / 1000 if r.duration_ms else None,
            energy=ax.get("energy"),
            axes={k: v for k, v in ax.items() if k != "energy"},
            added_at=r.added_at,
        )
    return out


async def signals(s: AsyncSession, account_id: uuid.UUID) -> list[Signal]:
    g = taste_signals.c
    rows = await s.execute(
        sa.select(g.track_id, g.created_at, g.kind)
        .where(g.account_id == account_id)
        .order_by(g.created_at)
    )
    return [Signal(str(r.track_id), r.created_at, r.kind) for r in rows]


async def load(
    s: AsyncSession, account_id: uuid.UUID
) -> tuple[dict[str, TrackMeta], list[Listen], list[Signal]]:
    return (
        await track_meta(s, account_id),
        await listens(s, account_id),
        await signals(s, account_id),
    )
