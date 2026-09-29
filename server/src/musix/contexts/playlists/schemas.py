import datetime as dt
import uuid

from pydantic import Field, field_validator

from musix.contexts.playlists import fractional
from musix.schemas import Model


def _check_key(v: str | None) -> str | None:
    if v is not None:
        try:
            fractional.validate(v)
        except (ValueError, IndexError) as e:
            raise ValueError("not a fractional-index key") from e
    return v


class PlaylistIn(Model):
    id: uuid.UUID | None = None  # client-generated for offline creates
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class PlaylistPatch(Model):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class PlaylistOut(Model):
    id: uuid.UUID
    name: str
    description: str | None
    cover_image_id: str | None
    item_count: int = 0
    created_at: dt.datetime
    updated_at: dt.datetime


class ItemIn(Model):
    item_id: uuid.UUID | None = None
    track_id: uuid.UUID


class ItemsAdd(Model):
    """Placed after `afterItemId` (None: at the end), or at the client's own positions."""

    items: list[ItemIn] = Field(min_length=1, max_length=500)
    after_item_id: uuid.UUID | None = None
    positions: list[str] | None = None

    @field_validator("positions")
    @classmethod
    def _keys(cls, v: list[str] | None) -> list[str] | None:
        return [_check_key(x) or "" for x in v] if v is not None else None


class ItemMove(Model):
    """Either the client's key (offline replay) or the neighbour to land after
    (`afterItemId` None = the top)."""

    position: str | None = None
    after_item_id: uuid.UUID | None = None

    @field_validator("position")
    @classmethod
    def _valid(cls, v: str | None) -> str | None:
        return _check_key(v)


class ItemOut(Model):
    item_id: uuid.UUID
    track_id: uuid.UUID
    position: str
    added_at: dt.datetime
