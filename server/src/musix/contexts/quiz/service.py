"""Round lifecycle — v1 `services/quiz/rounds.py`, with its storage on Postgres. The
modes stay pure functions over a snapshot (`musix.quiz`), which is what keeps the
difficulty design testable.

I-1/I-2: nothing here writes a listen or a signal — a snippet is not a play, and the
quiz must not teach «Поток» anything."""

from __future__ import annotations

import datetime as dt
import json
import random as _random
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.intel.sonic import AXIS_NAMES
from musix.contexts.library.slug import song_key
from musix.contexts.quiz.models import quiz_rounds, quiz_skill
from musix.quiz.context import RoundContext, public_options
from musix.quiz.errors import AlreadyAnswered, NoRoundAvailable, RoundNotFound
from musix.quiz.modes import MODES, get_mode
from musix.quiz.selection import (
    MIN_LIBRARY_FOR_ADAPTIVITY,
    familiarity_percentiles,
    next_band,
    update_skill,
)

MIN_POOL = 20  # I-5: a mode stays hidden until the library can support this many rounds
ROUND_TTL_SEC = 120.0
ANTI_REPEAT_DAYS, ANTI_REPEAT_ROUNDS = 30, 50
DEFAULT_SNIPPET_SEC, ALLOWED_SNIPPET_SEC = 3, (3, 5, 10)
SKILL_DEFAULT = {"skill": 0.5, "n_answered": 0, "band_lo": 60.0, "band_hi": 100.0, "out_of_band": 0}
REFERENCE = Path(__file__).resolve().parents[2] / "quiz" / "data" / "axis_norm_reference.json"
SHRINKAGE_PSEUDO_N = 100  # v1: λ = n / (n + 100)

_LIBRARY = sa.text("""
SELECT t.id::text AS track_id, t.title, t.title_display, t.artist_display AS artist, al.title AS album,
       t.year, t.genre, coalesce(t.duration_ms, 0) / 1000.0 AS duration, t.cover_image_id AS cover_art_path,
       pa.slug AS primary_artist_slug, mf.axes AS sonic_axes
FROM tracks t JOIN media_files mf ON mf.id = t.media_file_id
LEFT JOIN albums al ON al.id = t.album_id LEFT JOIN artists pa ON pa.id = t.primary_artist_id
WHERE t.account_id = :a AND t.deleted_at IS NULL
""")
_PLAYS = sa.text("""
SELECT track_id::text, count(*) FILTER (WHERE NOT skipped_early), max(started_at)
FROM listen_events WHERE account_id = :a GROUP BY track_id
""")
_PRODUCERS = sa.text("""
SELECT t.id::text AS track_id, r.target_text FROM tracks t JOIN song_relations r ON r.song_id = t.song_id
WHERE t.account_id = :a AND t.deleted_at IS NULL AND r.kind = 'producer'
ORDER BY t.id, r.source <> 'genius', r.id
""")
_LINKS = sa.text("""
SELECT s.slug AS src_slug, r.target_text, d.slug AS dst_slug,
       CASE WHEN r.kind = 'interpolation' THEN 'interpolation' ELSE 'sample' END AS relation
FROM song_relations r JOIN songs s ON s.id = r.song_id LEFT JOIN songs d ON d.id = r.target_song_id
WHERE r.source = 'facts' AND r.kind IN ('sample', 'interpolation') AND (d.id IS NULL OR d.id <> s.id)
  AND EXISTS (SELECT 1 FROM tracks o WHERE o.account_id = :a AND o.song_id = s.id AND o.deleted_at IS NULL)
""")


@dataclass
class _Snapshot:
    tracks: list[dict[str, Any]]
    plays: dict[str, int]
    last_played: dict[str, float | None]
    percentiles: dict[str, float]
    axis_stats: dict[str, Any] | None
    producers: dict[str, dict[str, Any]]
    sample_links: list[dict[str, Any]]
    now: float


def _axis_stats(tracks: list[dict[str, Any]]) -> dict[str, Any] | None:
    """v1 `blend_axis_stats(collection, reference)`: the account's own axis mean/std,
    shrunk toward v1's reference library by λ = n / (n + 100)."""
    import numpy as np

    rows = [t["sonic_axes"] for t in tracks if isinstance(t.get("sonic_axes"), dict)]
    ref = json.loads(REFERENCE.read_text()) if REFERENCE.exists() else None
    if not rows and ref is None:
        return None
    n = len(rows)
    lam = n / (n + SHRINKAGE_PSEUDO_N)
    mean, std = {}, {}
    for a in AXIS_NAMES:
        vals = np.asarray([r[a] for r in rows if isinstance(r.get(a), int | float)], dtype=float)
        cm, cs = (float(vals.mean()), float(vals.std())) if len(vals) else (0.0, 0.0)
        rm, rs = ((ref or {}).get("mean", {}).get(a, cm), (ref or {}).get("std", {}).get(a, cs))
        mean[a], std[a] = lam * cm + (1 - lam) * rm, lam * cs + (1 - lam) * rs
    return {"mean": mean, "std": std, "n": n, "source": "blend", "lambda": lam}


