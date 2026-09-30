"""The online «Поток» (phase 2 §6.2): state → candidates → features → rank → policy →
record → return. Target p95 < 150 ms: a few indexed reads, one Qdrant batch, a ~2–5 ms
LightGBM pass over ~500 candidates, the policy loop in Python."""

from __future__ import annotations

import datetime as dt
import json
import uuid
from typing import Any

import numpy as np
import sqlalchemy as sa
from qdrant_client import AsyncQdrantClient
from qdrant_client.http.exceptions import UnexpectedResponse
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.library.models import tracks
from musix.contexts.screens import service as screens
from musix.contexts.stream import candidates as sources
from musix.contexts.stream import schemas as S
from musix.contexts.stream import state
from musix.errors import Invalid, NotFound
from musix.infra.vectors import TRACKS, owned_by
from musix.recsys import features, policy, reasons
from musix.recsys.autoplay import order as autoplay_order
from musix.recsys.train import Model

TOP_LOGGED = 30
_model: dict[str, Any] = {"version": None, "model": None, "checked": 0.0}


async def ranker(s: AsyncSession) -> tuple[int | None, Model | None]:
    """The promoted model, held in process by version; the version is re-read every 60 s."""
    now = dt.datetime.now(dt.UTC).timestamp()
    if now - _model["checked"] > 60:
        _model["checked"] = now
        v = await s.scalar(sa.text("SELECT version FROM ranker_models WHERE promoted"))
        if v != _model["version"]:
            text = (
                await s.scalar(
                    sa.text("SELECT model FROM ranker_models WHERE version = :v"), {"v": v}
                )
                if v
                else None
            )
            _model.update(version=v, model=Model.load(text) if text else None)
    return _model["version"], _model["model"]


def _heuristic(X: np.ndarray) -> np.ndarray:
    """Before the first model is promoted: the artist's and the track's smoothed completion
    (the best single signals of the offline study), minus a heard-in-the-last-day penalty."""
    col = {f: i for i, f in enumerate(features.FEATURES)}
    fresh = X[:, col["t_days_since"]] < 1
    out: np.ndarray = 0.6 * X[:, col["a_full_rate"]] + 0.4 * X[:, col["t_full_rate"]] - 0.3 * fresh
    return out


def _shares(
    settings: dict[str, Any], presets: dict[str, Any]
) -> tuple[dict[str, float], str | None, str, str | None]:
    fam = settings.get("familiarity") or "mix"
    shares = (presets.get(fam) or presets["mix"])["shares"]
    sound = settings.get("sound")
    band = (presets.get(sound) or {}).get("energy_band") if sound else None
    return dict(shares), band, fam, sound


async def presets(s: AsyncSession) -> dict[str, Any]:
    rows = await s.execute(sa.text("SELECT * FROM stream_presets ORDER BY row, position"))
    return {r.id: dict(r._mapping) for r in rows}


