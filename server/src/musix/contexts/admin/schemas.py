import datetime as dt
import uuid
from typing import Literal

from pydantic import Field

from musix.schemas import JsonBool, Model


class MemberOut(Model):
    """One account as the owner sees it: counts only, never another account's titles."""

    id: uuid.UUID
    email: str
    role: str
    display_name: str | None
    index_root: str | None
    premium: bool
    invite_code: str | None
    created_at: dt.datetime
    last_login_at: dt.datetime | None
    tracks: int
    listens: int
    likes: int
    devices: int


class MemberPatch(Model):
    # "" revokes the folder grant; null leaves it as is
    index_root: str | None = Field(default=None, max_length=4096)
    premium: JsonBool | None = None  # display-only, as v1


class DeleteIn(Model):
    confirm_email: str = Field(min_length=3, max_length=254)  # typed by the owner, as v1


class InstanceOut(Model):
    """Open: what a client needs before sign-in."""

    setup_required: bool
    mode: Literal["personal", "shared"] | None
    name: str
    llm: str  # up | down | unauthorized | unconfigured | unknown
    ai_for_members: bool


class InstanceSettings(Model):
    name: str = Field(default="MusiX", min_length=1, max_length=60)
    registration: Literal["invite", "closed"] = "invite"
    # the AI policy (v1 `ai_available`): off = members cannot start assistant or track-chat
    # turns; the owner is never gated
    ai_for_members: JsonBool = True


class QueueDepth(Model):
    queue: str
    status: str
    jobs: int


class TierCoverage(Model):
    tier: str
    files: int
    bytes: int


class OpsOut(Model):
    queues: list[QueueDepth]
    media_bytes: int
    rendition_bytes: int
    rendition_budget_bytes: int
    media_files: int
    unprocessed: int  # registered but never probed/measured (no codec or no loudness)
    renditions: list[TierCoverage]
    accounts: int
    tracks: int
    listens_24h: int


class BackfillOut(Model):
    job: str
