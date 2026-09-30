"""Images that arrive as files rather than inside audio: the migrator's v1 covers and
artist photos. Content-addressed through the phase 1 image pipeline, then attached where
nothing is attached yet (an embedded cover found later by `media:process` does not
overwrite, and neither does this overwrite one it found first)."""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.library.models import albums, artists, tracks
from musix.contexts.media.process import store_image
from musix.infra.changelog import record_change

SM = async_sessionmaker[AsyncSession]


def _read(p: Path) -> bytes | None:
    return p.read_bytes() if p.is_file() else None


async def import_images(sm: SM, media_dir: Path, batch: dict[str, Any]) -> dict[str, int]:
    """`batch`: {"covers": {track_id: path},
    "artists": {artist_id: {"thumb": path, "cutout": path}}}."""
    n = {"covers": 0, "artists": 0, "missing": 0}
    cache: dict[str, str] = {}  # path → image id (many tracks share an album cover)

    async def image(path: str, kind: str) -> str | None:
        if path in cache:
            return cache[path]
        data = await asyncio.to_thread(_read, Path(path))
        if data is None:
            n["missing"] += 1
            return None
        async with sm() as s:
            iid = await store_image(s, media_dir, data, kind)
            await s.commit()
        cache[path] = iid
        return iid

    for tid, path in (batch.get("covers") or {}).items():
        iid = await image(path, "cover")
        if iid is None:
            continue
        async with sm() as s:
            row = (
                await s.execute(
                    sa.update(tracks)
                    .where(tracks.c.id == uuid.UUID(tid), tracks.c.cover_image_id.is_(None))
                    .values(cover_image_id=iid)
                    .returning(tracks.c.account_id, tracks.c.album_id)
                )
            ).first()
            if row is not None:
                await record_change(s, row.account_id, "track", tid)
                if row.album_id:
                    hit = await s.scalar(
                        sa.update(albums)
                        .where(albums.c.id == row.album_id, albums.c.cover_image_id.is_(None))
                        .values(cover_image_id=iid)
                        .returning(albums.c.id)
                    )
                    if hit is not None:
                        await record_change(s, row.account_id, "album", row.album_id)
                n["covers"] += 1
            await s.commit()
    for aid, paths in (batch.get("artists") or {}).items():
        values: dict[str, Any] = {}
        for col, key, kind in (
            ("image_id", "thumb", "artist"),
            ("cutout_id", "cutout", "artist_cutout"),
        ):
            if paths.get(key) and (iid := await image(paths[key], kind)):
                values[col] = iid
        if values:
            async with sm() as s:
                await s.execute(
                    sa.update(artists).where(artists.c.id == uuid.UUID(aid)).values(**values)
                )
                await s.commit()
            n["artists"] += 1
    return n
