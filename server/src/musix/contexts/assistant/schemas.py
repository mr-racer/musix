import datetime as dt
import uuid
from typing import Any, Literal

from pydantic import Field

from musix.contexts.library.schemas import TrackOut
from musix.contexts.media.schemas import ImageData
from musix.schemas import Model


class ChatTurn(Model):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=12000)


class AssistantTurnIn(Model):
    """v1 `AssistantRequest`, minus the per-request LLM overrides (the instance's LLM
    is the admin's setting)."""

    # «объясни: <факт>» carries the whole fact: a quarter of the facts are over 600
    # chars and the longest is ~9k, so the old 1000/600 caps turned a tap on one of the
    # assistant's own suggestions into a 422, shown as «ничего не найдено» (2026-10-02)
    message: str = Field(min_length=1, max_length=10000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=40)
    slots: dict[str, Any] = Field(default_factory=dict)
    intent: Literal["lyrics_search", "audio_search", "playlist", "general"] | None = None
    subject_track_id: uuid.UUID | None = None
    subject_artist_slug: str | None = Field(default=None, max_length=200)
    focus_fact: str | None = Field(default=None, max_length=10000)
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


class Idea(Model):
    """One «Интересное в вашей музыке» line: a refined fact about a song or an artist
    in the library, with what pins the assistant to its subject when it is explained."""

    fact: str
    kind: Literal["song", "artist"]
    title: str | None  # the song, for song facts
    artist: str | None
    track_id: uuid.UUID | None  # one of the listener's tracks of that song
    artist_slug: str | None  # for artist facts
    image_id: str | None


class IdeasOut(Model):
    ideas: list[Idea]
    images: dict[str, ImageData]
