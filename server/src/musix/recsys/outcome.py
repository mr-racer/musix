"""What a listen said, for the recommender (stream spec §2): the ONE definition.

- quick skip: under 30 s — or, on a track shorter than 2 min, under a quarter of it;
- full: heard to ≥ 85 % and not a quick skip.
The listen CTE (`contexts/listening/service.py`) computes the same in SQL; the replay
test holds the two together. The session weights are the offline study's."""

from __future__ import annotations

SKIP_S, SHORT_TRACK_S, SHORT_SHARE, FULL_SHARE = 30_000, 120_000, 0.25, 0.85
W_SKIP, W_FULL, W_MOST, W_FIRE = -0.6, 0.4, 0.25, 1.0


def outcome(played_ms: int, duration_ms: int | None) -> tuple[bool, bool]:
    """(quick_skip, full)."""
    dur = duration_ms or 0
    qskip = played_ms < SHORT_SHARE * dur if 0 < dur < SHORT_TRACK_S else played_ms < SKIP_S
    return qskip, (not qskip) and dur > 0 and played_ms >= FULL_SHARE * dur


def weight(played_ms: int, duration_ms: int | None, fired: bool = False) -> float:
    """The session weight of a listen: negative for a skip, positive for a full hearing."""
    qskip, _ = outcome(played_ms, duration_ms)
    ratio = played_ms / duration_ms if duration_ms else 0.0
    w = W_SKIP if qskip else W_FULL if ratio >= FULL_SHARE else W_MOST if ratio >= 0.65 else 0.0
    return max(w, 0.0) if fired else w