async def next_chunk(
    c: screens.Ctx,
    q: AsyncQdrantClient,
    session_id: str,
    n: int,
    lang: str,
    tz_offset_min: int,
    rng: np.random.Generator | None = None,
) -> S.StreamOut:
    rng = rng or np.random.default_rng()
    now = dt.datetime.now(dt.UTC)
    async with c.sm() as s:
        snap = await state.load(s, c.account_id, session_id, now, tz_offset_min)
        props = await sources.collect(c.sm, q, c.account_id, snap)
        rows = await state.candidates(s, c.account_id, list(props), now)
        version, model = await ranker(s)
        cat = await presets(s)
    ids = list(rows)
    if not ids:
        return S.StreamOut(items=[], images={}, model_version=version)
    X = features.matrix(snap.acc, snap.sess, [rows[i].cand for i in ids])
    p = model.predict(X) if model is not None else _heuristic(X)
    shares, band, fam, sound = _shares(snap.settings, cat)
    items = [
        policy.Item(
            i,
            rows[i].cand.artist,
            rows[i].cand.genre,
            rows[i].cand.energy,
            rows[i].pools,
            float(p[k]),
        )
        for k, i in enumerate(ids)
    ]
    meta = {i: rows[i] for i in ids}
    # the sequence the listener hears: this session's listens, then the queued served tracks
    recent = [
        policy.Recent(x.track, x.artist, x.genre, x.w < 0, x.track in snap.sess_fired)
        for x in snap.sess
    ]
    for t in snap.pending:
        if t in meta:
            recent.append(policy.Recent(t, meta[t].cand.artist, meta[t].cand.genre, None))
    pool_log = [d.pool for d in snap.served]
    visited = [d.trigger.split(":", 1)[1] for d in snap.served if d.trigger and ":" in d.trigger]
    excluded = snap.today | snap.locked | set(snap.pending)
    picked: list[tuple[int, policy.Decision, str | None]] = []
    for k in range(n):
        from_genre = recent[-1].genre if recent else None
        ctx = policy.Ctx(
            shares=shares,
            recent=recent,
            pool_log=pool_log,
            excluded=excluded,
            tolerance=snap.tolerance,
            sound=band,
            energy_p40=snap.energy_p40,
            energy_p60=snap.energy_p60,
            genre_vec=snap.genres,
            adjacency=snap.adjacency,
            visited=visited,
            less_like=snap.less_like,
            explore=policy.is_explore_slot(len(snap.served) + k),
        )
        d = policy.pick(items, ctx, rng)
        if d is None:
            break
        if d.target_genre is not None and all(x.clap is None for x in items):
            await _attach_clap(q, c.account_id, items, meta)
            d = policy.pick(items, ctx, rng) or d  # the same move, now with bridge boosts
        x = items[d.index]
        picked.append((d.index, d, from_genre))
        recent.append(policy.Recent(x.track, x.artist, x.genre, None))
        pool_log.append(d.pool)
        excluded.add(x.track)
    contrib = model.contrib(X[[i for i, _, _ in picked]]) if model is not None and picked else None
    order = np.argsort(-p)[:TOP_LOGGED]
    top = [[ids[i], round(float(p[i]), 4)] for i in order]
    out_items: list[S.StreamItem] = []
    decisions = []
    for j, (i, d, from_genre) in enumerate(picked):
        r = meta[ids[i]]
        src = props[ids[i]]
        ref = await _ref_title(c, snap, src, r)
        why = reasons.build(
            lang=lang,
            pool=d.pool,
            sources=src,
            explore=d.explore,
            trigger=d.trigger,
            from_genre=from_genre,
            to_genre=d.target_genre,
            sound=band if sound else None,
            artist=r.artist_name,
            ref_track=ref,
            last_played=r.last_played,
            contrib=None if contrib is None else contrib[j],
        )
        decisions.append(
            {
                "account_id": c.account_id,
                "session_id": session_id,
                "track_id": uuid.UUID(ids[i]),
                "served_at": now + dt.timedelta(microseconds=j),
                "pool": d.pool,
                "sources": sorted(src),
                "score": float(p[i]),
                "top": top,
                "explore": d.explore,
                "propensity": d.propensity,
                "trigger": f"{d.trigger}:{d.target_genre}"
                if d.trigger and d.target_genre
                else d.trigger,
                "reason": why.kind,
                "model_version": version,
                "policy_version": policy.POLICY_VERSION,
            }
        )
        out_items.append(
            S.StreamItem(
                track_id=uuid.UUID(ids[i]),
                pool=d.pool,
                sources=sorted(src),
                reason=S.ReasonOut(
                    kind=why.kind, text=why.text, refs=why.refs, details=why.details
                ),
            )
        )
    if decisions:
        async with c.sm() as s:
            await s.execute(
                sa.text("""
                INSERT INTO stream_decisions (account_id, session_id, track_id, served_at, pool, sources,
                    score, top, explore, propensity, trigger, reason, model_version, policy_version)
                SELECT * FROM jsonb_to_recordset(:rows) AS x(account_id uuid, session_id text, track_id uuid,
                    served_at timestamptz, pool text, sources text[], score float8, top jsonb, explore bool,
                    propensity float8, trigger text, reason text, model_version int, policy_version text)"""),
                {"rows": json.dumps(decisions, default=str)},
            )
            await s.commit()
    tr = {t.id: t for t in await c.tracks([it.track_id for it in out_items])}
    for it in out_items:
        it.track = tr.get(it.track_id)
    imgs = await c.images([t.cover_image_id for t in tr.values()])
    return S.StreamOut(
        items=[x for x in out_items if x.track is not None],
        images=imgs,
        model_version=version,
        familiarity=fam,
        sound=sound,
    )


async def _attach_clap(
    q: AsyncQdrantClient,
    account: uuid.UUID,
    items: list[policy.Item],
    meta: dict[str, state.CandRow],
) -> None:
    pts = await q.retrieve(
        TRACKS, [meta[x.track].media_file_id for x in items], with_vectors=["clap"]
    )
    by = {
        str(p.id): np.asarray(p.vector["clap"], np.float32)
        for p in pts
        if isinstance(p.vector, dict) and p.vector.get("clap")
    }
    for x in items:
        x.clap = by.get(meta[x.track].media_file_id)


