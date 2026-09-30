"""The autoplay queue's order (v1 `autoplay_service._apply_filters`, kept because the
owner says it works): the seed's CLAP neighbours in order, minus the seed, the excluded
(recent ≤ 200, «вода»-locked) and tracks under 60 s; a third track in a row by one
artist is demoted to the tail and only used to fill the list."""

from __future__ import annotations

from collections.abc import Hashable, Iterable

MIN_MS = 60_000


def order[K: Hashable](
    cands: Iterable[tuple[K, Hashable, int | None]], skip: set[K], limit: int
) -> list[K]:
    """cands: (id, artist, duration_ms) best first."""
    main: list[K] = []
    tail: list[K] = []
    last: list[Hashable] = []
    for key, artist, dur in cands:
        if key in skip or (dur is not None and 0 < dur < MIN_MS):
            continue
        if len(last) >= 2 and last[-1] == artist and last[-2] == artist:
            tail.append(key)
            continue
        main.append(key)
        last = [*last[-1:], artist]
        if len(main) >= limit:
            break
    return (main + tail)[:limit]
