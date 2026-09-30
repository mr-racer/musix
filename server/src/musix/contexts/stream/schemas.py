import uuid
from typing import Any, Literal

from pydantic import Field

from musix.contexts.library.schemas import TrackOut
from musix.contexts.media.schemas import ImageData
from musix.schemas import Model


class ReasonOut(Model):
    """«Почему этот трек»: a chip (`text`) and the detail sheet (`details`)."""

    kind: str
    text: str
    refs: dict[str, Any] = Field(default_factory=dict)
    details: list[str] = Field(default_factory=list)


class StreamItem(Model):
    track_id: uuid.UUID
    track: TrackOut | None = None
    pool: str
    sources: list[str]
    reason: ReasonOut


class StreamOut(Model):
    items: list[StreamItem]
    images: dict[str, ImageData]
    model_version: int | None = None
    familiarity: str = "mix"
    sound: str | None = None


class StreamSettings(Model):
    familiarity: str = "mix"
    sound: str | None = None


class PresetOut(Model):
    id: str
    row: Literal["familiarity", "sound"]
    position: int
    label_ru: str
    label_en: str
    icon: str


class FeedbackIn(Model):
    session_id: str = Field(min_length=1, max_length=64)
    track_id: uuid.UUID
    kind: Literal["less_like_this"]


class AutoplayIn(Model):
    seed_track_id: uuid.UUID
    exclude_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    limit: int = Field(default=20, ge=1, le=50)


class AutoplayOut(Model):
    tracks: list[TrackOut]
    images: dict[str, ImageData]
