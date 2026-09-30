"""Replay an account's history in time order, freezing what the engine could have known
just before each listen (no leakage) — the training set — and the state "now", which
must equal what the online path reads from the database (the parity test).

The accumulators here are the in-memory twins of account_track/artist/genre_stats and
of the session read by the online path."""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field

from musix.recsys.features import Account, Cand, SessItem
from musix.recsys.outcome import outcome, weight
from musix.recsys.session import GAP, Listen

FIRE_BEFORE, FIRE_AFTER = dt.timedelta(minutes=10), dt.timedelta(hours=6)


@dataclass(frozen=True)
class Signal:
    track_id: str
    at: dt.datetime
    kind: str  # fire | water


@dataclass
class TrackMeta:
    artist: str | None
    album: str | None
    genre: str
    dur_s: float | None
    energy: float | None
    axes: dict[str, float]
    added_at: dt.datetime | None


@dataclass
class Row:
    """One training example: the candidate as it looked just before it was played."""

    at: dt.datetime
    session: int
    cand: Cand
    acc: Account
    sess: list[SessItem]
    skip: bool
    full: bool
    fired: bool
    watered: bool


@dataclass
class State:
    meta: dict[str, TrackMeta]
    t_n: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    t_full: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    t_skip: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    t_last: dict[str, dt.datetime] = field(default_factory=dict)
    a_n: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    a_full: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    a_skip: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    a_last: dict[str, dt.datetime] = field(default_factory=dict)
    g_n: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    fires: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    waters: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    listens: int = 0
    fulls: int = 0
    sess: list[SessItem] = field(default_factory=list)
    sess_last: dt.datetime | None = None
    sess_no: int = 0

    def account(self) -> Account:
        return Account(self.listens, self.fulls, dict(self.g_n))

    def cand(self, track: str, now: dt.datetime) -> Cand:
        m = self.meta[track]

        def days(t: dt.datetime | None) -> float | None:
            return (now - t).total_seconds() / 86400 if t else None

        a = m.artist
        return Cand(
            track=track,
            artist=a,
            album=m.album,
            genre=m.genre,
            dur_s=m.dur_s,
            energy=m.energy,
            axes=m.axes,
            listens=self.t_n[track],
            fulls=self.t_full[track],
            quick_skips=self.t_skip[track],
            days_since=days(self.t_last.get(track)),
            fires=self.fires[track],
            waters=self.waters[track],
            days_in_lib=days(m.added_at),
            a_listens=self.a_n[a] if a else 0,
            a_fulls=self.a_full[a] if a else 0,
            a_quick_skips=self.a_skip[a] if a else 0,
            a_days_since=days(self.a_last.get(a)) if a else None,
        )

    def session(self, now: dt.datetime) -> list[SessItem]:
        """The current listening session as of `now` (empty after 30 min of silence)."""
        if self.sess_last is None or now - self.sess_last > GAP:
            return []
        return list(self.sess)

    def apply(self, x: Listen, fired: bool) -> None:
        skip, full = outcome(x.played_ms, x.duration_ms)
        m = self.meta[x.track_id]
        if self.sess_last is not None and x.at - self.sess_last > GAP:
            self.sess = []
            self.sess_no += 1
        self.sess.append(
            SessItem(
                x.track_id,
                m.artist,
                m.album,
                m.genre,
                weight(x.played_ms, x.duration_ms, fired),
                m.energy,
            )
        )
        self.sess_last = x.at
        t, a = x.track_id, m.artist
        self.t_n[t] += 1
        self.t_full[t] += full
        self.t_skip[t] += skip
        self.t_last[t] = max(self.t_last.get(t, x.at), x.at)
        if a:
            self.a_n[a] += 1
            self.a_full[a] += full
            self.a_skip[a] += skip
            self.a_last[a] = max(self.a_last.get(a, x.at), x.at)
        self.g_n[m.genre] += 1
        self.listens += 1
        self.fulls += full


def fired_plays(listens: list[Listen], signals: Iterable[Signal]) -> dict[int, set[str]]:
    """listen index → the signal kinds that belong to it: the latest play of that track
    at or before the signal (within 6 h; a tap 10 min early still counts)."""
    by_track: dict[str, list[int]] = defaultdict(list)
    for i, x in enumerate(listens):
        by_track[x.track_id].append(i)
    out: dict[int, set[str]] = defaultdict(set)
    for g in signals:
        cand = [
            i
            for i in by_track.get(g.track_id, [])
            if listens[i].at - FIRE_BEFORE <= g.at <= listens[i].at + FIRE_AFTER
        ]
        if cand:
            out[max(cand, key=lambda i: listens[i].at)].add(g.kind)
    return out


def replay(
    meta: dict[str, TrackMeta], listens: list[Listen], signals: list[Signal]
) -> Iterator[tuple[State, Row | None]]:
    """Yields (state, row) per listen, the row taken BEFORE the listen is applied.
    Signals enter the state at their own time. The last yielded state is "now"."""
    st = State(meta)
    tags = fired_plays(listens, signals)
    sig = sorted(signals, key=lambda g: g.at)
    k = 0
    for i, x in enumerate(listens):
        while k < len(sig) and sig[k].at < x.at:
            (st.fires if sig[k].kind == "fire" else st.waters)[sig[k].track_id] += 1
            k += 1
        if x.track_id not in meta:
            continue
        skip, full = outcome(x.played_ms, x.duration_ms)
        no = st.sess_no + int(st.sess_last is not None and x.at - st.sess_last > GAP)
        row = Row(
            x.at,
            no,
            st.cand(x.track_id, x.at),
            st.account(),
            st.session(x.at),
            skip,
            full,
            "fire" in tags.get(i, ()),
            "water" in tags.get(i, ()),
        )
        yield st, row
        st.apply(x, "fire" in tags.get(i, ()))
    while k < len(sig):
        (st.fires if sig[k].kind == "fire" else st.waters)[sig[k].track_id] += 1
        k += 1
    yield st, None
