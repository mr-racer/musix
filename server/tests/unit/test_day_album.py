"""«Альбом дня» on the phone's home: the three kinds' candidates and the day's choice."""

import datetime as dt
import uuid

from musix.contexts.screens import day_album as D

UTC = dt.UTC
DAY = dt.date(2026, 11, 13)
START = D.day_start(DAY, 180)
WINDOW = START - dt.timedelta(days=D.WINDOW_DAYS - 1)


def _album(**kw):  # type: ignore[no-untyped-def]
    base = dict(
        id=uuid.uuid4(),
        artist_id=None,
        songs=10,
        plays=0,
        last=None,
        heard=0,
        top_id=None,
        top_plays=0,
        song_plays=0,
    )
    return D.AlbumStat(**{**base, **kw})


def _ago(days: int) -> dt.datetime:
    return START - dt.timedelta(days=days)


def test_day_start_is_the_local_midnight_as_an_utc_instant() -> None:
    assert D.day_start(DAY, 180) == dt.datetime(2026, 11, 12, 21, 0, tzinfo=UTC)
    assert D.day_start(DAY, -300) == dt.datetime(2026, 11, 13, 5, 0, tzinfo=UTC)


def test_long_takes_the_eight_loved_albums_left_the_longest() -> None:
    loved = [_album(plays=8 + i, last=_ago(40 + i)) for i in range(10)]
    recent = _album(plays=30, last=_ago(D.WINDOW_DAYS - 2))  # heard inside the window
    single = _album(plays=30, last=_ago(90), songs=D.MIN_SONGS - 1)
    seven = _album(plays=7, last=_ago(90))
    got = D.candidates([*loved, recent, single, seven], {}, WINDOW)["long"]
    assert [a.id for a in got] == [a.id for a in reversed(loved)][: D.PER_KIND]


def test_one_needs_a_song_on_repeat_and_the_rest_almost_unheard() -> None:
    hit, hot = uuid.uuid4(), uuid.uuid4()
    one = _album(songs=11, heard=2, top_id=hit, top_plays=5, song_plays=6, plays=6)
    hotter = _album(songs=12, heard=1, top_id=hot, top_plays=9, song_plays=9, plays=9)
    shared = _album(songs=11, heard=2, top_plays=4, song_plays=10, plays=10)  # 40 %
    explored = _album(songs=11, heard=5, top_plays=6, song_plays=10, plays=10)
    rare = _album(songs=11, heard=1, top_plays=D.ONE_MIN_PLAYS - 1, song_plays=3, plays=3)
    short = _album(songs=D.MIN_SONGS - 1, heard=1, top_plays=9, song_plays=9, plays=9)
    got = D.candidates([one, hotter, shared, explored, rare, short], {}, WINDOW)["one"]
    assert [a.id for a in got] == [hotter.id, one.id]


def test_never_is_an_unplayed_album_of_an_artist_you_play() -> None:
    star, fan, faint = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    artists = {
        star: D.ArtistStat(plays=120, rank=2, played_ms=9 * 3_600_000),
        fan: D.ArtistStat(plays=33, rank=47, played_ms=7_200_000),
        faint: D.ArtistStat(plays=D.NEVER_MIN_ARTIST_PLAYS - 1, rank=300, played_ms=1),
    }
    by_fan = _album(artist_id=fan)
    by_star = _album(artist_id=star)
    touched = _album(artist_id=star, plays=1, last=_ago(3), heard=1)
    by_faint = _album(artist_id=faint)
    short = _album(artist_id=star, songs=D.MIN_SONGS - 1)
    nobody = _album()
    got = D.candidates([by_fan, by_star, touched, by_faint, short, nobody], artists, WINDOW)
    assert [a.id for a in got["never"]] == [by_star.id, by_fan.id]


def test_choose_rotates_the_kinds_by_day_and_skips_an_empty_kind() -> None:
    cands = {"long": [_album()], "one": [], "never": [_album()]}
    days = [DAY + dt.timedelta(days=i) for i in range(4)]
    kinds = [D.choose(d, cands)[0] for d in days]  # type: ignore[index]
    assert set(kinds) == {"long", "never"}
    assert kinds[0] != kinds[1]
    assert kinds[0] == kinds[2]
    assert D.choose(DAY, cands) == D.choose(DAY, cands)
    assert D.choose(DAY, {"long": [], "one": [], "never": []}) is None


def test_choose_walks_through_a_kinds_candidates_over_the_days() -> None:
    three = [_album(), _album(), _album()]
    picked = {D.choose(DAY + dt.timedelta(days=i), {"long": three})[1].id for i in range(3)}  # type: ignore[index]
    assert picked == {a.id for a in three}
