import uuid
from typing import Any, Literal

from pydantic import Field

from musix.schemas import Model


class ManifestIn(Model):
    track_ids: list[uuid.UUID] = Field(min_length=1, max_length=20)
    network: Literal["wifi", "cellular"] = "wifi"


class ManifestOut(Model):
    items: list[dict[str, Any]]


class AppRelease(Model):
    version_code: int
    version_name: str
    url: str
    sha256: str
    notes: str = ""
