"""«Альбом дня» on the phone's home (r3, 2026-11-13).

One album a day, the same on every device. The candidates come from the listens made
before the local day began, so playing the pick never swaps it in the middle of the day.
Three kinds take turns by the day; a kind with no candidates is skipped:

- «long»: loved and left. 8+ plays, nothing played in the last 30 days, the longest untouched;
- «one»: a song on repeat. It holds half of the album's plays, the rest is almost unheard;
- «never»: an album never played, by an artist the account does play.

The thresholds were fitted on the owner's library on 2026-11-13 (47 / 5 / 8 candidates).
Progress belongs to the album: a song is heard when half of it, or four minutes, was played
(a scrobble) in the last 30 local days, so a «long» or «never» pick starts at zero.
Songs of a minute or less (skits, intros) never count. The phrases are the client's."""

from __future__ import annotations

import asyncio
import datetime as dt
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Literal

import sqlalchemy as sa

from musix.contexts.library.models import albums
from musix.contexts.screens import schemas as S
from musix.contexts.screens.service import Ctx, album_cards

Kind = Literal["long", "one", "never"]
KINDS: tuple[Kind, ...] = ("long", "one", "never")
SKIT_MS = 60_000  # a song of a minute or less is a skit
MIN_SONGS = 4  # an album, not a single
PER_KIND = 8  # the candidates a kind walks through, day by day
WINDOW_DAYS = 30  # the local days a heard song stays heard
HEARD_MS = 240_000  # four minutes are a scrobble whatever the length
LONG_MIN_PLAYS = 8  # the old `day_pick`'s «loved»
ONE_MIN_PLAYS = 4  # the song on repeat
NEVER_MIN_ARTIST_PLAYS = 10  # an artist the account plays


@dataclass(frozen=True)
class AlbumStat:
    """An album of the account, as it stood when the day began."""

    id: uuid.UUID
    artist_id: uuid.UUID | None
    songs: int  # its tracks longer than a minute
    plays: int  # of all its tracks
    last: dt.datetime | None  # its last play
    heard: int  # songs played at least once
    top_id: uuid.UUID | None  # its most played song
    top_plays: int
    song_plays: int  # plays of its songs, skits aside


@dataclass(frozen=True)
class ArtistStat:
    plays: int  # of the songs where the artist is a main one
    rank: int  # among the library's artists by plays, 1 = the most played
    played_ms: int


def day_start(day: dt.date, tz: int) -> dt.datetime:
    """The local midnight of `day` as an UTC instant; `tz` is the offset in minutes."""
    return dt.datetime.combine(day, dt.time(), tzinfo=dt.UTC) - dt.timedelta(minutes=tz)


