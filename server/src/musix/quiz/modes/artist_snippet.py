"""«Угадай <артиста> за 3 секунды» — the artist page's quiz card (2026-10-17).

A snippet of one of the artist's songs plays; the four options are all that artist's
songs, so the round asks which one, not whose. The answer leans to songs the listener
has heard (weighted by plays, the unheard still possible); the anti-repeat window gives
way before the pool runs dry, because an artist may have only a dozen songs.
"""

from __future__ import annotations

import math

from musix.quiz.context import RoundContext, RoundSpec
from musix.quiz.errors import NoRoundAvailable
from musix.quiz.modes.track_snippet import _option
from musix.quiz.snippet import start_point

KEY = "artist_snippet"
HAS_AUDIO = True
OPTION_COUNT = 4
MIN_POOL = OPTION_COUNT  # four of the artist's songs make an honest round


def _pool(ctx: RoundContext) -> list[dict]:
    if not ctx.artist_id:
        return []
    return [t for t in ctx.tracks if t.get("primary_artist_id") == ctx.artist_id and t.get("title")]


def pool_size(ctx: RoundContext) -> int:
    return len(_pool(ctx))


def build(ctx: RoundContext, *, snippet_sec: int) -> RoundSpec:
    pool = _pool(ctx)
    if len(pool) < OPTION_COUNT:
        raise NoRoundAvailable("the artist has fewer than four songs in the library")
    fresh = [t for t in pool if t["track_id"] not in ctx.exclude] or pool

    def weight(t: dict) -> float:
        return 1.0 + 2.0 * math.log1p(ctx.plays.get(t["track_id"], 0))

    answer = max(fresh, key=lambda t: ctx.rng.random() ** (1.0 / weight(t)))  # type: ignore[attr-defined]
    title = (answer.get("title_display") or answer.get("title") or "").casefold()
    others = [
        t
        for t in pool
        if t["track_id"] != answer["track_id"]
        and (t.get("title_display") or t.get("title") or "").casefold() != title
    ]
    if len(others) < OPTION_COUNT - 1:
        raise NoRoundAvailable("not enough distinct titles by the artist")
    ctx.rng.shuffle(others)  # type: ignore[attr-defined]
    options = [_option(t) for t in [answer, *others[: OPTION_COUNT - 1]]]
    correct = options[0]["option_id"]
    ctx.rng.shuffle(options)  # type: ignore[attr-defined]
    return RoundSpec(
        mode=KEY,
        track_id=answer["track_id"],
        options=options,
        correct_option_id=correct,
        start_sec=start_point(answer, snippet_sec, ctx.rng),
        length_sec=float(snippet_sec),
    )


def score(spec: dict, answer: dict) -> tuple[bool, float]:
    chosen = (answer or {}).get("option_id")
    correct = bool(chosen) and chosen == spec.get("correct_option_id")
    return correct, 100.0 if correct else 0.0
