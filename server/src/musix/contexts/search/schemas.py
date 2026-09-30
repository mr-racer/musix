import uuid
from typing import Literal

from pydantic import Field

from musix.contexts.library.schemas import TrackOut
from musix.contexts.media.schemas import ImageData
from musix.contexts.screens.schemas import AlbumOut, ArtistOut
from musix.schemas import Model


class TopHit(Model):
    """One mixed, best-first catalog list (songs, albums and artists ranked together)."""

    type: Literal["song", "album", "artist"]
    id: uuid.UUID
    name: str
    artist: str | None
    score: float


class Scored(Model):
    track: TrackOut
    score: float


class SearchOut(Model):
    query: str
    top: list[TopHit]
    tracks: list[TrackOut]
    albums: list[AlbumOut]
    artists: list[ArtistOut]
    lyrics: list[Scored]  # lyric-line and meaning search
    sound: list[Scored]  # «как звучит» search (CLAP)
    images: dict[str, ImageData]
    degraded: list[str] = Field(default_factory=list)  # sections that could not run now


class Facet(Model):
    value: str
    count: int


class FacetsOut(Model):
    decades: list[Facet]
    tags: list[Facet]
