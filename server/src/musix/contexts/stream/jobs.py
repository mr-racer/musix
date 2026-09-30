"""The «Поток» state jobs (phase 2 §6.1): recomputed off the request path.

- `profile`: the long-term positives (fulls +0.2, «огоньки» +0.35, a 30-day half-life,
  top 30) — the CLAP retrieval anchors when the session has none yet — and the personal
  genre tolerance (stream spec §5): the run length after which this listener's skip rate
  rises 5 pp above their baseline, once there are ≥ 20 runs of 6+; else 6.
- `genres`: genre centroids in CLAP space + the adjacency threshold (p70 of centroid
  cosines, spec §5 "where to go"), and the library's energy p40/p60 (the sound presets).
- `colisten`: PPMI over tracks heard in the same session (±5 positions), SVD-64 — the
  best source among played tracks (spec §2.2). Uses only this account's own sessions."""

from __future__ import annotations

import datetime as dt
import uuid
from collections import defaultdict
from typing import Any

import numpy as np
import sqlalchemy as sa
from qdrant_client import AsyncQdrantClient
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.library.models import media_files, tracks
from musix.contexts.listening.models import listen_events, taste_signals
from musix.contexts.stream.models import colisten_vectors, stream_genres, taste_maps, taste_profile
from musix.infra.vectors import TRACKS, owned_by
from musix.recsys import tastemap
from musix.recsys.outcome import outcome
from musix.recsys.replay import Signal
from musix.recsys.session import Listen, sessions
from musix.recsys.vibes import vibes as vibes_of

SM = async_sessionmaker[AsyncSession]
T = tracks.c
HALF_LIFE_D, LONG_TOP, W_FULL, W_FIRE = 30.0, 30, 0.2, 0.35
TOLERANCE_DEFAULT, TOLERANCE_MIN_RUNS, TOLERANCE_RISE = 6, 20, 0.05
COLISTEN_DIM, COLISTEN_WINDOW = 64, 5


async def listens(
    s: AsyncSession, account_id: uuid.UUID, since: dt.datetime | None = None
) -> list[Listen]:
    e = listen_events.c
    q = (
        sa.select(
            e.track_id,
            e.started_at,
            e.played_ms,
            e.duration_ms,
            T.primary_artist_id,
            T.album_id,
            T.genre,
            T.duration_ms.label("tdur"),
            media_files.c.axes,
            e.source,
        )
        .join(tracks, T.id == e.track_id)
        .join(media_files, media_files.c.id == T.media_file_id)
        .where(e.account_id == account_id)
        .order_by(e.started_at, e.id)
    )
    if since is not None:
        q = q.where(e.started_at >= since)
    return [
        Listen(
            str(r.track_id),
            r.started_at,
            r.played_ms,
            r.duration_ms or r.tdur,
            str(r.primary_artist_id) if r.primary_artist_id else None,
            str(r.album_id) if r.album_id else None,
            r.genre or "Other",
            (r.axes or {}).get("energy"),
            r.source,
        )
        for r in await s.execute(q)
    ]


def genre_tolerance(ls: list[Listen]) -> int:
    """The run position from which skips rise TOLERANCE_RISE over the listener's baseline."""
    by_pos: dict[int, list[bool]] = defaultdict(list)
    base: list[bool] = []
    runs6 = 0
    for sess in sessions(ls):
        run, prev = 0, None
        for x in sess:
            run = run + 1 if x.genre == prev else 1
            prev = x.genre
            sk = outcome(x.played_ms, x.duration_ms)[0]
            by_pos[run].append(sk)
            base.append(sk)
            runs6 += run == 6
    if runs6 < TOLERANCE_MIN_RUNS or not base:
        return TOLERANCE_DEFAULT
    baseline = sum(base) / len(base)
    for k in range(3, 11):
        tail = [v for pos, vs in by_pos.items() if pos >= k for v in vs]
        if len(tail) >= 30 and sum(tail) / len(tail) >= baseline + TOLERANCE_RISE:
            return k - 1
    return TOLERANCE_DEFAULT  # no personal signal within 10: the study's default


