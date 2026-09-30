import datetime as dt
import uuid
from typing import Any, Literal

from pydantic import Field

from musix.contexts.library.schemas import TrackOut
from musix.contexts.media.schemas import ImageData
from musix.schemas import Model


class ChatTurn(Model):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class AssistantTurnIn(Model):
    """v1 `AssistantRequest`, minus the per-request LLM overrides (the instance's LLM
    is the admin's setting)."""

    message: str = Field(min_length=1, max_length=1000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=40)
    slots: dict[str, Any] = Field(default_factory=dict)
    intent: Literal["lyrics_search", "audio_search", "playlist", "general"] | None = None
    subject_track_id: uuid.UUID | None = None
    subject_artist_slug: str | None = Field(default=None, max_length=200)
    focus_fact: str | None = Field(default=None, max_length=600)
    focus_kind: Literal["samples"] | None = None
    context_id: str | None = Field(default=None, max_length=64)
    allow_web: bool | None = None
    now_playing_track_id: uuid.UUID | None = None
    limit: int = Field(default=15, ge=1, le=40)
    lang: Literal["ru", "en"] = "ru"


class TrackChatIn(Model):
    """v1 `TrackChatRequest`: the drawer chat about one track, or «explain this line»."""

    track_id: uuid.UUID
    mode: Literal["song", "lyric_explain"]
    selected_line: str | None = Field(default=None, max_length=1000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=40)
    message: str = Field(min_length=1, max_length=2000)
    lang: Literal["ru", "en"] | None = None


class TurnAccepted(Model):
    turn_id: uuid.UUID


class TurnOut(Model):
    """`result` is v1's payload shape (AssistantResponse / TrackChatResponse); every
    track id it names is also in `tracks` as a v2 TrackOut, images in `images`."""

    id: uuid.UUID
    kind: str
    status: Literal["queued", "running", "done", "error"]
    result: dict[str, Any] | None
    error: str | None
    tracks: dict[str, TrackOut]
    images: dict[str, ImageData]
    created_at: dt.datetime
    finished_at: dt.datetime | None


class DiscoveriesOut(Model):
    """The assistant page's «связи в библиотеке» rail — v1's cards (each a turn to
    send), with the tracks they name as v2 TrackOut."""

    cards: list[dict[str, Any]]
    tracks: dict[str, TrackOut]
    images: dict[str, ImageData]
