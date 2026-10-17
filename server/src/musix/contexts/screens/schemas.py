"""Screen-level shapes (BFF, spec §6). Each carries an `images` side-table: every image
the screen references, once, keyed by id."""

import datetime as dt
import uuid
from typing import Any, Literal

from pydantic import Field

from musix.contexts.knowledge.schemas import FactOut, TrackKnowledge
from musix.contexts.library.schemas import TrackOut
from musix.contexts.media.schemas import ImageData
from musix.contexts.playlists.schemas import PlaylistOut
from musix.schemas import Model


class ArtistRef(Model):
    id: uuid.UUID
    name: str


class ArtistOut(ArtistRef):
    sort_name: str | None
    image_id: str | None
    cutout_id: str | None = None  # a transparent PNG of the artist (the hero's figure)


class AlbumOut(Model):
    id: uuid.UUID
    title: str
    year: int | None
    original_year: int | None = None  # MusicBrainz's first release when `year` is a reissue's
    album_artist: ArtistRef | None
    cover_image_id: str | None
    track_count: int  # the account's own tracks in it
    duration_ms: int


class Counts(Model):
    tracks: int
    albums: int
    artists: int
    playlists: int


class VibeOut(Model):
    """A «вайбик»: tapping it plays /stream/autoplay seeded by the first track."""

    id: uuid.UUID  # the representative track
    weight: float
    name: str | None  # the AI name, once the knowledge base has one
    tracks: list[TrackOut]  # representative first


class WeeklyPulse(Model):
    """This local week (Monday..now): time listened, top genre, first-ever listens. The
    web's home shows the last seven days instead (`last7_ms`, oldest..today) with the
    listening streak; `daily_ms` stays Monday..Sunday for the phone."""

    played_ms: int
    top_genre: str | None
    discoveries: int
    daily_ms: list[int]  # Monday..Sunday
    last7_ms: list[int] = Field(default_factory=list)  # the last seven local days, today last
    last7_played_ms: int = 0
    streak_current: int = 0  # consecutive days to local today (yesterday counts as grace)


class AlbumPick(Model):
    """«Поставить альбом»: v1's library rail (screens/picks.py). The vibe is the reason."""

    album: AlbumOut
    vibe_id: uuid.UUID  # the vibe's representative track
    vibe_name: str | None
    score: float  # cosine(vibe centroid, album mean CLAP)


class WeatherOut(Model):
    kind: Literal["clear", "cloudy", "rain", "snow"]
    code: int  # WMO
    temperature_c: float | None
    at: dt.datetime


class PlaceOut(Model):
    """A city for the settings' weather place, as Open-Meteo's geocoding names it."""

    name: str
    country: str | None
    admin: str | None  # the region
    lat: float
    lon: float
    timezone: str | None = None  # IANA: the settings' little sky shows its local hour


class WaveOut(Model):
    phrase: str
    source: str  # ai | fallback


class HomeOut(Model):
    recent: list[TrackOut]  # last played first
    recently_added: list[TrackOut]
    anchors: list[TrackOut] = Field(default_factory=list)  # «якоря вкуса»: up to 5, one per artist
    playlists: list[PlaylistOut]
    counts: Counts
    vibes: list[VibeOut]
    wave: WaveOut | None  # the «Поток» hero phrase
    pulse: WeeklyPulse
    album_picks: list[AlbumPick] = Field(default_factory=list)
    weather: WeatherOut | None = None  # the instance's place, when one is configured
    images: dict[str, ImageData]


class TrackPlays(Model):
    track: TrackOut
    plays: int


class ArtistPlays(Model):
    artist: ArtistOut
    plays: int


class Listening(Model):
    played_ms: int
    since: dt.datetime | None
    top_track: TrackPlays | None  # most non-skipped listens
    top_artist: ArtistPlays | None
    peak_hour: int | None  # local hour with most non-skipped listens


class DayCount(Model):
    date: dt.date  # local
    count: int


class BusiestDay(DayCount):
    top_track: TrackPlays | None


class Rhythm(Model):
    days: list[DayCount]
    by_hour: list[int]  # 24, local
    streak_current: int  # consecutive days to local today (yesterday counts as grace)
    streak_best: int
    busiest_day: BusiestDay | None


class EngagedTrack(Model):
    track: TrackOut
    plays: int
    completion: float  # mean of min(played / duration, 1)
    finishes: int  # ≥ 90 % of the duration
    skips: int
    skip_seconds: float | None  # mean seconds heard before a skip


class Engagement(Model):
    overall_completion: float
    loved: list[EngagedTrack]  # finished most (≥ 2)
    guilty: list[EngagedTrack]  # dropped fastest (≥ 3 skips, typically < 10 s)


class Share(Model):
    key: str  # a genre, a format label, or a duration range in seconds ("180-240")
    count: int
    pct: int


class DecadeShare(Model):
    decade: int
    count: int
    pct: int


class ArtistShare(Model):
    artist: ArtistOut
    count: int
    pct: int


class Collection(Model):
    """«Карта коллекции» (v1 `DistributionsPanel`): what the library is made of — not what
    is played. v1's definitions: top 5 genres, its six IQR duration buckets (commonest
    first), top 5 artists by tracks, formats by file extension with the lossless share."""

    decades: list[DecadeShare]
    genres: list[Share]
    durations: list[Share]
    artists: list[ArtistShare]
    formats: list[Share]
    lossless_pct: int


class AchievementOut(Model):
    """One of the ten rules (screens/achievements.py): its best value so far, and the local day
    it was first reached (none: not earned yet). `note` says the record in words."""

    code: str
    name: str
    line: str
    target: float
    unit: str
    value: float
    earned_on: dt.date | None
    note: str | None
    cover_image_id: str | None