async def _ref_title(
    c: screens.Ctx, snap: state.Snapshot, src: set[str], r: state.CandRow
) -> str | None:
    """The track a similar_to / colisten reason names: the session's most recent positive
    (or the strongest long-term one) — only asked for when that source proposed it."""
    if not ({"clap", "colisten"} & src):
        return None
    anchor = next((x.track for x in reversed(snap.sess) if x.w > 0), None) or (
        snap.long_positives[0] if snap.long_positives else None
    )
    if anchor is None:
        return None
    async with c.sm() as s:
        title = await s.scalar(
            sa.select(sa.func.coalesce(tracks.c.title_display, tracks.c.title)).where(
                tracks.c.id == uuid.UUID(anchor), tracks.c.account_id == c.account_id
            )
        )
    return str(title) if title else None


async def put_settings(
    s: AsyncSession, account: uuid.UUID, body: S.StreamSettings
) -> S.StreamSettings:
    from musix.contexts.identity import service as identity

    cat = await presets(s)
    if body.familiarity not in cat or cat[body.familiarity]["row"] != "familiarity":
        raise Invalid("unknown familiarity preset")
    if body.sound is not None and (body.sound not in cat or cat[body.sound]["row"] != "sound"):
        raise Invalid("unknown sound preset")
    value = await identity.get_settings(s, account)
    value["stream"] = body.model_dump(mode="json")
    await identity.put_settings(s, account, value)
    return body


async def feedback(s: AsyncSession, account: uuid.UUID, body: S.FeedbackIn) -> None:
    row = (
        await s.execute(
            sa.select(tracks.c.primary_artist_id, tracks.c.genre).where(
                tracks.c.id == body.track_id, tracks.c.account_id == account
            )
        )
    ).first()
    if row is None:
        raise NotFound("track")
    await s.execute(
        sa.text("""
        INSERT INTO stream_feedback (account_id, session_id, kind, artist_id, genre)
        VALUES (:a, :s, :k, :ar, :g)"""),
        {
            "a": account,
            "s": body.session_id,
            "k": body.kind,
            "ar": row.primary_artist_id,
            "g": row.genre or "Other",
        },
    )
    await s.commit()


async def autoplay(c: screens.Ctx, q: AsyncQdrantClient, body: S.AutoplayIn) -> list[uuid.UUID]:
    """v1's autoplay, kept (the owner: it works): CLAP neighbours of the seed, minus the
    seed, the recent (≤ 200), «вода»-locked tracks and tracks under 60 s; at most 2 in a
    row by one artist — the extras are demoted to the tail, used only to fill the list."""
    async with c.sm() as s:
        seed = (
            await s.execute(
                sa.select(tracks.c.media_file_id).where(
                    tracks.c.id == body.seed_track_id, tracks.c.account_id == c.account_id
                )
            )
        ).scalar()
        if seed is None:
            raise NotFound("track")
        locked = {
            str(t)
            for t in await s.scalars(
                sa.text("""
            SELECT track_id FROM (SELECT DISTINCT ON (track_id) track_id, kind, created_at FROM taste_signals
                                  WHERE account_id = :a ORDER BY track_id, created_at DESC) x
            WHERE kind = 'water' AND created_at > now() - interval '1 day'"""),
                {"a": c.account_id},
            )
        }
    try:
        res = await q.query_points(
            TRACKS,
            query=str(seed),
            using="clap",
            limit=max(30, body.limit * 3),
            query_filter=owned_by(c.account_id),
        )
    except UnexpectedResponse as e:
        if e.status_code == 404:  # a seed with no CLAP vector yet: an empty queue, as v1
            return []
        raise
    mfs = [uuid.UUID(str(p.id)) for p in res.points if str(p.id) != str(seed)]
    async with c.sm() as s:
        rows = {
            r.media_file_id: r
            for r in await s.execute(
                sa.select(
                    tracks.c.id,
                    tracks.c.media_file_id,
                    tracks.c.primary_artist_id,
                    tracks.c.duration_ms,
                ).where(
                    tracks.c.account_id == c.account_id,
                    tracks.c.deleted_at.is_(None),
                    tracks.c.media_file_id.in_(mfs),
                )
            )
        }
    skip = {str(body.seed_track_id), *map(str, body.exclude_ids[:200]), *locked}
    cands = [
        (str(rows[m].id), rows[m].primary_artist_id, rows[m].duration_ms) for m in mfs if m in rows
    ]
    return [uuid.UUID(i) for i in autoplay_order(cands, skip, body.limit)]
