"""The ranker's features (stream spec §3.2) — ONE function, used by serving, training
and `tools/recsys-eval` alike. Candidate-varying only: a feature that is constant at the
decision moment (the hour, "the listener is skipping right now") cannot re-order
candidates, and letting it in inflated the offline AUC. No track, artist or user ids:
the model learns HOW people listen, not WHAT, so one model serves every account.

Definitions are the offline study's (`tools/recsys-eval` replay), smoothed toward the
account's own completion prior."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np

NEVER = 999.0  # days, for "never" (the study's encoding)
AXES = ("vocal_lead", "spacious", "experimental", "brightness", "acousticness")
FEATURES: tuple[str, ...] = (
    "t_plays",
    "t_full_rate",
    "t_skip_rate",
    "t_days_since",
    "t_fire",
    "t_water",
    "t_days_in_lib",
    "a_plays",
    "a_full_rate",
    "a_skip_rate",
    "a_days_since",
    "a_in_sess",
    "a_prev_same",
    "album_cont",
    "g_long_share",
    "g_sess_share",
    "g_run",
    "g_sess_skips",
    "g_sess_full",
    "dur",
    "energy",
    "energy_dev",
    *(f"ax_{a}" for a in AXES),
)


@dataclass
class Account:
    listens: int = 0
    fulls: int = 0
    genre_listens: dict[str, int] = field(default_factory=dict)

    @property
    def prior(self) -> float:
        return (self.fulls + 2) / (self.listens + 4)


@dataclass
class Cand:
    track: str
    artist: str | None
    album: str | None
    genre: str
    dur_s: float | None
    energy: float | None
    axes: dict[str, float]
    listens: int = 0
    fulls: int = 0
    quick_skips: int = 0
    days_since: float | None = None
    fires: int = 0
    waters: int = 0
    days_in_lib: float | None = None
    a_listens: int = 0
    a_fulls: int = 0
    a_quick_skips: int = 0
    a_days_since: float | None = None


@dataclass(frozen=True)
class SessItem:
    track: str
    artist: str | None
    album: str | None
    genre: str
    w: float  # < 0 a skip, > 0 heard well (musix.recsys.outcome.weight)
    energy: float | None


def _nan(v: float | None) -> float:
    return np.nan if v is None else float(v)


def matrix(acc: Account, sess: Sequence[SessItem], cands: Sequence[Cand]) -> np.ndarray:
    """(len(cands), len(FEATURES)) float64, columns in FEATURES order."""
    prior = acc.prior
    g_total = max(1, sum(acc.genre_listens.values()))
    s_art = [x.artist for x in sess]
    s_gen = [x.genre for x in sess]
    last = sess[-1] if sess else None
    recent6 = sess[-6:]
    e5 = [x.energy for x in sess[-5:] if x.energy is not None]
    e_mean = float(np.mean(e5)) if e5 else None
    runs: dict[str, int] = {}
    out = np.empty((len(cands), len(FEATURES)))
    for i, c in enumerate(cands):
        if c.genre not in runs:
            r = 0
            for g in reversed(s_gen):
                if g != c.genre:
                    break
                r += 1
            runs[c.genre] = r
        out[i] = (
            c.listens,
            (c.fulls + 2 * prior) / (c.listens + 2),
            (c.quick_skips + 2 * (1 - prior) * 0.3) / (c.listens + 2),
            NEVER if c.days_since is None else c.days_since,
            c.fires,
            c.waters,
            NEVER if c.days_in_lib is None else c.days_in_lib,
            c.a_listens,
            (c.a_fulls + 3 * prior) / (c.a_listens + 3),
            (c.a_quick_skips + 1) / (c.a_listens + 4),
            NEVER if c.a_days_since is None else c.a_days_since,
            s_art.count(c.artist) if c.artist else 0,
            int(last is not None and c.artist is not None and last.artist == c.artist),
            int(last is not None and c.album is not None and last.album == c.album),
            acc.genre_listens.get(c.genre, 0) / g_total,
            s_gen.count(c.genre) / max(1, len(s_gen)),
            runs[c.genre],
            sum(1 for x in recent6 if x.genre == c.genre and x.w < 0),
            sum(1 for x in recent6 if x.genre == c.genre and x.w > 0),
            _nan(c.dur_s),
            _nan(c.energy),
            abs(c.energy - e_mean) if c.energy is not None and e_mean is not None else np.nan,
            *(_nan(c.axes.get(a)) for a in AXES),
        )
    return out
