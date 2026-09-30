import datetime as dt
import uuid
from typing import Any, Literal

from pydantic import Field

from musix.schemas import Model


class DeviceIn(Model):
    name: str = Field(min_length=1, max_length=100)
    platform: Literal["android", "windows", "web"]
    app_version: str | None = Field(default=None, max_length=64)


EMAIL = Field(min_length=3, max_length=254)  # the shape is checked by the service (400)


class SetupIn(Model):
    email: str = EMAIL
    password: str = Field(min_length=8, max_length=256)
    mode: Literal["personal", "shared"]
    device: DeviceIn


class LoginIn(Model):
    email: str = Field(min_length=1, max_length=254)  # anything: a wrong one is just a 401
    password: str = Field(min_length=1, max_length=256)
    device: DeviceIn


class RegisterIn(Model):
    email: str = EMAIL
    password: str = Field(min_length=8, max_length=256)
    device: DeviceIn
    invite_code: str = Field(min_length=1, max_length=64)


class RefreshIn(Model):
    refresh_token: str = Field(min_length=1, max_length=256)


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


class LlmSettingsIn(Model):
    base_url: str | None = Field(default=None, max_length=512)
    model: str | None = Field(default=None, max_length=200)
    api_key: str | None = Field(
        default=None, max_length=512
    )  # null keeps the stored one; "" clears it


class LlmSettingsOut(Model):
    base_url: str | None
    model: str
    has_key: bool
