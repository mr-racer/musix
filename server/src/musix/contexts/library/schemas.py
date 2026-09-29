import datetime as dt
import uuid

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