class FavouriteArtist(Model):
    artist: ArtistOut
    plays: int
    hours: float
    share: float  # % of all listening time


class YearCount(Model):
    year: int
    tracks: int


class StatsExtra(Model):
    """What the redesigned statistics tab adds (design/code/screens/library.md)."""

    artists: list[FavouriteArtist]  # the top three
    tracks: list[TrackPlays]  # the top three
    years: list[YearCount]  # the library's songs per year
    countries: list[Share]  # the artists' countries by listening time (key: ISO code)
    genres: list[Share]  # by listening time
    decades: list[DecadeShare]  # by listening time
    avg_day_ms: int  # per day with music
    finished_pct: int  # listens not skipped early
    achievements: list[AchievementOut]


class StatsOut(Model):
    listening: Listening
    rhythm: Rhythm
    engagement: Engagement
    images: dict[str, ImageData]
    collection: Collection | None = None
    extra: StatsExtra | None = None


class MapCluster(Model):
    id: int
    name_ru: str
    name_en: str
    size: int
    cx: float
    cy: float
    spread: float
    sample_track_ids: list[uuid.UUID]


class TasteMapOut(Model):
    """«Сонар вкуса», computed nightly; empty until the first run or under 8 tracks.
    Points are parallel lists (x, y in ~[-1, 1]; cluster indexes `clusters`)."""

    track_ids: list[uuid.UUID]
    x: list[float]
    y: list[float]
    cluster: list[int]
    clusters: list[MapCluster]
    updated_at: dt.datetime | None


class GenreCount(Model):
    genre: str
    tracks: int


class ClusterName(Model):
    id: int
    name: str


class DayPick(Model):
    """An album loved and left: played 8+ times, untouched the longest; one of the eight
    oldest, by the day of the year."""

    album_id: uuid.UUID
    plays: int
    last_played_at: dt.datetime


class LibrarySummaryOut(Model):
    counts: Counts
    duration_ms: int
    first_added_at: dt.datetime | None
    last_added_at: dt.datetime | None
    genres: list[GenreCount]
    plays: int
    played_ms: int
    album_plays: dict[str, int] = Field(default_factory=dict)  # album id → plays («слушаю чаще»)
    album_last: dict[str, dt.datetime] = Field(default_factory=dict)  # album id → last listen
    artist_plays: dict[str, int] = Field(default_factory=dict)  # artist id → plays (primary artist)
    album_cluster: dict[str, int] = Field(
        default_factory=dict
    )  # album id → its songs' commonest sound cluster
    clusters: list[ClusterName] = Field(default_factory=list)
    artist_country: dict[str, str] = Field(default_factory=dict)  # artist id → ISO country code
    day_pick: DayPick | None = None  # «Пластинка дня»: the same album on every device that day


class AlbumCredit(Model):
    name: str
    artist_id: uuid.UUID | None = None
    songs: int  # how many of the album's songs carry it


class AlbumPageOut(Model):
    album: AlbumOut
    tracks: list[TrackOut]  # disc, then track order
    images: dict[str, ImageData]
    # the gatefold (design/reference/gatefold): the account's listening, and the credits
    # summed over the album's songs
    track_plays: dict[str, int] = Field(default_factory=dict)  # track id → plays
    last_played_at: dt.datetime | None = None
    producers: list[AlbumCredit] = Field(default_factory=list)  # most songs first, ≤4
    label: str | None = None


class ArtistYou(Model):
    """«Ты и …» on the artist page: how far the account has gone into the artist."""

    plays: int  # counted plays of the artist's own songs
    heard_tracks: int  # of `track_count`, played at least once
    rank: int | None  # by plays among the library's artists, 1 = the most played; None = unplayed
    artists: int  # artists with songs of their own in the library


class GrammyOut(Model):
    wins: int
    nominations: int | None
    position: int  # among the library's laureates by wins (ties share a place)
    laureates: int  # artists of the library with at least one win


class ArtistPageOut(Model):
    artist: ArtistOut
    albums: list[AlbumOut]  # newest first
    top_tracks: list[TrackOut]  # the account's most played
    appears_on: list[TrackOut]  # as a featured artist
    track_count: int
    images: dict[str, ImageData]
    country: str | None = None  # the artist's profile (AudioDB): where they are from
    country_code: str | None = None  # ISO 3166-1 alpha-2, for the flag
    # the page «Кадр» (2026-10-17)
    photo_id: str | None = None  # Apple Music's square portrait (None → artist.image_id)
    wide_id: str | None = None  # Apple Music's wide 2:1 editorial frame, big artists only
    logo_id: str | None = None  # a transparent logo, drawn instead of the typed name
    page_color: str | None = None  # Apple Music's background colour of the artist's page
    you: ArtistYou | None = None
    heard: dict[str, int] = Field(default_factory=dict)  # album id → its songs heard
    plays: dict[str, int] = Field(default_factory=dict)  # top track id → plays
    grammy: GrammyOut | None = None
    facts: list[FactOut] = Field(default_factory=list)  # «А ты знал»


class LyricsOut(Model):
    text: str
    synced_lrc: str | None
    source: str
    language: str | None


class AudioInfo(Model):
    codec: str | None
    sample_rate: int | None
    bit_depth: int | None
    channels: int | None
    bitrate_kbps: int | None
    lufs_integrated: float | None


class TrackStats(Model):
    plays: int
    last_played_at: dt.datetime | None


class PlayerContextOut(Model):
    track: TrackOut
    lyrics: LyricsOut | None
    credits: dict[str, list[str]]
    audio: AudioInfo
    stats: TrackStats
    images: dict[str, ImageData]
    knowledge: TrackKnowledge | None
    extra: dict[str, Any] = Field(default_factory=dict)  # badges
