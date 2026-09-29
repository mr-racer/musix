import datetime as dt
import uuid
from typing import Literal

from pydantic import Field

from musix.schemas import Model


class ListenIn(Model):
    client_event_id: uuid.UUID
    session_id: str = Field(min_length=1, max_length=64)
    track_id: uuid.UUID
    started_at: dt.datetime
    played_ms: int = Field(ge=0, le=24 * 3600 * 1000)  # time actually heard (v1 accumulator)
    duration_ms: int | None = Field(default=None, ge=0)
    end_reason: Literal["completed", "skipped", "stopped", "error"]
    skipped_early: bool = False
    interacted: bool | None = None
    influence: bool = True
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
