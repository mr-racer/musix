"""The online «Поток» state: a handful of indexed reads (phase 2 §6.2 step 1).

- the account's totals and genre counts (account_genre_stats — a few dozen rows);
- the current listening session: the last ≤ 50 listens, cut at the 30-min gap
  (musix.recsys.session), each weighted by musix.recsys.outcome with its «огонёк»;
- this client session's served log (stream_decisions): the preset window, the queue the
  listener has not heard yet, the genres already travelled to;
- today's heard and served tracks (no same-day repeats, spec §6);
- the profile, the genre centroids, the «Меньше такого» of this session;
- per candidate (one query): track / artist stats, signals, sound axes."""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.stream.models import stream_genres, taste_profile
from musix.recsys import policy
from musix.recsys.features import Account, Cand, SessItem
from musix.recsys.outcome import weight
from musix.recsys.replay import Signal, fired_plays
from musix.recsys.session import GAP, Listen

LOCK_DAYS = 1.0  # a «вода» locks its track while its charge is above 50 % (1-day half-life)


@dataclass
class Served:
    track: str
    pool: str
    at: dt.datetime
    trigger: str | None


@dataclass
class Snapshot:
    now: dt.datetime
    acc: Account
    sess: list[SessItem]
    sess_tracks: list[str]
    sess_fired: set[str]
    served: list[Served]
    pending: list[str]  # served in this session, not heard yet (the client's queue)
    today: set[str]
    locked: set[str]
    long_positives: list[str]
    tolerance: int = 6
    genres: dict[str, np.ndarray] = field(default_factory=dict)
    adjacency: float = 1.0
    energy_p40: float | None = None
    energy_p60: float | None = None
    less_like: set[tuple[str, str]] = field(default_factory=set)
    settings: dict[str, Any] = field(default_factory=dict)


@dataclass
class CandRow:
    cand: Cand
    pools: frozenset[str]
    media_file_id: str
    title: str
    artist_name: str
    last_played: dt.datetime | None


async def _rows(s: AsyncSession, sql: str, **params: Any) -> list[Any]:
    return list((await s.execute(sa.text(sql), params)).all())


async def load(
    s: AsyncSession, account: uuid.UUID, session_id: str, now: dt.datetime, tz_offset_min: int
) -> Snapshot:
    a = {"a": account}
    g = await _rows(
        s, "SELECT genre, listens, fulls FROM account_genre_stats WHERE account_id = :a", **a
    )
    acc = Account(
        sum(r.listens for r in g), sum(r.fulls for r in g), {r.genre: r.listens for r in g}
    )

    recent = await _rows(
        s,
        """
        SELECT e.track_id, e.started_at, e.played_ms,
               coalesce(nullif(e.duration_ms, 0), t.duration_ms) AS dur,
               t.primary_artist_id, t.album_id,
               coalesce(nullif(t.genre, ''), 'Other') AS genre, m.axes
        FROM listen_events e
        JOIN tracks t ON t.id = e.track_id
        JOIN media_files m ON m.id = t.media_file_id
        WHERE e.account_id = :a AND e.started_at > :since
        ORDER BY e.started_at DESC, e.id DESC LIMIT 50""",
        since=now - dt.timedelta(hours=12),
        **a,
    )
    recent.reverse()
    listens = [
        Listen(
            str(r.track_id),
            r.started_at,
            r.played_ms,
            r.dur,
            str(r.primary_artist_id) if r.primary_artist_id else None,
            str(r.album_id) if r.album_id else None,
            r.genre,
            (r.axes or {}).get("energy"),
        )
        for r in recent
    ]
    start = 0  # the current session: back from the newest listen to the first 30-min gap
    for i in range(len(listens) - 1, 0, -1):
        if listens[i].at - listens[i - 1].at > GAP:
            start = i
            break
    # the same rule as the replay's State.session
    cur = listens[start:] if listens and now - listens[-1].at <= GAP else []
    fires = await _rows(
        s,
        """
        SELECT track_id, created_at, kind FROM taste_signals
        WHERE account_id = :a AND created_at > :since""",
        since=now - dt.timedelta(hours=12),
        **a,
    )
    sig = [Signal(str(r.track_id), r.created_at, r.kind) for r in fires]
    tags = fired_plays(cur, sig)
    sess = [
        SessItem(
            x.track_id,
            x.artist_id,
            x.album_id,
            x.genre,
            weight(x.played_ms, x.duration_ms, "fire" in tags.get(i, ())),
            x.energy,
        )
        for i, x in enumerate(cur)
    ]

    dec = await _rows(
        s,
        """
        SELECT track_id, pool, served_at, trigger FROM stream_decisions
        WHERE account_id = :a AND session_id = :sid AND served_at > :since
        ORDER BY served_at, id""",
        sid=session_id,
        since=now - dt.timedelta(days=1),
        **a,
    )
    served = [Served(str(r.track_id), r.pool, r.served_at, r.trigger) for r in dec]
    heard_since = {x.track_id for x in cur}
    last_heard = cur[-1].at if cur else None
    pending = [
        d.track
        for d in served
        if (last_heard is None or d.at > last_heard) and d.track not in heard_since
    ]

    midnight = (now + dt.timedelta(minutes=tz_offset_min)).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) - dt.timedelta(minutes=tz_offset_min)
    today = {
        str(r[0])
        for r in await _rows(
            s,
            """
        SELECT track_id FROM listen_events WHERE account_id = :a AND started_at >= :m
        UNION SELECT track_id FROM stream_decisions WHERE account_id = :a AND served_at >= :m""",
            m=midnight,
            **a,
        )
    }
    # locked: the track's LATEST signal is a «вода» still above 50 % charge
    locked = {
        str(r[0])
        for r in await _rows(
            s,
            """
        SELECT track_id FROM (
            SELECT DISTINCT ON (track_id) track_id, kind, created_at FROM taste_signals
            WHERE account_id = :a ORDER BY track_id, created_at DESC) x
        WHERE kind = 'water' AND created_at > :since""",
            since=now - dt.timedelta(days=LOCK_DAYS),
            **a,
        )
    }

    prof = (
        await s.execute(sa.select(taste_profile).where(taste_profile.c.account_id == account))
    ).first()
    gen = (
        await s.execute(sa.select(stream_genres).where(stream_genres.c.account_id == account))
    ).first()
    genres: dict[str, np.ndarray] = {}
    if gen is not None:
        C = np.frombuffer(gen.centroids, np.float16).astype(np.float32).reshape(len(gen.genres), -1)
        genres = dict(zip(gen.genres, C, strict=True))
    fb = await _rows(
        s,
        """
        SELECT artist_id, genre FROM stream_feedback WHERE account_id = :a AND session_id = :sid""",
        sid=session_id,
        **a,
    )
    less: set[tuple[str, str]] = set()
    for r in fb:
        if r.artist_id:
            less.add(("artist", str(r.artist_id)))
        if r.genre:
            less.add(("genre", r.genre))
    settings = (
        await s.scalar(sa.text("SELECT value FROM account_settings WHERE account_id = :a"), a) or {}
    )
    return Snapshot(
        now=now,
        acc=acc,
        sess=sess,
        sess_tracks=[x.track_id for x in cur],
        sess_fired={cur[i].track_id for i, k in tags.items() if "fire" in k},
        served=served,
        pending=pending,
        today=today,
        locked=locked,
        long_positives=[t for t, _ in (prof.long_positives if prof else [])],
        tolerance=prof.genre_tolerance if prof else 6,
        genres=genres,
        adjacency=gen.adjacency_threshold if gen else 1.0,
        energy_p40=gen.energy_p40 if gen else None,
        energy_p60=gen.energy_p60 if gen else None,
        less_like=less,
        settings=dict(settings.get("stream") or {}),
    )


