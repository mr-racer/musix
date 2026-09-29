import datetime as dt
import uuid
from typing import Any, Literal

from pydantic import Field

from musix.schemas import Model


class DeviceIn(Model):
    name: str = Field(min_length=1, max_length=100)
    platform: Literal["android", "windows", "web"]
    app_version: str | None = None


class SetupIn(Model):
    email: str
    password: str = Field(min_length=8)
    mode: Literal["personal", "shared"]
    device: DeviceIn


class LoginIn(Model):
    email: str
    password: str
    device: DeviceIn


class RegisterIn(LoginIn):
    invite_code: str


class RefreshIn(Model):
    refresh_token: str


class Tokens(Model):
    access_token: str
    refresh_token: str
    expires_in: int
    account_id: uuid.UUID
    device_id: uuid.UUID
    role: str


class DeviceOut(Model):
    id: uuid.UUID
    name: str
    platform: str
    app_version: str | None
    created_at: dt.datetime
    last_seen_at: dt.datetime
    current: bool = False


class InviteOut(Model):
    code: str
    created_at: dt.datetime
    expires_at: dt.datetime
    consumed: bool


class SettingsIO(Model):
    value: dict[str, Any]
