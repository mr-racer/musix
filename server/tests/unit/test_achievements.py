"""The achievement rules over a small invented history (screens/achievements.py)."""

import datetime as dt
import uuid

from musix.contexts.screens.achievements import History, evaluate


def _h(events: list[tuple[uuid.UUID, dt.datetime, int, bool]]) -> History:
    al, ar = uuid.uuid4(), uuid.uuid4()
    tracks = {e[0] for e in events}
    return History(
        events=events,
        track={t: (al, ar, 2011, "Song") for t in tracks},
        cover={t: None for t in tracks},
        album={al: ("Album", len(tracks), dt.date(2026, 1, 1), None)},
        artist={ar: ("Artist", "US")},
    )


def test_repeat_and_whole_album_earned_on_the_day() -> None:
    a = uuid.uuid4()
    others = [uuid.uuid4() for _ in range(5)]
    day = dt.datetime(2026, 3, 2, 18, 0)
    ev = [(a, day + dt.timedelta(minutes=4 * i), 200_000, False) for i in range(5)]
    ev += [(t, day + dt.timedelta(minutes=30 + i), 200_000, False) for i, t in enumerate(others)]
    got = {r.rule.code: r for r in evaluate(_h(ev))}
    assert got["repeat"].value == 5 and got["repeat"].first == dt.date(2026, 3, 2)
    assert got["whole"].first == dt.date(2026, 3, 2)  # six songs, all heard that day
    assert got["unwrap"].value == 1  # first heard after the day it came in


def test_streak_skips_and_unearned_progress() -> None:
    t = uuid.uuid4()
    start = dt.datetime(2026, 5, 1, 12, 0)
    ev = [(t, start + dt.timedelta(days=i), 60_000, False) for i in range(8)]
    ev += [(t, start + dt.timedelta(days=8, minutes=i), 5_000, True) for i in range(12)]
    got = {r.rule.code: r for r in evaluate(_h(ev))}
    assert got["week"].first == dt.date(2026, 5, 7) and got["week"].value == 9
    assert got["picky"].value == 12 and got["picky"].first is None
    assert got["marathon"].first is None and got["marathon"].value == 1
