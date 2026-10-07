"""Screen-level shapes (BFF, spec §6). Each carries an `images` side-table: every image
the screen references, once, keyed by id."""

import datetime as dt
import uuid
from typing import Any, Literal

from pydantic import Field

from musix.contexts.knowledge.schemas import TrackKnowledge
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


class StatsOut(Model):
    listening: Listening
    rhythm: Rhythm
    engagement: Engagement
    images: dict[str, ImageData]
    collection: Collection | None = None


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


class LibrarySummaryOut(Model):
    counts: Counts
    duration_ms: int
    first_added_at: dt.datetime | None
    last_added_at: dt.datetime | None
    genres: list[GenreCount]
    plays: int
    played_ms: int
    album_plays: dict[str, int] = Field(default_factory=dict)  # album id → plays («слушаю чаще»)


class AlbumPageOut(Model):
    album: AlbumOut
    tracks: list[TrackOut]  # disc, then track order
    images: dict[str, ImageData]


class ArtistPageOut(Model):
    artist: ArtistOut
    albums: list[AlbumOut]  # newest first
    top_tracks: list[TrackOut]  # the account's most played
    appears_on: list[TrackOut]  # as a featured artist
    track_count: int
    images: dict[str, ImageData]
    country: str | None = None  # the artist's profile (AudioDB): where they are from
    country_code: str | None = None  # ISO 3166-1 alpha-2, for the flag


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