async def profile(
    sm: SM,
    account_id: uuid.UUID,
    now: dt.datetime | None = None,
    q: AsyncQdrantClient | None = None,
) -> None:
    now = now or dt.datetime.now(dt.UTC)
    async with sm() as s:
        ls = await listens(s, account_id)
        fires = (
            await s.execute(
                sa.select(taste_signals.c.track_id, taste_signals.c.created_at).where(
                    taste_signals.c.account_id == account_id, taste_signals.c.kind == "fire"
                )
            )
        ).all()
        waters = (
            await s.execute(
                sa.select(taste_signals.c.track_id, taste_signals.c.created_at).where(
                    taste_signals.c.account_id == account_id, taste_signals.c.kind == "water"
                )
            )
        ).all()
    w: dict[str, float] = defaultdict(float)

    def decay(at: dt.datetime) -> float:
        return float(0.5 ** ((now - at).total_seconds() / 86400 / HALF_LIFE_D))

    for x in ls:
        if outcome(x.played_ms, x.duration_ms)[1]:
            w[x.track_id] += W_FULL * decay(x.at)
    for tid, at in fires:
        w[str(tid)] += W_FIRE * decay(at)
    top = sorted(w.items(), key=lambda kv: -kv[1])[:LONG_TOP]
    vibe_rows: list[dict[str, Any]] = []
    if q is not None:  # «вайбики»: the last 10 days' listens and every signal
        recent = [x for x in ls if (now - x.at).days <= 10]
        sigs = [Signal(str(t), at, "fire") for t, at in fires] + [
            Signal(str(t), at, "water") for t, at in waters
        ]
        involved = {x.track_id for x in recent} | {g.track_id for g in sigs}
        clap = await _clap_for_tracks(sm, q, account_id, involved)
        vibe_rows = [
            {"track": v.track, "weight": v.weight, "members": v.members}
            for v in vibes_of(recent, sigs, clap, now)
        ]
    async with sm() as s:  # a vibe whose members did not change keeps its AI name
        prev = await s.scalar(
            sa.select(taste_profile.c.vibes).where(taste_profile.c.account_id == account_id)
        )
    named = {
        (p["track"], tuple(sorted(p["members"]))): p["name"] for p in prev or [] if p.get("name")
    }
    for v in vibe_rows:
        if (hit := named.get((v["track"], tuple(sorted(v["members"]))))) is not None:
            v["name"] = hit
    row = {
        "account_id": account_id,
        "long_positives": [[t, round(v, 5)] for t, v in top],
        "genre_tolerance": genre_tolerance(ls),
        "vibes": vibe_rows,
        "listens_seen": len(ls),
        "updated_at": now,
    }
    async with sm() as s:
        await s.execute(
            pg_insert(taste_profile)
            .values(**row)
            .on_conflict_do_update(index_elements=["account_id"], set_=row)
        )
        await s.commit()


async def clap_of(q: AsyncQdrantClient, account_id: uuid.UUID) -> dict[str, np.ndarray]:
    """media_file id → pooled CLAP vector, for the account's library."""
    out: dict[str, np.ndarray] = {}
    offset: Any = None
    while True:
        pts, offset = await q.scroll(
            TRACKS,
            scroll_filter=owned_by(account_id),
            limit=512,
            offset=offset,
            with_vectors=["clap"],
            with_payload=False,
        )
        for p in pts:
            v = (p.vector or {}).get("clap") if isinstance(p.vector, dict) else None
            if v:
                out[str(p.id)] = np.asarray(v, np.float32)
        if offset is None:
            return out


async def genres(sm: SM, q: AsyncQdrantClient, account_id: uuid.UUID) -> None:
    clap = await clap_of(q, account_id)
    async with sm() as s:
        rows = (
            await s.execute(
                sa.select(T.media_file_id, T.genre, media_files.c.axes)
                .join(media_files, media_files.c.id == T.media_file_id)
                .where(T.account_id == account_id, T.deleted_at.is_(None))
            )
        ).all()
    by: dict[str, list[np.ndarray]] = defaultdict(list)
    energy = [float(r.axes["energy"]) for r in rows if r.axes and "energy" in r.axes]
    for r in rows:
        if (v := clap.get(str(r.media_file_id))) is not None:
            by[r.genre or "Other"].append(v)
    names = sorted(by)
    if not names:
        return
    C = np.stack([np.mean(by[g], axis=0) for g in names])
    C /= np.maximum(np.linalg.norm(C, axis=1, keepdims=True), 1e-8)
    cc = C @ C.T
    iu = np.triu_indices(len(names), 1)
    thr = float(np.quantile(cc[iu], 0.7)) if len(names) > 1 else 1.0
    p40, p60 = np.quantile(energy, [0.4, 0.6]).tolist() if energy else (None, None)
    row = {
        "account_id": account_id,
        "genres": names,
        "centroids": C.astype(np.float16).tobytes(),
        "adjacency_threshold": thr,
        "energy_p40": p40,
        "energy_p60": p60,
        "updated_at": dt.datetime.now(dt.UTC),
    }
    async with sm() as s:
        await s.execute(
            pg_insert(stream_genres)
            .values(**row)
            .on_conflict_do_update(index_elements=["account_id"], set_=row)
        )
        await s.commit()


