"""process_media: cover → loudness → renditions for one media file (queue `media`).
Idempotent: each step checks what already exists."""

from __future__ import annotations

import asyncio
import os
import uuid
from pathlib import Path

import sqlalchemy as sa
import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.library.models import albums, images, media_files, renditions, tracks
from musix.contexts.media import audio
from musix.contexts.media import images as img
from musix.infra.changelog import record_change

log = structlog.get_logger()
FOLDER_COVERS = ("cover.jpg", "folder.jpg", "front.jpg", "cover.png", "folder.png")


async def extract_cover(src: Path) -> bytes | None:
    """The embedded picture (an attached-pic video stream), else a folder image."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-i",
        str(src),
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-c",
        "copy",
        "-f",
        "image2pipe",
        "-",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await asyncio.wait_for(proc.communicate(), timeout=60)
    if proc.returncode == 0 and out:
        return out
    for name in FOLDER_COVERS:
        p = (await asyncio.to_thread(src.resolve)).parent / name
        if await asyncio.to_thread(p.exists):
            return await asyncio.to_thread(p.read_bytes)
    return None


async def store_image(s: AsyncSession, media_dir: Path, data: bytes, kind: str) -> str:
    """Content-addressed: variants, palette and blurhash once per distinct image."""
    iid = img.image_id(data)
    if not await s.scalar(sa.select(images.c.id).where(images.c.id == iid)):
        out = media_dir / "i" / iid[:2] / iid
        w, h, paths = await asyncio.to_thread(img.variants, data, out)
        px32, px64 = (
            await asyncio.to_thread(img.pixels, data, 32),
            await asyncio.to_thread(img.pixels, data, 64),
        )
        await s.execute(
            pg_insert(images)
            .values(
                id=iid,
                kind=kind,
                width=w,
                height=h,
                variants=paths,
                palette=img.palette(px32, px64),
                blurhash=img.blurhash(px32),
            )
            .on_conflict_do_nothing()
        )
    return iid


async def _cover(s: AsyncSession, media_dir: Path, mf_id: uuid.UUID, src: Path) -> str | None:
    data = await extract_cover(src)
    if not data:
        return None
    iid = await store_image(s, media_dir, data, "cover")
    rows = (
        await s.execute(
            sa.update(tracks)
            .where(tracks.c.media_file_id == mf_id)
            .values(cover_image_id=iid)
            .returning(tracks.c.id, tracks.c.account_id, tracks.c.album_id)
        )
    ).all()
    for r in rows:
        if r.album_id:
            hit = await s.scalar(
                sa.update(albums)
                .where(albums.c.id == r.album_id, albums.c.cover_image_id.is_(None))
                .values(cover_image_id=iid)
                .returning(albums.c.id)
            )
            if hit is not None:
                await record_change(s, r.account_id, "album", r.album_id)
        await record_change(s, r.account_id, "track", r.id)
    return iid


async def _budget_left(s: AsyncSession, budget_gb: int) -> bool:
    used = await s.scalar(sa.select(sa.func.coalesce(sa.func.sum(renditions.c.size_bytes), 0)))
    return int(used or 0) < budget_gb * 1024**3


async def process_media(
    sm: async_sessionmaker[AsyncSession], media_dir: Path, mf_id: uuid.UUID, budget_gb: int = 150
) -> None:
    async with sm() as s:
        mf = (await s.execute(sa.select(media_files).where(media_files.c.id == mf_id))).one()
        have: set[str] = set(
            (
                await s.scalars(
                    sa.select(renditions.c.tier).where(renditions.c.media_file_id == mf_id)
                )
            ).all()
        )
    src = Path(mf.path)
    tdir = audio.tier_dir(media_dir, mf.sha256)
    await asyncio.to_thread(tdir.mkdir, parents=True, exist_ok=True)
    ext = src.suffix.lower() or ".bin"
    link = tdir / f"lossless{ext}"
    if not await asyncio.to_thread(os.path.lexists, link):
        await asyncio.to_thread(os.symlink, await asyncio.to_thread(src.resolve), link)
    async with sm() as s:
        await _cover(s, media_dir, mf_id, src)
        if mf.lufs_integrated is None:
            lo = await audio.loudness(src)
            await s.execute(
                sa.update(media_files)
                .where(media_files.c.id == mf_id)
                .values(lufs_integrated=lo.lufs, true_peak_dbtp=lo.true_peak, loudness_range=lo.lra)
            )
        await s.commit()
    plan: list[tuple[str, str, int | None]] = [
        ("high", "aac", 320)
    ]  # high first: it is always kept
    compat = audio.compat_kind(mf.codec)
    if compat:
        plan.append(("lossless_compat", compat, 320 if compat == "aac" else None))
    plan.append(("economy", "aac", 128))
    for tier, codec, kbps in plan:
        if tier in have:
            continue
        async with sm() as s:
            if tier == "economy" and not await _budget_left(s, budget_gb):
                log.info(
                    "rendition_budget_full", media_file=str(mf_id)
                )  # economy becomes on-demand
                continue
        dst = tdir / (f"{tier}.m4a" if codec == "aac" else f"{tier}.flac")
        if codec == "aac":
            await audio.encode_aac(src, dst, kbps or 320, mf.sample_rate)
        else:
            await audio.encode_flac(src, dst)
        size = (await asyncio.to_thread(dst.stat)).st_size
        async with sm() as s:
            await s.execute(
                pg_insert(renditions)
                .values(
                    media_file_id=mf_id,
                    tier=tier,
                    path=str(dst),
                    codec="aac" if codec == "aac" else "flac",
                    bitrate_kbps=kbps,
                    size_bytes=size,
                )
                .on_conflict_do_nothing()
            )
            await s.commit()
    async with sm() as s:
        await s.execute(
            sa.update(media_files).where(media_files.c.id == mf_id).values(state="media_done")
        )
        await s.commit()