def candidates(
    stats: Iterable[AlbumStat], artists: Mapping[uuid.UUID, ArtistStat], window_start: dt.datetime
) -> dict[Kind, list[AlbumStat]]:
    full = [a for a in stats if a.songs >= MIN_SONGS]

    def fan(a: AlbumStat) -> ArtistStat | None:
        s = artists.get(a.artist_id) if a.artist_id else None
        return s if s is not None and s.plays >= NEVER_MIN_ARTIST_PLAYS else None

    left = [
        a
        for a in full
        if a.plays >= LONG_MIN_PLAYS and a.last is not None and a.last < window_start
    ]
    one = [
        a
        for a in full
        if a.top_plays >= ONE_MIN_PLAYS
        and 2 * a.top_plays >= a.song_plays
        and a.heard <= max(2, a.songs // 4)
    ]
    never = [(s.rank, a) for a in full if a.plays == 0 and (s := fan(a)) is not None]
    return {
        "long": sorted(left, key=lambda a: (a.last, a.id))[:PER_KIND],
        "one": sorted(one, key=lambda a: (-a.top_plays, a.id))[:PER_KIND],
        "never": [a for _, a in sorted(never, key=lambda r: (r[0], r[1].id))][:PER_KIND],
    }


def choose(day: dt.date, cands: Mapping[Kind, list[AlbumStat]]) -> tuple[Kind, AlbumStat] | None:
    """The kinds take turns by the day; within a kind the day walks through its candidates."""
    n = day.toordinal()
    kinds = [k for k in KINDS if cands.get(k)]
    if not kinds:
        return None
    kind = kinds[n % len(kinds)]
    pool = cands[kind]
    return kind, pool[(n // len(kinds)) % len(pool)]


# The account's listens before the day, per track: plays as v1 counts them (not skipped
# early, the same as account_track_stats.plays) and the time heard.
_BEFORE = """
WITH ev AS (
  SELECT track_id,
         count(*) FILTER (WHERE NOT skipped_early) AS plays,
         max(started_at) FILTER (WHERE NOT skipped_early) AS last,
         sum(played_ms) AS ms
  FROM listen_events WHERE account_id = :a AND started_at < :d0 GROUP BY track_id
), tr AS (
  SELECT t.id, t.album_id, coalesce(t.duration_ms, 0) > :skit AS ok,
         coalesce(ev.plays, 0) AS plays, ev.last, coalesce(ev.ms, 0) AS ms
  FROM tracks t LEFT JOIN ev ON ev.track_id = t.id
  WHERE t.account_id = :a AND t.deleted_at IS NULL
)"""
_ALBUMS = sa.text(
    _BEFORE
    + """
SELECT tr.album_id AS id, al.album_artist_id AS artist_id,
       count(*) FILTER (WHERE ok) AS songs, sum(plays) AS plays, max(last) AS last,
       count(*) FILTER (WHERE ok AND plays > 0) AS heard,
       (array_agg(tr.id ORDER BY plays DESC, tr.id) FILTER (WHERE ok))[1] AS top_id,
       coalesce(max(plays) FILTER (WHERE ok), 0) AS top_plays,
       coalesce(sum(plays) FILTER (WHERE ok), 0) AS song_plays
FROM tr JOIN albums al ON al.id = tr.album_id
GROUP BY tr.album_id, al.album_artist_id
"""
)
_ARTISTS = sa.text(
    _BEFORE  # noqa: S608 — constants, not input
    + """, per AS (
  SELECT ta.artist_id, sum(tr.plays) AS p, sum(tr.ms) AS ms
  FROM tr JOIN track_artists ta ON ta.track_id = tr.id AND ta.role = 'main'
  GROUP BY ta.artist_id
)
SELECT artist_id, p, ms, rank() OVER (ORDER BY p DESC) AS r FROM per WHERE p > 0
"""
)
# The pick's songs in the album page's order; heard = a scrobble inside the window.
_TRACKS = sa.text("""
SELECT t.id, coalesce(nullif(t.title_display, ''), t.title) AS title, t.duration_ms,
       t.disc_no, t.track_no,
       EXISTS (
         SELECT 1 FROM listen_events e
         WHERE e.account_id = :a AND e.track_id = t.id AND e.started_at >= :w
           AND (e.played_ms >= :heard
                OR 2 * e.played_ms >= coalesce(nullif(e.duration_ms, 0), t.duration_ms))
       ) AS heard
FROM tracks t
WHERE t.account_id = :a AND t.deleted_at IS NULL AND t.album_id = :album
ORDER BY t.disc_no NULLS FIRST, t.track_no NULLS LAST, t.title
""")


async def pick(c: Ctx, tz: int, today: dt.date) -> S.DayAlbumOut | None:
    d0 = day_start(today, tz)
    w0 = d0 - dt.timedelta(days=WINDOW_DAYS - 1)
    args = {"a": c.account_id, "d0": d0, "skit": SKIT_MS}
    album_rows, artist_rows = await asyncio.gather(
        c.run(lambda s: s.execute(_ALBUMS, args)), c.run(lambda s: s.execute(_ARTISTS, args))
    )
    stats = [
        AlbumStat(
            id=r.id,
            artist_id=r.artist_id,
            songs=int(r.songs),
            plays=int(r.plays),
            last=r.last,
            heard=int(r.heard),
            top_id=r.top_id,
            top_plays=int(r.top_plays),
            song_plays=int(r.song_plays),
        )
        for r in album_rows
    ]
    by_artist = {
        r.artist_id: ArtistStat(plays=int(r.p), rank=int(r.r), played_ms=int(r.ms))
        for r in artist_rows
    }
    chosen = choose(today, candidates(stats, by_artist, w0))
    if chosen is None:
        return None
    kind, a = chosen
    cards, rows = await asyncio.gather(
        album_cards(c, albums.c.id == a.id),
        c.run(
            lambda s: s.execute(
                _TRACKS, {"a": c.account_id, "w": w0, "heard": HEARD_MS, "album": a.id}
            )
        ),
    )
    if not cards:
        return None
    artist = by_artist.get(a.artist_id) if a.artist_id else None
    return S.DayAlbumOut(
        kind=kind,
        day=today,
        album=cards[0],
        tracks=[
            S.DayAlbumTrack(
                id=r.id,
                title=r.title,
                duration_ms=r.duration_ms,
                disc_no=r.disc_no,
                track_no=r.track_no,
                heard=bool(r.heard),
            )
            for r in rows
        ],
        plays=a.plays,
        last_played_at=a.last,
        song_id=a.top_id if a.top_plays > 0 else None,
        song_plays=a.top_plays,
        artist_rank=artist.rank if artist else None,
        artist_plays=artist.plays if artist else 0,
        artist_played_min=artist.played_ms // 60_000 if artist else 0,
        other_albums_heard=sum(
            1 for o in stats if o.artist_id == a.artist_id and o.id != a.id and o.plays > 0
        )
        if a.artist_id
        else 0,
    )
