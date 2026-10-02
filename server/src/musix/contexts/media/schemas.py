import uuid
from typing import Literal

from pydantic import Field

from musix.schemas import Model


class ManifestIn(Model):
    track_ids: list[uuid.UUID] = Field(min_length=1, max_length=20)
    network: Literal["wifi", "cellular"] = "wifi"


Tier = Literal["economy", "high", "lossless", "lossless_compat"]


class Source(Model):
    tier: Tier
    codec: str | None
    bitrate_kbps: int | None
    size_bytes: int | None
    url: str  # signed, valid until `expiresAt`; a 403 means: ask for a new manifest


class Gain(Model):
    """dB to reach the service level (−9.2 LUFS, the library median); a boost never goes
    past −1 dBTP."""

    track_db: float | None
    album_db: float | None


class ManifestItem(Source):
    track_id: uuid.UUID
    duration_ms: int | None
    expires_at: int  # unix seconds
    gain: Gain
    fallbacks: list[Source]  # the next tiers to try, best first


class ManifestOut(Model):
    items: list[ManifestItem]  # in the order asked, unknown tracks left out


class AppRelease(Model):
    version_code: int
    version_name: str
    url: str
    sha256: str
    notes: str = ""


class Accent(Model):
    dark: str  # hsl() for the dark theme
    light: str


class Palette(Model):
    dominant: str  # #rrggbb
    vibrant: str
    muted: str
    accent: Accent  # the player accent (v1's rule)


class ImageData(Model):
    id: str
    width: int | None
    height: int | None
    blurhash: str | None
    palette: Palette | None
    urls: dict[str, str]  # px → signed URL (content-addressed, a year's expiry)
