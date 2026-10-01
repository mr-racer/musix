import datetime as dt
import uuid
from typing import Any, Literal

from pydantic import Field, model_validator

from musix.schemas import JsonInt, Model

Command = Literal["play", "pause", "toggle", "next", "prev", "seek", "signal"]


class PlaybackState(Model):
    """What the active player plays, enough for another device to continue it."""

    track_ids: list[uuid.UUID] = Field(max_length=500)  # the queue window around `index`
    index: int = Field(ge=0)
    position_ms: JsonInt = Field(ge=0)
    playing: bool
    mode: Literal["list", "stream"] = "list"
    context_type: str | None = Field(default=None, max_length=32)
    context_id: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _index_in_queue(self) -> "PlaybackState":
        if self.track_ids and self.index >= len(self.track_ids):
            raise ValueError("index is past the queue")
        return self


class SessionOut(Model):
    device_id: uuid.UUID | None
    state: PlaybackState
    updated_at: dt.datetime


class ActiveDevice(Model):
    id: uuid.UUID
    name: str
    platform: str
    can_play: bool
    current: bool  # the device asking
    active: bool  # the account's active player


class TransferIn(Model):
    to_device: uuid.UUID
    play: bool = True


class CommandMsg(Model):
    target: uuid.UUID
    command: Command
    position_ms: JsonInt | None = Field(default=None, ge=0)  # seek
    kind: Literal["fire", "water"] | None = None  # signal

    def args(self) -> dict[str, Any]:
        return {
            k: v
            for k, v in (("positionMs", self.position_ms), ("kind", self.kind))
            if v is not None
        }
