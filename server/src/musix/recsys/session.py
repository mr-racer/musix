"""Listening sessions: listens split at 30 min of silence (stream spec §2). Used by the
online path (the current session), the jobs (co-listen, genre tolerance) and the replay."""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable, Iterator
from dataclasses import dataclass

GAP = dt.timedelta(minutes=30)


@dataclass(frozen=True)
class Listen:
    track_id: str
    at: dt.datetime
    played_ms: int
    duration_ms: int | None
    artist_id: str | None
    album_id: str | None
    genre: str
    energy: float | None = None
    source: str | None = None


def sessions(listens: Iterable[Listen]) -> Iterator[list[Listen]]:
    """Consecutive runs of `listens` (time-ordered) without a 30-minute gap."""
    cur: list[Listen] = []
    for x in listens:
        if cur and x.at - cur[-1].at > GAP:
            yield cur
            cur = []
        cur.append(x)
    if cur:
        yield cur
