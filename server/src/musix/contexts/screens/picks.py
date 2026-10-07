"""«Поставить альбом» on the home: v1's library rail, ported one to one from
`stream_service.vibe_album_suggestions` (the owner asked for v1's logic, not a new one).

For every current «вайбик», strongest first, the album whose mean CLAP is closest
to the vibe's centroid but which is not represented inside the vibe: the point is
to lead the listener somewhere adjacent, not back to what the vibe is made of.
Candidates come from the top CLAP hits around the centroid; an album's mean is
taken over an even sample of its tracklist. ≤2 per vibe and ≤6 in all, round-robin
across vibes (every vibe places its best album before any vibe places its second:
diversity over depth). 1–2-track "albums" are singles, not a pick. Pure vector
math, no LLM: the vibe's own name is the reason the client shows («≈ Меланхоличный
поп»). Cached per account for six hours, as v1, and dropped when the vibes change."""

from __future__ import annotations

import logging
import time
import uuid
from collections import defaultdict
from typing import Any

import numpy as np
import sqlalchemy as sa
from qdrant_client import AsyncQdrantClient

from musix.contexts.library.models import albums, tracks
from musix.contexts.screens import schemas as S
from musix.contexts.screens.service import Ctx, album_cards
from musix.infra.vectors import TRACKS, owned_by

log = logging.getLogger(__name__)

SEARCH_LIMIT = 300  # top clap hits per vibe → candidate albums
CANDIDATES_MAX = 24  # albums fully scored per vibe
SAMPLE = 12  # tracks per album used for the album mean
MIN_TRACKS = 3
MAX_PER_VIBE = 2
TOTAL_MAX = 6
TTL = 6 * 3600.0

T = tracks.c
_cache: dict[uuid.UUID, tuple[float, tuple[Any, ...], list[S.AlbumPick]]] = {}


def _centroid(vectors: list[np.ndarray]) -> np.ndarray | None:
    if not vectors:
        return None
    c = np.mean(np.stack(vectors), axis=0)
    n = float(np.linalg.norm(c))
    return c / n if n > 0 else None


async def _clap(q: AsyncQdrantClient, ids: list[uuid.UUID]) -> dict[uuid.UUID, np.ndarray]:
    out: dict[uuid.UUID, np.ndarray] = {}
    for i in range(0, len(ids), 256):
        pts = await q.retrieve(
            TRACKS,
            ids=[str(x) for x in ids[i : i + 256]],
            with_vectors=["clap"],
            with_payload=False,
        )
        for p in pts:
            v = (p.vector or {}).get("clap") if isinstance(p.vector, dict) else None
            if v:
                out[uuid.UUID(str(p.id))] = np.asarray(v, np.float32)
    return out


def round_robin(ranked: list[list[tuple[float, uuid.UUID]]]) -> list[tuple[int, uuid.UUID, float]]:
    """(vibe index, album, score) in the order the rail shows them: every vibe's best
    before any vibe's second, no album twice, ≤MAX_PER_VIBE each, ≤TOTAL_MAX in all."""
    out: list[tuple[int, uuid.UUID, float]] = []
    seen: set[uuid.UUID] = set()
    iters = [iter(r) for r in ranked]
    for _round in range(MAX_PER_VIBE):
        for vi, it in enumerate(iters):
            if len(out) >= TOTAL_MAX:
                return out
            for score, album in it:
                if album in seen:
                    continue
                seen.add(album)
                out.append((vi, album, round(score, 3)))
                break
    return out


async def album_picks(
    c: Ctx, q: AsyncQdrantClient | None, vibe_rows: list[dict[str, Any]]
) -> list[S.AlbumPick]:
    if q is None or not vibe_rows:
        return []
    sig = tuple((v.get("track"), tuple(sorted(v.get("members") or []))) for v in vibe_rows)
    hit = _cache.get(c.account_id)
    if hit and hit[1] == sig and time.monotonic() - hit[0] < TTL:
        return hit[2]
    try:
        picks = await _compute(c, q, vibe_rows)
    except Exception:  # a cold Qdrant must not take the home down with it
        log.exception("[album-picks] failed for %s", c.account_id)
        return []
    _cache[c.account_id] = (time.monotonic(), sig, picks)
    return picks


async def _compute(
    c: Ctx, q: AsyncQdrantClient, vibe_rows: list[dict[str, Any]]
) -> list[S.AlbumPick]:
    rows = await c.run(
        lambda s: s.execute(
            sa.select(T.id, T.media_file_id, T.album_id)
            .where(c.live(), T.album_id.is_not(None))
            .order_by(T.album_id, T.disc_no.nulls_last(), T.track_no.nulls_last())
        )
    )
    mf_of: dict[uuid.UUID, uuid.UUID] = {}
    album_of: dict[uuid.UUID, uuid.UUID] = {}  # media file → album
    files: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)  # album → media files in order
    for r in rows:
        mf_of[r.id] = r.media_file_id
        album_of[r.media_file_id] = r.album_id
        files[r.album_id].append(r.media_file_id)
    eligible = {a for a, fs in files.items() if len(fs) >= MIN_TRACKS}
    if not eligible:
        return []

    album_centroid: dict[uuid.UUID, np.ndarray | None] = {}
    ranked: list[list[tuple[float, uuid.UUID]]] = []
    for v in vibe_rows:
        members = [uuid.UUID(str(m)) for m in v.get("members") or []]
        member_files = [mf_of[m] for m in members if m in mf_of]
        centroid = _centroid(list((await _clap(q, member_files)).values()))
        if centroid is None:
            ranked.append([])
            continue
        inside = {album_of[f] for f in member_files if f in album_of}
        hits = await q.query_points(
            TRACKS,
            query=[float(x) for x in centroid],
            using="clap",
            limit=SEARCH_LIMIT,
            query_filter=owned_by(c.account_id),
            with_payload=False,
        )
        cands: list[uuid.UUID] = []
        for p in hits.points:
            a = album_of.get(uuid.UUID(str(p.id)))
            if a is None or a in inside or a not in eligible or a in cands:
                continue
            cands.append(a)
            if len(cands) >= CANDIDATES_MAX:
                break
        need: dict[uuid.UUID, list[uuid.UUID]] = {}
        for a in cands:
            if a not in album_centroid:
                fs = files[a]
                step = max(1, len(fs) // SAMPLE)
                need[a] = fs[::step][:SAMPLE]
        if need:
            vecs = await _clap(q, [f for fs in need.values() for f in fs])
            for a, fs in need.items():
                album_centroid[a] = _centroid([vecs[f] for f in fs if f in vecs])
        scored = [
            (float(ac @ centroid), a) for a in cands if (ac := album_centroid.get(a)) is not None
        ]
        scored.sort(reverse=True)
        ranked.append(scored)

    chosen = round_robin(ranked)
    if not chosen:
        return []
    cards = {a.id: a for a in await album_cards(c, albums.c.id.in_([a for _, a, _ in chosen]))}
    return [
        S.AlbumPick(
            album=cards[a],
            vibe_id=uuid.UUID(str(vibe_rows[vi]["track"])),
            vibe_name=vibe_rows[vi].get("name"),
            score=score,
        )
        for vi, a, score in chosen
        if a in cards
    ]