async def candidates(
    s: AsyncSession, account: uuid.UUID, ids: list[str], now: dt.datetime
) -> dict[str, CandRow]:
    """Everything the features and the policy need per candidate, in one query."""
    if not ids:
        return {}
    rows = await _rows(
        s,
        """
        SELECT t.id, t.primary_artist_id, t.album_id,
               coalesce(nullif(t.genre, ''), 'Other') AS genre,
               t.duration_ms, t.added_at, t.media_file_id,
               coalesce(t.title_display, t.title) AS title,
               coalesce(ar.name, t.artist_display) AS artist_name, m.axes,
               coalesce(st.listens, 0) AS listens, coalesce(st.fulls, 0) AS fulls,
               coalesce(st.quick_skips, 0) AS qskips, st.last_played_at,
               coalesce(ast.listens, 0) AS a_listens, coalesce(ast.fulls, 0) AS a_fulls,
               coalesce(ast.quick_skips, 0) AS a_qskips, ast.last_heard_at,
               coalesce(sg.fires, 0) AS fires, coalesce(sg.waters, 0) AS waters
        FROM tracks t
        JOIN media_files m ON m.id = t.media_file_id
        LEFT JOIN artists ar ON ar.id = t.primary_artist_id
        LEFT JOIN account_track_stats st ON st.account_id = t.account_id AND st.track_id = t.id
        LEFT JOIN account_artist_stats ast
               ON ast.account_id = t.account_id AND ast.artist_id = t.primary_artist_id
        LEFT JOIN (SELECT track_id, count(*) FILTER (WHERE kind = 'fire') AS fires,
                          count(*) FILTER (WHERE kind = 'water') AS waters
                   FROM taste_signals WHERE account_id = :a AND track_id = ANY(:ids)
                   GROUP BY track_id) sg
               ON sg.track_id = t.id
        WHERE t.account_id = :a AND t.id = ANY(:ids) AND t.deleted_at IS NULL""",
        a=account,
        ids=[uuid.UUID(i) for i in ids],
    )

    def days(t: dt.datetime | None) -> float | None:
        return (now - t).total_seconds() / 86400 if t else None

    out = {}
    for r in rows:
        ax = r.axes or {}
        c = Cand(
            track=str(r.id),
            artist=str(r.primary_artist_id) if r.primary_artist_id else None,
            album=str(r.album_id) if r.album_id else None,
            genre=r.genre,
            dur_s=r.duration_ms / 1000 if r.duration_ms else None,
            energy=ax.get("energy"),
            axes={k: v for k, v in ax.items() if k != "energy"},
            listens=r.listens,
            fulls=r.fulls,
            quick_skips=r.qskips,
            days_since=days(r.last_played_at),
            fires=r.fires,
            waters=r.waters,
            days_in_lib=days(r.added_at),
            a_listens=r.a_listens,
            a_fulls=r.a_fulls,
            a_quick_skips=r.a_qskips,
            a_days_since=days(r.last_heard_at),
        )
        out[c.track] = CandRow(
            c,
            policy.pools_of(r.fulls, r.fires, r.listens, c.days_since),
            str(r.media_file_id),
            r.title,
            r.artist_name,
            r.last_played_at,
        )
    return out