def _split_credits(names: list[str], cap: int = 3) -> list[str]:
    from musix.assistant.track_credits import split_credit_names

    return split_credit_names(", ".join(names), cap=cap)


async def _snapshot(s: AsyncSession, account_id: uuid.UUID) -> _Snapshot:
    p = {"a": account_id}
    tracks = [dict(r._mapping) for r in await s.execute(_LIBRARY, p)]
    counts, recency = {}, {}
    for tid, n, last in await s.execute(_PLAYS, p):
        counts[tid], recency[tid] = int(n), last.timestamp() if last else None
    ids = [t["track_id"] for t in tracks]
    plays = {i: counts.get(i, 0) for i in ids}
    last_played = {i: recency.get(i) for i in ids}
    now = time.time()
    by_track: dict[str, list[str]] = {}
    for tid, name in await s.execute(_PRODUCERS, p):
        by_track.setdefault(tid, []).append(name)
    producers: dict[str, dict[str, Any]] = {}
    for tid, names in by_track.items():  # v1 producer_index over the effective credit
        for name in _split_credits(names):
            key = " ".join(name.lower().split())
            if key:
                producers.setdefault(key, {"name": name, "tracks": []})["tracks"].append(tid)
    by_slug: dict[str, str] = {}
    for t in tracks:
        if t.get("artist") and t.get("title"):
            by_slug.setdefault(song_key(t["artist"], t["title"]), t["track_id"])
    links = []
    for r in await s.execute(_LINKS, p):
        tid = by_slug.get(r.src_slug)
        if tid:
            artist, _, title = r.target_text.partition(" — ")
            links.append(
                {
                    "src_track_id": tid,
                    "dst_title": title or r.target_text,
                    "dst_artist": artist if title else "",
                    "dst_slug": r.dst_slug,
                    "relation": r.relation,
                }
            )
    return _Snapshot(
        tracks,
        plays,
        last_played,
        familiarity_percentiles(plays, last_played, now),
        _axis_stats(tracks),
        producers,
        links,
        now,
    )


async def _skill(s: AsyncSession, account_id: uuid.UUID, mode: str) -> dict[str, Any]:
    row = (
        await s.execute(
            sa.select(quiz_skill).where(
                quiz_skill.c.account_id == account_id, quiz_skill.c.mode == mode
            )
        )
    ).first()
    if row is None:
        return dict(SKILL_DEFAULT)
    return {
        "skill": row.skill,
        "n_answered": row.n_answered,
        "band_lo": row.band_lo,
        "band_hi": row.band_hi,
        "out_of_band": row.out_of_band,
    }


async def _context(
    s: AsyncSession, snap: _Snapshot, account_id: uuid.UUID, mode: str, rng: Any = None
) -> RoundContext:
    skill = await _skill(s, account_id, mode)
    if len(snap.tracks) < MIN_LIBRARY_FOR_ADAPTIVITY:
        skill = {**skill, "band_lo": 0.0, "band_hi": 100.0}  # v1 spec §16 R-2
    since = dt.datetime.fromtimestamp(snap.now - ANTI_REPEAT_DAYS * 86400, dt.UTC)
    recent: Any = await s.scalars(
        sa.select(quiz_rounds.c.track_id)
        .where(
            quiz_rounds.c.account_id == account_id,
            quiz_rounds.c.mode == mode,
            quiz_rounds.c.created_at >= since,
        )
        .order_by(quiz_rounds.c.created_at.desc())
        .limit(ANTI_REPEAT_ROUNDS)
    )
    return RoundContext(
        collection_name=str(account_id),
        tracks=snap.tracks,
        plays=snap.plays,
        last_played=snap.last_played,
        percentiles=snap.percentiles,
        skill=skill,
        exclude={str(t) for t in recent if t},
        axis_stats=snap.axis_stats,
        producers=snap.producers,
        sample_links=snap.sample_links,
        rng=rng or _random,
        now=snap.now,
    )


def _flags(mode: Any) -> dict[str, Any]:
    return {
        "has_audio": bool(getattr(mode, "HAS_AUDIO", True)),
        "option_audio": bool(getattr(mode, "OPTION_AUDIO", False)),
        "input_kind": str(getattr(mode, "INPUT_KIND", "options")),
    }


async def list_modes(s: AsyncSession, account_id: uuid.UUID) -> list[dict[str, Any]]:
    snap = await _snapshot(s, account_id)
    out = []
    for key, mode in MODES.items():
        size = int(mode.pool_size(await _context(s, snap, account_id, key)))  # type: ignore[attr-defined]
        out.append({"key": key, "pool_size": size, "available": size >= MIN_POOL, **_flags(mode)})
    return out