def ppmi_svd(
    ids: list[str], sess_tracks: list[list[str]], dim: int = COLISTEN_DIM
) -> np.ndarray | None:
    from scipy.sparse import coo_matrix
    from scipy.sparse.linalg import svds

    pos = {t: i for i, t in enumerate(ids)}
    rows: list[int] = []
    cols: list[int] = []
    for sess in sess_tracks:
        tr = list(dict.fromkeys(pos[t] for t in sess if t in pos))
        for a in range(len(tr)):
            for b in range(max(0, a - COLISTEN_WINDOW), min(len(tr), a + COLISTEN_WINDOW + 1)):
                if a != b:
                    rows.append(tr[a])
                    cols.append(tr[b])
    n = len(ids)
    if not rows or n < 4:
        return None
    C = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, n)).tocsr()
    tot = C.sum()
    rs, cs = np.asarray(C.sum(1)).ravel(), np.asarray(C.sum(0)).ravel()
    C = C.tocoo()
    pmi = np.log(C.data * tot / (rs[C.row] * cs[C.col] + 1e-9))
    keep = pmi > 0
    if not keep.any():
        return None
    P = coo_matrix((pmi[keep], (C.row[keep], C.col[keep])), shape=(n, n)).tocsr()
    k = min(dim, n - 2)
    U, s, _ = svds(P.astype(np.float64), k=k)
    V = U * np.sqrt(s)
    nrm = np.linalg.norm(V, axis=1, keepdims=True)
    out: np.ndarray = np.where(nrm > 0, V / np.maximum(nrm, 1e-9), 0).astype(np.float32)
    return out


async def colisten(sm: SM, account_id: uuid.UUID) -> None:
    async with sm() as s:
        ls = await listens(s, account_id)
        found: Any = await s.scalars(
            sa.select(T.id).where(T.account_id == account_id, T.deleted_at.is_(None)).order_by(T.id)
        )
        ids = [str(t) for t in found]
    heard = [
        [x.track_id for x in sess if not outcome(x.played_ms, x.duration_ms)[0]]
        for sess in sessions(ls)
    ]
    V = ppmi_svd(ids, heard)
    if V is None:
        return
    row = {
        "account_id": account_id,
        "track_ids": [uuid.UUID(t) for t in ids],
        "vectors": V.astype(np.float16).tobytes(),
        "dim": V.shape[1],
        "updated_at": dt.datetime.now(dt.UTC),
    }
    async with sm() as s:
        await s.execute(
            pg_insert(colisten_vectors)
            .values(**row)
            .on_conflict_do_update(index_elements=["account_id"], set_=row)
        )
        await s.commit()


async def _clap_for_tracks(
    sm: SM, q: AsyncQdrantClient, account_id: uuid.UUID, track_ids: set[str]
) -> dict[str, np.ndarray]:
    if not track_ids:
        return {}
    async with sm() as s:
        rows = (
            await s.execute(
                sa.select(T.id, T.media_file_id).where(
                    T.account_id == account_id, T.id.in_([uuid.UUID(t) for t in track_ids])
                )
            )
        ).all()
    by_mf = {str(mf): str(t) for t, mf in rows}
    pts = await q.retrieve(TRACKS, list(by_mf), with_vectors=["clap"], with_payload=False)
    return {
        by_mf[str(p.id)]: np.asarray(p.vector["clap"], np.float32)
        for p in pts
        if isinstance(p.vector, dict) and p.vector.get("clap")
    }


async def taste_map(sm: SM, q: AsyncQdrantClient, account_id: uuid.UUID) -> None:
    clap = await clap_of(q, account_id)
    async with sm() as s:
        rows = (
            await s.execute(
                sa.select(T.id, T.media_file_id, media_files.c.axes)
                .join(media_files, media_files.c.id == T.media_file_id)
                .where(T.account_id == account_id, T.deleted_at.is_(None))
                .order_by(T.id)
            )
        ).all()
    rows = [r for r in rows if str(r.media_file_id) in clap]
    data = tastemap.build(
        [str(r.id) for r in rows],
        np.stack([clap[str(r.media_file_id)] for r in rows]) if rows else np.zeros((0, 512)),
        [r.axes for r in rows],
    )
    row = {"account_id": account_id, "data": data, "updated_at": dt.datetime.now(dt.UTC)}
    async with sm() as s:
        await s.execute(
            pg_insert(taste_maps)
            .values(**row)
            .on_conflict_do_update(index_elements=["account_id"], set_=row)
        )
        await s.commit()
