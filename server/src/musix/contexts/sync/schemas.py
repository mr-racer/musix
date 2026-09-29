import datetime as dt
import uuid
from typing import Annotated, Any, Literal

from pydantic import Field

from musix.contexts.library.schemas import TrackOut
from musix.contexts.playlists.schemas import ItemOut, PlaylistOut
from musix.schemas import Model

Op = Literal["upsert", "delete"]


class ImageData(Model):
    id: str
    width: int | None
    height: int | None
    blurhash: str | None
    palette: dict[str, Any] | None
    urls: dict[str, str]  # px → signed URL (content-addressed, a year's expiry)


class ArtistData(Model):
    id: uuid.UUID
    name: str
    sort_name: str | None
    image_id: str | None


class AlbumData(Model):
    id: uuid.UUID
    title: str
    year: int | None
    album_artist_id: uuid.UUID | None
    cover_image_id: str | None


class PlaylistItemData(ItemOut):
    playlist_id: uuid.UUID


class SignalData(Model):
    """Clients compute the «заряд» locally: 0.5 ** (age_days / 1), locked above 0.5."""

    track_id: uuid.UUID
    kind: Literal["fire", "water"]
    created_at: dt.datetime


class SettingsData(Model):
    value: dict[str, Any]


class ImageChange(Model):
    entity: Literal["image"]
    id: str
    op: Op
    data: ImageData | None = None


class ArtistChange(Model):
    entity: Literal["artist"]
    id: str
    op: Op
    data: ArtistData | None = None


class AlbumChange(Model):
    entity: Literal["album"]
    id: str
    op: Op
    data: AlbumData | None = None


class TrackChange(Model):
    entity: Literal["track"]
    id: str
    op: Op
    data: TrackOut | None = None


class PlaylistChange(Model):
    entity: Literal["playlist"]
    id: str
    op: Op
    data: PlaylistOut | None = None


class PlaylistItemChange(Model):
    entity: Literal["playlistItem"]
    id: str
    op: Op
    data: PlaylistItemData | None = None


class SignalStateChange(Model):
    entity: Literal["signalState"]
    id: str
    op: Op
    data: SignalData | None = None


class SettingsChange(Model):
    entity: Literal["settings"]
    id: str
    op: Op
    data: SettingsData | None = None


Change = Annotated[
    ImageChange
    | ArtistChange
    | AlbumChange
    | TrackChange
    | PlaylistChange
    | PlaylistItemChange
    | SignalStateChange
    | SettingsChange,
    Field(discriminator="entity"),
]


class SyncPage(Model):
    changes: list[Change]
    cursor: str  # opaque; pass it back as ?cursor=
    has_more: bool
