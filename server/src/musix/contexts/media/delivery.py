"""Signed media and image URLs + playback manifests (spec §5.3). Python never reads audio
bytes: nginx verifies the HMAC with njs and serves the file with sendfile."""

from __future__ import annotations

import hashlib
import hmac
import time
import uuid
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.identity.models import account_settings, devices
from musix.contexts.library.models import images, media_files, renditions, tracks
from musix.contexts.media import audio
from musix.contexts.media.schemas import Gain, ImageData, ManifestItem, Source

MEDIA_TTL = 6 * 3600
IMAGE_SIZES = (96, 256, 512, 1024)
IMAGE_TTL = 365 * 24 * 3600
DEFAULT_QUALITY = {"wifi": "lossless", "cellular": "high"}  # economy is opt-in


def sign(secret: bytes, path: str, ttl: int, now: float | None = None) -> str:
    exp = int((now or time.time()) + ttl)
    sig = hmac.new(secret, f"{path}{exp}".encode(), hashlib.sha256).hexdigest()
    return f"{path}?e={exp}&s={sig}"


def image_url(base: str, secret: bytes, image_id: str | None, size: int = 512) -> str | None:
    """Content-addressed, so a long expiry is safe (and cacheable as immutable)."""
    if not image_id:
        return None
    # the expiry is rounded to a day so the URL (and the browser cache) is stable
    exp_base = time.time() // 86400 * 86400
    return base + sign(secret, f"/i/{image_id}/{size}.webp", IMAGE_TTL, now=exp_base)


async def load_images(
    s: AsyncSession, base: str, secret: bytes, ids: Iterable[str | None]
) -> dict[str, ImageData]:
    """Image refs as clients render them: signed URL per variant, blurhash, palette."""
    wanted = sorted({i for i in ids if i})
    if not wanted:
        return {}
    rows = await s.execute(sa.select(images).where(images.c.id.in_(wanted)))
    return {
        r.id: ImageData(
            id=r.id,
            width=r.width,
            height=r.height,
            blurhash=r.blurhash,
            palette=r.palette,
            urls={
                str(px): url
                for px in IMAGE_SIZES
                if str(px) in (r.variants or {}) and (url := image_url(base, secret, r.id, px))
            },
        )
        for r in rows
    }


def choose_tier(requested: str, available: set[str], codec: str | None, platform: str) -> str:
    """The requested tier if it exists, else the nearest one. `lossless` becomes
    `lossless_compat` where the client cannot decode the original."""
    order = {
        "lossless": ["lossless", "high", "economy"],
        "high": ["high", "lossless", "economy"],
        "economy": ["economy", "high", "lossless"],
    }[requested]
    # Only Windows (Media Foundation) decodes ALAC itself. Android's MediaCodec often has no
    # ALAC decoder, and ExoPlayer then "plays" in silence with no error, so the fallback
    # never fires (the owner, 2026-10-03): Android gets the FLAC copy, like the web.
    native = codec == "alac" and platform == "windows"
    needs_compat = audio.compat_kind(codec) is not None and not native
    for t in order:
        if t == "lossless" and needs_compat:
            if "lossless_compat" in available:
                return "lossless_compat"
            continue
        if t in available:
            return t
    return "lossless_compat" if "lossless_compat" in available else "lossless"


def _entry(base: str, secret: bytes, row: Any, rend: dict[str, Any], tier: str) -> Source:
    if tier == "lossless":
        ext, codec, kbps, size = (
            Path(row.path).suffix.lower(),
            row.codec,
            row.bitrate_kbps,
            row.size_bytes,
        )
    else:
        x = rend[tier]
        ext, codec, kbps, size = Path(x.path).suffix, x.codec, x.bitrate_kbps, x.size_bytes
    return Source(
        tier=tier,  # type: ignore[arg-type]
        codec=codec,
        bitrate_kbps=kbps,
        size_bytes=size,
        url=base + sign(secret, f"/m/{row.sha256}/{tier}{ext}", MEDIA_TTL),
    )


async def manifest(
    s: AsyncSession,
    base: str,
    secret: bytes,
    account_id: uuid.UUID,
    device_id: uuid.UUID,
    track_ids: list[uuid.UUID],
    network: str,
) -> list[ManifestItem]:
    quality = {
        **DEFAULT_QUALITY,
        **(
            (
                await s.scalar(
                    sa.select(account_settings.c.value).where(
                        account_settings.c.account_id == account_id
                    )
                )
                or {}
            ).get("quality")
            or {}
        ),
    }
    platform = (
        await s.scalar(sa.select(devices.c.platform).where(devices.c.id == device_id)) or "web"
    )
    rows = (
        await s.execute(
            sa.select(
                tracks.c.id,
                tracks.c.album_id,
                media_files.c.id.label("mf"),
                media_files.c.sha256,
                media_files.c.path,
                media_files.c.codec,
                media_files.c.bitrate_kbps,
                media_files.c.duration_ms,
                media_files.c.size_bytes,
                media_files.c.lufs_integrated,
                media_files.c.true_peak_dbtp,
            )
            .join(media_files, media_files.c.id == tracks.c.media_file_id)
            .where(
                tracks.c.account_id == account_id,
                tracks.c.id.in_(track_ids),
                tracks.c.deleted_at.is_(None),
            )
        )
    ).all()
    rend: dict[uuid.UUID, dict[str, Any]] = {}
    for r in await s.execute(
        sa.select(renditions).where(renditions.c.media_file_id.in_([x.mf for x in rows]))
    ):
        rend.setdefault(r.media_file_id, {})[r.tier] = r
    album_lufs = {
        a: v
        for a, v in await s.execute(
            sa.select(tracks.c.album_id, sa.func.avg(media_files.c.lufs_integrated))
            .join(media_files, media_files.c.id == tracks.c.media_file_id)
            .where(tracks.c.album_id.in_([x.album_id for x in rows if x.album_id]))
            .group_by(tracks.c.album_id)
        )
    }
    by_id = {r.id: r for r in rows}
    out = []
    for tid in track_ids:  # keep the queue order
        row = by_id.get(tid)
        if row is None:
            continue
        mine = rend.get(row.mf, {})
        avail = {"lossless", *mine}
        requested = quality.get(network, DEFAULT_QUALITY.get(network, "high"))
        tier = choose_tier(requested, avail, row.codec, platform)
        fallbacks = [
            t
            for t in ("high", "economy", "lossless_compat", "lossless")
            if t in avail and t != tier
        ]
        out.append(
            ManifestItem(
                **_entry(base, secret, row, mine, tier).model_dump(),
                track_id=row.id,
                duration_ms=row.duration_ms,
                expires_at=int(time.time() + MEDIA_TTL),
                gain=Gain(
                    track_db=audio.gains(row.lufs_integrated, row.true_peak_dbtp),
                    album_db=audio.gains(album_lufs.get(row.album_id), row.true_peak_dbtp),
                ),
                fallbacks=[_entry(base, secret, row, mine, t) for t in fallbacks],
            )
        )
    return out