async def build_round(
    s: AsyncSession, account_id: uuid.UUID, mode: str, snippet_sec: int = DEFAULT_SNIPPET_SEC
) -> dict[str, Any]:
    m = get_mode(mode)
    if m is None:
        raise NoRoundAvailable(f"unknown mode: {mode}")
    snippet_sec = snippet_sec if snippet_sec in ALLOWED_SNIPPET_SEC else DEFAULT_SNIPPET_SEC
    snap = await _snapshot(s, account_id)
    ctx = await _context(s, snap, account_id, mode)
    if m.pool_size(ctx) < MIN_POOL:  # type: ignore[attr-defined]
        raise NoRoundAvailable("not enough material for this mode yet")
    spec = m.build(ctx, snippet_sec=snippet_sec)  # type: ignore[attr-defined]
    expires = dt.datetime.fromtimestamp(snap.now + ROUND_TTL_SEC, dt.UTC)
    rid = await s.scalar(
        sa.insert(quiz_rounds)
        .values(
            account_id=account_id,
            mode=mode,
            track_id=uuid.UUID(spec.track_id) if spec.track_id else None,
            spec=spec.to_stored(),
            expires_at=expires,
        )
        .returning(quiz_rounds.c.id)
    )
    await s.commit()
    return {
        "round_id": rid,
        "mode": mode,
        "options": public_options(spec.options),
        "start_sec": spec.start_sec,
        "length_sec": spec.length_sec,
        "expires_at": expires,
        "meta": spec.meta,
        **_flags(m),
    }


async def submit_answer(
    s: AsyncSession, account_id: uuid.UUID, round_id: uuid.UUID, answer: dict[str, Any]
) -> dict[str, Any]:
    row = (
        await s.execute(
            sa.select(quiz_rounds).where(
                quiz_rounds.c.id == round_id, quiz_rounds.c.account_id == account_id
            )
        )
    ).first()
    if row is None:
        raise RoundNotFound(str(round_id))  # the same for "someone else's": existence is a leak too
    if row.answered_at is not None:
        raise AlreadyAnswered(str(round_id))
    m = get_mode(row.mode)
    if m is None:
        raise RoundNotFound(str(round_id))
    spec = dict(row.spec)
    expired = dt.datetime.now(dt.UTC) > row.expires_at
    correct, score = (False, 0.0) if expired else m.score(spec, answer or {})  # type: ignore[attr-defined]
    done = await s.scalar(
        sa.update(quiz_rounds)
        .where(quiz_rounds.c.id == round_id, quiz_rounds.c.answered_at.is_(None))
        .values(answer=answer or {}, correct=correct, score=score, answered_at=sa.func.now())
        .returning(quiz_rounds.c.id)
    )
    if done is None:
        raise AlreadyAnswered(str(round_id))  # lost a race with a concurrent submission
    snap = await _snapshot(s, account_id)
    if not expired:  # an expired round teaches nothing about skill: the listener walked away
        state = await _skill(s, account_id, row.mode)
        skill = update_skill(float(state["skill"]), correct)
        n = int(state["n_answered"]) + 1
        band, oob = next_band(
            (float(state["band_lo"]), float(state["band_hi"])),
            skill=skill,
            n_answered=n,
            out_of_band=int(state["out_of_band"]),
            library_size=len(snap.tracks),
        )
        vals = {
            "account_id": account_id,
            "mode": row.mode,
            "skill": skill,
            "n_answered": n,
            "band_lo": band[0],
            "band_hi": band[1],
            "out_of_band": oob,
            "updated_at": sa.func.now(),
        }
        await s.execute(
            pg_insert(quiz_skill)
            .values(**vals)
            .on_conflict_do_update(index_elements=["account_id", "mode"], set_=vals)
        )
    await s.commit()
    track = next((t for t in snap.tracks if t["track_id"] == str(row.track_id)), None) or {}
    return {
        "correct": correct,
        "score": score,
        "expired": expired,
        "correct_option_id": spec.get("correct_option_id"),
        "reveal": spec.get("reveal") or {},
        "truth": {
            "track_id": str(row.track_id) if row.track_id else None,
            "title": track.get("title_display") or track.get("title") or "—",
            "artist": track.get("artist") or "—",
            "album": track.get("album"),
            "year": track.get("year"),
            "cover_art_path": track.get("cover_art_path"),
        },
    }


async def round_audio(
    s: AsyncSession, account_id: uuid.UUID, round_id: uuid.UUID, option_id: str | None
) -> str:
    """The file path of the round's snippet (or of one option's track) — v1
    `resolve_round_audio`; the client seeks and stops by itself."""
    from musix.contexts.library.models import media_files, tracks

    row = (
        await s.execute(
            sa.select(quiz_rounds).where(
                quiz_rounds.c.id == round_id, quiz_rounds.c.account_id == account_id
            )
        )
    ).first()
    if row is None:
        raise RoundNotFound(str(round_id))
    tid: Any = row.track_id
    if option_id:
        opt = next(
            (o for o in row.spec.get("options") or [] if o.get("option_id") == option_id), None
        )
        if opt is None or not opt.get("track_id"):
            raise RoundNotFound(str(round_id))
        tid = uuid.UUID(str(opt["track_id"]))
    if tid is None:
        raise RoundNotFound(str(round_id))
    path = await s.scalar(
        sa.select(media_files.c.path)
        .join(tracks, tracks.c.media_file_id == media_files.c.id)
        .where(tracks.c.id == tid, tracks.c.account_id == account_id)
    )
    if not path:
        raise RoundNotFound(str(round_id))
    return str(path)
