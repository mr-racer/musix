import datetime as dt
import uuid
from typing import Any

from pydantic import Field

from musix.contexts.media.schemas import ImageData
from musix.schemas import Model


class QuizMode(Model):
    key: str
    pool_size: int
    available: bool  # I-5: at least 20 rounds' worth of material
    has_audio: bool
    option_audio: bool
    input_kind: str  # options | year


class RoundIn(Model):
    mode: str = Field(max_length=40)
    snippet_sec: int = 3  # 3 | 5 | 10


class RoundOut(Model):
    """The question — never the track or the correct option. `audioUrl` (and each
    option's `audioUrl`) is signed and lives as long as the round."""

    round_id: uuid.UUID
    mode: str
    options: list[dict[str, Any]]
    start_sec: float
    length_sec: float
    expires_at: dt.datetime
    has_audio: bool
    option_audio: bool
    input_kind: str
    meta: dict[str, Any]
    audio_url: str | None
    images: dict[str, ImageData] = Field(default_factory=dict)  # option/prompt covers, by id


class AnswerIn(Model):
    option_id: str | None = Field(default=None, max_length=64)
    year: int | None = Field(default=None, ge=1800, le=2200)


class AnswerOut(Model):
    correct: bool
    score: float
    expired: bool
    correct_option_id: str | None
    reveal: dict[str, Any]
    truth: dict[str, Any]
    images: dict[str, ImageData] = Field(default_factory=dict)  # the truth cover, for the reveal
