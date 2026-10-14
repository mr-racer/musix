import datetime as dt
import uuid
from typing import Literal

from pydantic import Field

from musix.schemas import JsonInt, Model


class ScanIn(Model):
    path: str = Field(pattern=r"^/", max_length=4096)  # under MUSIX_LIBRARY_ROOTS
    account_id: uuid.UUID | None = None  # default: the caller (owner)


class JobOut(Model):
    job: str


class UploadIn(Model):
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size: JsonInt = Field(gt=0, le=2 * 1024**3)
    filename: str = Field(min_length=1, max_length=255)


class UploadOut(Model):
    id: uuid.UUID | None = None
    exists: bool = False
    offset: int = 0
    state: str = "receiving"
    track_id: uuid.UUID | None = None  # `exists` and this account has it already: the track


class UploadStatus(Model):
    """One song in the library's inbox, one step at a time, in the server's order:
    `send` (bytes arriving) → `sound` (sha checked, tags read, loudness, cover, spectrum,
    CLAP) → `facts` (playable; facts on their way) → `done`; or `error`."""

    id: uuid.UUID
    stage: Literal["send", "sound", "facts", "done", "error"]
    track_id: uuid.UUID | None = None
    error: Literal["mismatch", "unreadable"] | None = None
    facts: int = 0


class TrackArtist(Model):
    id: uuid.UUID
    name: str
    role: str


class TrackOut(Model):
    id: uuid.UUID
    title: str
    title_display: str | None
    artist_display: str
    artists: list[TrackArtist]
    album_id: uuid.UUID | None
    album: str | None
    year: int | None
    genre: str | None
    track_no: int | None
    disc_no: int | None
    duration_ms: int | None
    cover_image_id: str | None
    added_at: dt.datetime
