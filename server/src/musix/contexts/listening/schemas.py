import uuid
from typing import Annotated, Literal

from pydantic import Field

from musix.schemas import JSON_INT, JsonBool, JsonDatetime, JsonInt, Model


class ListenIn(Model):
    client_event_id: uuid.UUID
    session_id: str = Field(min_length=1, max_length=64)
    track_id: uuid.UUID
    started_at: JsonDatetime
    played_ms: JsonInt = Field(ge=0, le=24 * 3600 * 1000)  # time actually heard (v1 accumulator)
    duration_ms: Annotated[int, Field(ge=0), JSON_INT] | None = None
    end_reason: Literal["completed", "skipped", "stopped", "error"]
    skipped_early: JsonBool = False
    interacted: JsonBool | None = None
    influence: JsonBool = True
    source: str | None = Field(default=None, max_length=64)  # pool label or "manual"
    context_type: Literal["stream", "album", "playlist", "search", "artist", "queue"] | None = None
    context_id: str | None = Field(default=None, max_length=128)


class ListenBatchIn(Model):
    events: list[ListenIn] = Field(min_length=1, max_length=100)


class ListenBatchOut(Model):
    accepted: int
    duplicates: int
    rejected: list[uuid.UUID] = Field(
        default_factory=list
    )  # unknown tracks: dropped, the client clears them anyway


class SignalIn(Model):
    kind: Literal["fire", "water"]
    client_event_id: uuid.UUID
    session_id: str | None = Field(default=None, max_length=64)


class SignalState(Model):
    kind: Literal["fire", "water"]
    contribution: float  # the «заряд» ∈ [0,1]
    locked: bool  # the same-kind button stays locked while contribution > 0.5


class SignalStatesOut(Model):
    states: dict[uuid.UUID, SignalState]
