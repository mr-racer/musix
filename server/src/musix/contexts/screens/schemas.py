"""Screen-level shapes (BFF, spec §6). Each carries an `images` side-table: every image
the screen references, once, keyed by id."""

import datetime as dt
import uuid
from typing import Any

from pydantic import Field

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


class HomeOut(Model):
    recent: list[TrackOut]  # last played first
    recently_added: list[TrackOut]
    playlists: list[PlaylistOut]
    counts: Counts
    images: dict[str, ImageData]


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
    extra: dict[str, Any] = Field(default_factory=dict)  # phase 2: facts and badges
