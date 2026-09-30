"""Candidate sources (stream spec §3.1), each with its budget; duplicates merge and keep
every source that proposed them (for the reason). Everything is the account's own.

| source | budget | |
|---|---|---|
| session artists (enjoyed in this session) | 100 | 40 % of completed next tracks |
| artist affinity (plays × smoothed completion) | 100 | never-played tracks by known artists |
| CLAP neighbours of the session's and the long-term positives | 150 | the best audio source |
| co-listen (PPMI-SVD over this account's sessions) | 100 | the best among played tracks |
| pool samplers: familiar / unplayed / rediscover | 80 each | every preset has candidates |
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections import defaultdict
from typing import Any

import numpy as np
import sqlalchemy as sa
from qdrant_client import AsyncQdrantClient, models
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.stream.models import colisten_vectors
from musix.contexts.stream.state import Snapshot
from musix.infra.vectors import TRACKS, owned_by

B_SESSION, B_AFFINITY, B_CLAP, B_COLISTEN, B_POOL = 100, 100, 150, 100, 80
_colisten_cache: dict[uuid.UUID, tuple[dt.datetime, dict[str, int], np.ndarray]] = {}


async def _ids(s: AsyncSession, sql: str, **p: Any) -> list[str]:
    return [str(x) for x in await s.scalars(sa.text(sql), p)]


async def colisten(s: AsyncSession, account: uuid.UUID, positives: list[str], k: int) -> list[str]:
    at = await s.scalar(
        sa.select(colisten_vectors.c.updated_at).where(colisten_vectors.c.account_id == account)
    )
    if at is None or not positives:
        return []
    hit = _colisten_cache.get(account)
    if hit is None or hit[0] != at:  # the nightly job wrote a new matrix
        row = (
            await s.execute(
                sa.select(colisten_vectors).where(colisten_vectors.c.account_id == account)
            )
        ).one()
        V = (
            np.frombuffer(row.vectors, np.float16)
            .astype(np.float32)
            .reshape(len(row.track_ids), row.dim)
        )
        hit = (at, {str(t): i for i, t in enumerate(row.track_ids)}, V)
        _colisten_cache[account] = hit
    _, pos, V = hit
    rows = [pos[t] for t in positives if t in pos]
    if not rows:
        return []
    sims = (V @ V[rows].T).max(axis=1)
    sims[rows] = -np.inf
    ids = list(pos)
    return [ids[i] for i in np.argsort(-sims)[:k] if np.isfinite(sims[i])]


async def collect(
    sm: async_sessionmaker[AsyncSession], q: AsyncQdrantClient, account: uuid.UUID, snap: Snapshot
) -> dict[str, set[str]]:
    """track id → the sources that proposed it."""
    out: dict[str, set[str]] = defaultdict(set)
    a = {"a": account}
    pos = [x.track for x in snap.sess if x.w > 0]
    neg = [x.track for x in snap.sess if x.w < 0]
    liked_artists = list({x.artist for x in snap.sess if x.w > 0 and x.artist})

    async def session_artist(s: AsyncSession) -> list[str]:
        if not liked_artists:
            return []
        return await _ids(
            s,
            """
                SELECT t.id FROM tracks t
                LEFT JOIN account_artist_stats st ON st.account_id = t.account_id AND st.artist_id = t.primary_artist_id
                WHERE t.account_id = :a AND t.deleted_at IS NULL AND t.primary_artist_id = ANY(:ar)
                ORDER BY random() LIMIT :n""",
            ar=[uuid.UUID(x) for x in liked_artists],
            n=B_SESSION,
            **a,
        )

    async def affinity(s: AsyncSession) -> list[str]:
        return await _ids(
            s,
            """
            SELECT t.id FROM tracks t
            JOIN (SELECT artist_id FROM account_artist_stats WHERE account_id = :a
                  ORDER BY ln(1 + listens) * (fulls + 1) / (listens + 3) DESC LIMIT 30) top
              ON top.artist_id = t.primary_artist_id
            WHERE t.account_id = :a AND t.deleted_at IS NULL ORDER BY random() LIMIT :n""",
            n=B_AFFINITY,
            **a,
        )

    async def clap(s: AsyncSession) -> list[str]:
        anchors = list(dict.fromkeys(pos + snap.long_positives))[:40]
        if not anchors:
            return []
        mf = dict(
            (str(t), str(m))
            for t, m in (
                await s.execute(
                    sa.text(
                        "SELECT id, media_file_id FROM tracks WHERE account_id = :a AND id = ANY(:ids)"
                    ),
                    {"ids": [uuid.UUID(x) for x in anchors + neg], **a},
                )
            ).all()
        )
        positive: list[Any] = [mf[t] for t in anchors if t in mf]
        negative: list[Any] = [mf[t] for t in neg if t in mf]
        if not positive:
            return []
        res = await q.query_points(
            TRACKS,
            query=models.RecommendQuery(
                recommend=models.RecommendInput(
                    positive=positive,
                    negative=negative or None,
                    strategy=models.RecommendStrategy.BEST_SCORE,
                )
            ),
            using="clap",
            limit=B_CLAP,
            query_filter=owned_by(account),
        )
        hits = [str(p.id) for p in res.points]
        if not hits:
            return []
        return await _ids(
            s,
            """
                SELECT id FROM tracks WHERE account_id = :a AND deleted_at IS NULL
                AND media_file_id = ANY(:m)""",
            m=[uuid.UUID(h) for h in hits],
            **a,
        )

    def pool(where: str) -> Any:
        async def sample(s: AsyncSession) -> list[str]:
            return await _ids(
                s,
                f"""
                    SELECT t.id FROM tracks t
                    LEFT JOIN account_track_stats st ON st.account_id = t.account_id AND st.track_id = t.id
                    LEFT JOIN (SELECT track_id, count(*) AS n FROM taste_signals
                               WHERE account_id = :a AND kind = 'fire' GROUP BY track_id) sg ON sg.track_id = t.id
                    WHERE t.account_id = :a AND t.deleted_at IS NULL AND {where}
                    ORDER BY random() LIMIT :n""",
                n=B_POOL,
                **a,
            )

        return sample

    pools = (
        (
            "familiar",
            "(st.fulls > 0 OR sg.n > 0) AND st.last_played_at > now() - interval '60 days'",
        ),
        (
            "rediscover",
            "(st.fulls > 0 OR sg.n > 0) AND st.last_played_at <= now() - interval '60 days'",
        ),
        ("unplayed", "coalesce(st.listens, 0) = 0"),
    )
    # One session, in sequence: measured on the snapshot, seven concurrent sessions cost
    # more (a checkout ping, BEGIN and ROLLBACK each) than the reads they overlap.
    got = []
    async with sm() as s:
        for fn in (
            session_artist,
            affinity,
            clap,
            lambda s: colisten(s, account, pos or snap.long_positives, B_COLISTEN),
            *(pool(where) for _, where in pools),
        ):
            got.append(await fn(s))
    for label, ids in zip(
        ("session_artist", "artist_affinity", "clap", "colisten", *(f"pool:{n}" for n, _ in pools)),
        got,
        strict=True,
    ):
        for t in ids:
            out[t].add(label)
    return out
