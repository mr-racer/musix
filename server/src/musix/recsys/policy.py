"""The «Поток» policy (stream spec §3.3–§6): ranked candidates → the next track.

In order, each step narrowing the previous one:
1. hard filters — heard or served today; «вода»-locked; the sound-preset band (relaxed
   only when fewer than 5 candidates would remain);
2. the pool: the preset's pool with the largest deficit over the last 12 served tracks
   (the pool is recorded at serve time, never recomputed);
3. artist rules — not an artist of the last 3 tracks, at most 2 per 10;
4. genre fatigue and cap — leave a genre when its run reaches the listener's tolerance
   or 2 of its last 3 were skipped (unless an «огонёк» holds it), toward an adjacent
   genre not visited in the last 4 transitions, with a small boost for bridges; at most
   5 of one genre per 10 (unless held);
5. exploration — 1 slot in 10 samples the top 30 by a softmax over the score (T 0.5)
   instead of the argmax, and logs its propensity;
6. the highest-scored candidate that passes. Soft rules relax (cap, then artist) before
   the pool is abandoned; a pool that ran dry is labelled `dry:<wanted>-><used>`.
Pure: the same code runs online and inside `tools/recsys-eval`."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np

POLICY_VERSION = "2026-09-30.1"
WINDOW, ARTIST_GAP, ARTIST_PER_10, GENRE_CAP = 12, 3, 2, 5
HOLD_FOR, VISITED_MEMORY, BAND_MIN = 10, 4, 5
EXPLORE_EVERY, EXPLORE_TOP, EXPLORE_T = 10, 30, 0.5
BRIDGE_W, TARGET_W, LESS_LIKE_W = 0.05, 0.1, 0.2
POOLS = ("familiar", "unplayed", "rediscover")


@dataclass
class Item:
    """A candidate as the policy sees it."""

    track: str
    artist: str | None
    genre: str
    energy: float | None
    pools: frozenset[str]
    score: float
    clap: np.ndarray | None = None


@dataclass(frozen=True)
class Recent:
    """A track of the sequence the listener hears: this session's listens, then the
    served tracks still queued."""

    track: str
    artist: str | None
    genre: str
    skipped: bool | None  # None: not heard yet
    held: bool = False  # an «огонёк» on it


@dataclass
class Ctx:
    shares: dict[str, float]
    recent: list[Recent]
    pool_log: list[str]  # the pool of each served track, oldest first
    excluded: set[str]
    tolerance: int = 6
    sound: str | None = None  # "low" | "high": the energy band of a sound preset
    energy_p40: float | None = None
    energy_p60: float | None = None
    genre_vec: dict[str, np.ndarray] = field(default_factory=dict)
    adjacency: float = 1.0
    visited: list[str] = field(default_factory=list)  # genres travelled to, oldest first
    less_like: set[tuple[str, str]] = field(default_factory=set)  # ("artist"|"genre", id)
    explore: bool = False


@dataclass(frozen=True)
class Decision:
    index: int
    pool: str
    trigger: str | None  # "run" | "skips" when a genre fatigue move happened
    target_genre: str | None
    explore: bool
    propensity: float | None


def _band(items: Sequence[Item], ok: np.ndarray, c: Ctx) -> np.ndarray:
    if c.sound is None:
        return ok
    e = np.array([np.nan if x.energy is None else x.energy for x in items])
    if c.sound == "low" and c.energy_p40 is not None:
        m = ok & (e <= c.energy_p40)
    elif c.sound == "high" and c.energy_p60 is not None:
        m = ok & (e >= c.energy_p60)
    else:
        return ok
    return m if m.sum() >= BAND_MIN else ok


def is_explore_slot(served_in_session: int) -> bool:
    return served_in_session % EXPLORE_EVERY == EXPLORE_EVERY - 1


def pick(items: Sequence[Item], c: Ctx, rng: np.random.Generator) -> Decision | None:
    if not items:
        return None
    score = np.array([x.score for x in items], float)
    for i, x in enumerate(items):  # «Меньше такого»: a session down-weight, never a filter
        if (x.artist and ("artist", x.artist) in c.less_like) or ("genre", x.genre) in c.less_like:
            score[i] -= LESS_LIKE_W
    ok = np.array([x.track not in c.excluded for x in items])
    if not ok.any():
        return None
    ok = _band(items, ok, c)

    # artist rules over the sequence the listener hears
    last3 = {r.artist for r in c.recent[-ARTIST_GAP:] if r.artist}
    per10 = Counter(r.artist for r in c.recent[-10:] if r.artist)
    artist_ok = np.array(
        [
            x.artist is None or (x.artist not in last3 and per10[x.artist] < ARTIST_PER_10)
            for x in items
        ]
    )

    # genre: run, recent skips, the «огонёк» hold, the 5/10 cap
    cur = c.recent[-1].genre if c.recent else None
    run = 0
    for r in reversed(c.recent):
        if r.genre != cur:
            break
        run += 1
    in_cur = [r for r in c.recent[-3:] if r.genre == cur]
    skips = sum(1 for r in in_cur if r.skipped)
    held = {r.genre for r in c.recent[-HOLD_FOR:] if r.held}
    g10 = Counter(r.genre for r in c.recent[-10:])
    cap_ok = np.array([x.genre in held or g10[x.genre] < GENRE_CAP for x in items])
    trigger = None
    target = None
    if cur is not None and cur not in held and (run >= c.tolerance or skips >= 2):
        trigger = "run" if run >= c.tolerance else "skips"
        target = _travel(items, score, c, cur)
        if target is not None:
            score = score + TARGET_W * np.array([x.genre == target for x in items])
            if cur in c.genre_vec and target in c.genre_vec:
                score = score + BRIDGE_W * _bridge(items, c.genre_vec[cur], c.genre_vec[target])
            c.visited.append(target)
        cap_ok &= np.array([x.genre != cur for x in items])  # leave the fatigued genre now

    # the pool with the largest deficit over the window; soft rules relax before it is left
    win = c.pool_log[-WINDOW:]
    have = Counter(win)
    need = {k: s * (len(win) + 1) - have[k] for k, s in c.shares.items()}
    order = sorted(need, key=lambda k: -need[k])
    for n_dry, k in enumerate(order):
        in_pool = ok & np.array([k in x.pools for x in items])
        for m in (in_pool & artist_ok & cap_ok, in_pool & artist_ok, in_pool):
            if m.any():
                i, prop = _choose(score, m, c.explore, rng)
                return Decision(
                    i, k if n_dry == 0 else f"dry:{order[0]}->{k}", trigger, target, c.explore, prop
                )
    m = ok & artist_ok & cap_ok
    if not m.any():
        m = ok
    i, prop = _choose(score, m, c.explore, rng)
    return Decision(i, "fallback", trigger, target, c.explore, prop)


def _choose(
    score: np.ndarray, m: np.ndarray, explore: bool, rng: np.random.Generator
) -> tuple[int, float | None]:
    masked = np.where(m, score, -np.inf)
    if not explore:
        return int(np.argmax(masked)), None
    top = np.argsort(-masked)[: min(EXPLORE_TOP, int(m.sum()))]
    z = score[top] / EXPLORE_T
    p = np.exp(z - z.max())
    p /= p.sum()
    k = int(rng.choice(len(top), p=p))
    return int(top[k]), float(p[k])


def _travel(items: Sequence[Item], score: np.ndarray, c: Ctx, cur: str) -> str | None:
    """The adjacent genre (centroid cosine above the library's p70), not visited in the
    last 4 transitions, weighted by the ranker's mean score for its candidates."""
    if cur not in c.genre_vec:
        return None
    here = c.genre_vec[cur]
    options = [
        g
        for g, v in c.genre_vec.items()
        if g != cur and float(v @ here) > c.adjacency and g not in c.visited[-VISITED_MEMORY:]
    ]
    if not options:
        options = [
            g
            for g, _ in sorted(
                ((g, float(v @ here)) for g, v in c.genre_vec.items() if g != cur),
                key=lambda gs: -gs[1],
            )[:3]
        ]
    best, best_s = None, -np.inf
    for g in options:
        s = [score[i] for i, x in enumerate(items) if x.genre == g]
        if s and float(np.mean(s)) > best_s:
            best, best_s = g, float(np.mean(s))
    return best


def _bridge(items: Sequence[Item], a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """z-scored min(sim to the current genre, sim to the target): sounds like both."""
    v = np.array(
        [min(float(x.clap @ a), float(x.clap @ b)) if x.clap is not None else np.nan for x in items]
    )
    if np.isnan(v).all():
        return np.zeros(len(items))
    v = np.nan_to_num(v, nan=np.nanmean(v))
    z: np.ndarray = (v - v.mean()) / (v.std() + 1e-6)
    return z


def pools_of(fulls: int, fires: int, listens: int, days_since: float | None) -> frozenset[str]:
    """familiar = positive (a full hearing or an «огонёк») within 60 days; rediscover =
    positive but not in 60 days; unplayed = never played (stream spec §4)."""
    if listens == 0:
        return frozenset({"unplayed"})
    positive = fulls > 0 or fires > 0
    if not positive:
        return frozenset()
    return frozenset({"rediscover" if (days_since is None or days_since > 60) else "familiar"})
