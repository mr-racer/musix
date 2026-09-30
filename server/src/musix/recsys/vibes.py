"""«Вайбики» (kept by the owner): up to 3 short-lived mood clusters of what the listener
keeps returning to these days — v1 `stream_service.current_vibes`, ported unchanged.

Positive side: decayed deposits (fires 0.7 on the 1-day clock; full ≥ 85 % listens 0.4
and 65–85 % listens 0.15 on the 2.5-day clock) → the top 30 anchors → a greedy merge
(cosine > 0.80). Negative side: each recent skip / «вода» (≤ 10 days) that sounds like a
vibe (cos ≥ 0.88) presses it down; a vibe whose net weight falls under 0.3 dissolves.
Listens an explicit reaction already spoke for (≤ 30 s after it) do not deposit."""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass, field

import numpy as np

from musix.recsys.outcome import outcome
from musix.recsys.replay import Signal
from musix.recsys.session import Listen

H_VIBE_DAYS, H_REACTION_DAYS = 2.5, 1.0
FIRE_DEPOSIT, FULL_DEPOSIT, MOST_DEPOSIT = 0.7, 0.4, 0.15
POOL_SIZE, MIN_MEMBERS, MERGE_THRESHOLD = 30, 2, 0.80
NEG_SIM, SKIP_PENALTY, WATER_PENALTY, MIN_NET = 0.88, 0.35, 0.6, 0.3
MAX_AGE_DAYS, VIBES_MAX, MEMBERS_MAX = 10.0, 3, 8
GRACE = dt.timedelta(seconds=30)


@dataclass
class Vibe:
    track: str  # the representative (the strongest anchor)
    weight: float
    members: list[str] = field(default_factory=list)


def _decayed(age_days: float, half_life: float) -> float:
    return 1.0 if age_days <= 0 else math.exp(-age_days / half_life)


def _unit(v: np.ndarray) -> np.ndarray | None:
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else None


def vibes(
    listens: list[Listen], signals: list[Signal], clap: dict[str, np.ndarray], now: dt.datetime
) -> list[Vibe]:
    """`clap`: track id → CLAP vector for the tracks involved (anchors and negatives)."""

    def age(t: dt.datetime) -> float:
        return (now - t).total_seconds() / 86400

    cutoff: dict[str, dt.datetime] = {}
    for g in signals:
        cutoff[g.track_id] = max(cutoff.get(g.track_id, g.at), g.at)

    def spoken_for(x: Listen) -> bool:
        c = cutoff.get(x.track_id)
        return c is not None and x.at <= c + GRACE

    w: dict[str, float] = {}
    for g in signals:
        if g.kind == "fire":
            w[g.track_id] = w.get(g.track_id, 0.0) + FIRE_DEPOSIT * _decayed(
                age(g.at), H_REACTION_DAYS
            )
    for x in listens:
        if not x.duration_ms or spoken_for(x):
            continue
        ratio = x.played_ms / x.duration_ms
        dep = FULL_DEPOSIT if ratio >= 0.85 else MOST_DEPOSIT if ratio >= 0.65 else 0.0
        if dep:
            w[x.track_id] = w.get(x.track_id, 0.0) + dep * _decayed(age(x.at), H_VIBE_DAYS)
    anchors = sorted(((t, v) for t, v in w.items() if v > 0 and t in clap), key=lambda tv: -tv[1])[
        :POOL_SIZE
    ]
    kept: list[Vibe] = []
    kept_v: list[np.ndarray] = []
    for t, v in anchors:
        u = _unit(clap[t])
        if u is None:
            continue
        for i, kv in enumerate(kept_v):
            if float(u @ kv) > MERGE_THRESHOLD:
                kept[i].weight += v
                kept[i].members.append(t)
                break
        else:
            kept.append(Vibe(t, v, [t]))
            kept_v.append(u)
    merged = [a for a in kept if len(a.members) >= MIN_MEMBERS]
    negatives: list[tuple[np.ndarray, float]] = []
    for x in listens:  # recent skips press the vibes they sound like
        recent = age(x.at) <= MAX_AGE_DAYS and x.track_id in clap and not spoken_for(x)
        if not (recent and outcome(x.played_ms, x.duration_ms)[0]):
            continue
        if (u := _unit(clap[x.track_id])) is not None:
            negatives.append((u, SKIP_PENALTY * _decayed(age(x.at), H_VIBE_DAYS)))
    for g in signals:  # and so do recent «вода»
        if not (g.kind == "water" and age(g.at) <= MAX_AGE_DAYS and g.track_id in clap):
            continue
        if (u := _unit(clap[g.track_id])) is not None:
            negatives.append((u, WATER_PENALTY * _decayed(age(g.at), H_REACTION_DAYS)))
    scored = []
    for a in merged:
        c = _unit(np.sum([_unit(clap[m]) for m in a.members if m in clap], axis=0))
        if c is None:
            continue
        net = a.weight - sum(p for u, p in negatives if float(u @ c) >= NEG_SIM)
        if net >= MIN_NET:
            scored.append(Vibe(a.track, round(net, 3), a.members[:MEMBERS_MAX]))
    return sorted(scored, key=lambda v: -v.weight)[:VIBES_MAX]
