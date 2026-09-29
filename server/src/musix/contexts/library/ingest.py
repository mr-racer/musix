"""The ingest chain up to `register` (spec §5.1), run by the worker only.

hash → probe → tags → register. Each step is idempotent (keyed by sha256) and the file's
`state` makes a re-run resume where it stopped. Every catalog write is an upsert
(`INSERT … ON CONFLICT`), never select-then-insert.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import sqlalchemy as sa
import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.library import artist_split
from musix.contexts.library.models import (
    artists,
    jobs,
    lyrics,
    media_files,
    songs,
    track_artists,
    tracks,
    uploads,
)
from musix.contexts.library.sanitizer import sanitize_lyrics
from musix.contexts.library.slug import slugify
from musix.contexts.library.tags import get_metadata, read_embedded_lyrics
from musix.infra.changelog import notify, record_change

log = structlog.get_logger()
AUDIO_EXT = {
    ".flac",
    ".mp3",
    ".m4a",
    ".aac",
    ".ogg",
    ".opus",
    ".wav",
    ".aiff",
    ".wv",
    ".ape",
    ".wma",
}
SM = async_sessionmaker[AsyncSession]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


async def ffprobe(path: Path) -> dict[str, Any]:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await asyncio.wait_for(proc.communicate(), timeout=60)
    if proc.returncode != 0:
        raise ValueError(f"ffprobe failed on {path.name}")
    return dict(json.loads(out))


def probe_fields(p: dict[str, Any]) -> dict[str, Any]:
    a = next((s for s in p.get("streams", []) if s.get("codec_type") == "audio"), None)
    if a is None:
        raise ValueError("no audio stream")
    fmt = p.get("format", {})
    dur = float(a.get("duration") or fmt.get("duration") or 0)
    bits = a.get("bits_per_raw_sample") or a.get("bits_per_sample")
    br = a.get("bit_rate") or fmt.get("bit_rate")
    return {
        "container": fmt.get("format_name"),
        "codec": a.get("codec_name"),
        "sample_rate": int(a.get("sample_rate") or 0) or None,
        "bit_depth": int(bits) if bits else None,
        "channels": a.get("channels"),
        "bitrate_kbps": round(int(br) / 1000) if br else None,
        "duration_ms": round(dur * 1000) or None,
        "credits": credits(fmt.get("tags") or {}),
    }


# tag key (lowercased, as ffprobe reports Vorbis / ID3 / MP4 atoms) → credit role
CREDIT_TAGS = {
    "composer": "composer",
    "lyricist": "lyricist",
    "writer": "lyricist",
    "producer": "producer",
    "arranger": "arranger",
    "conductor": "conductor",
    "remixer": "remixer",
    "mixer": "mixer",
    "engineer": "engineer",
    "label": "label",
    "organization": "label",
    "publisher": "publisher",
    "copyright": "copyright",
    "isrc": "isrc",
    "tsrc": "isrc",
}


def credits(tags: dict[str, Any]) -> dict[str, list[str]] | None:
    """Who made it, from the file's own tags. Multi-value tags arrive ';'-joined."""
    out: dict[str, list[str]] = {}
    for k, v in tags.items():
        role = CREDIT_TAGS.get(k.lower())
        if role and v:
            for name in str(v).split(";"):
                if (n := name.strip()) and n not in out.setdefault(role, []):
                    out[role].append(n)
    return out or None


@dataclass
class Tags:
    title: str
    artist: str
    album_artist: str | None
    album: str
    year: int | None
    genre: str | None
    track_no: int | None
    disc_no: int | None
    lyrics: str | None


def read_tags(path: Path, probe: dict[str, Any]) -> Tags:
    """mutagen via v1's readers (FLAC/MP3/M4A), ffprobe's tags for everything else."""
    m = get_metadata(path) or {}
    t = {k.lower(): v for k, v in (probe.get("format", {}).get("tags") or {}).items()}

    def num(v: Any) -> int | None:
        try:
            return int(str(v).split("/")[0]) if v not in (None, "") else None
        except ValueError:
            return None

    title = m.get("title") or t.get("title") or path.stem
    raw_lyrics = (
        read_embedded_lyrics(path)
        if path.suffix.lower() in {".flac", ".mp3", ".m4a"}
        else t.get("lyrics")
    )
    return Tags(
        title=title,
        artist=m.get("artist") or t.get("artist") or "Unknown Artist",
        album_artist=m.get("album_artist") or t.get("album_artist") or t.get("albumartist"),
        album=m.get("album") or t.get("album") or "",
        year=m.get("year") or num(t.get("date")),
        genre=m.get("genre") or t.get("genre"),
        track_no=m.get("track_number") or num(t.get("track")),
        disc_no=m.get("disc_number") or num(t.get("disc")),
        lyrics=sanitize_lyrics(raw_lyrics),
    )


async def upsert_artist(s: AsyncSession, name: str) -> uuid.UUID:
    slug = artist_split.canonical_slug(name) or slugify(name)
    return uuid.UUID(
        str(
            await s.scalar(
                pg_insert(artists)
                .values(slug=slug, name=name)
                .on_conflict_do_update(index_elements=["slug"], set_={"slug": slug})
                .returning(artists.c.id)
            )
        )
    )


async def register(
    s: AsyncSession,
    account_id: uuid.UUID,
    media_file_id: uuid.UUID,
    tags: Tags,
    duration_ms: int | None,
) -> uuid.UUID:
    """Catalog + library rows for one file in one account, and their change_log entries."""
    main = artist_split.split_artists(tags.artist) or [tags.artist]
    parsed = artist_split.parse_title_feat(tags.title)
    feat = [n for n in [*parsed.feat_names, *parsed.with_names] if n not in main]
    main_ids = [await upsert_artist(s, n) for n in main]
    feat_ids = [await upsert_artist(s, n) for n in feat]
    primary = artist_split.primary_artist(tags.artist) or main[0]
    song_slug = f"{slugify(primary)}-{slugify(tags.title)}"
    song_id = await s.scalar(
        pg_insert(songs)
        .values(slug=song_slug, title=tags.title, primary_artist_id=main_ids[0])
        .on_conflict_do_update(index_elements=["slug"], set_={"slug": song_slug})
        .returning(songs.c.id)
    )
    album_id = None
    if tags.album:
        aa = await upsert_artist(s, tags.album_artist) if tags.album_artist else main_ids[0]
        album_id = await s.scalar(
            sa.text(
                "INSERT INTO albums (title, norm_title, album_artist_id, year) "
                "VALUES (:t, :n, :a, :y) "
                "ON CONFLICT (album_artist_id, norm_title, coalesce(year, 0)) "
                "DO UPDATE SET title = EXCLUDED.title RETURNING id"
            ),
            {"t": tags.album, "n": " ".join(tags.album.lower().split()), "a": aa, "y": tags.year},
        )
    values = {
        "account_id": account_id,
        "media_file_id": media_file_id,
        "song_id": song_id,
        "album_id": album_id,
        "title": tags.title,
        "title_display": parsed.clean_title if parsed.clean_title != tags.title else None,
        "artist_display": tags.artist,
        "disc_no": tags.disc_no,
        "track_no": tags.track_no,
        "year": tags.year,
        "genre": tags.genre,
        "duration_ms": duration_ms,
    }
    track_id = uuid.UUID(
        str(
            await s.scalar(
                pg_insert(tracks)
                .values(**values)
                .on_conflict_do_update(
                    index_elements=["account_id", "media_file_id"],
                    set_={
                        **{
                            k: v
                            for k, v in values.items()
                            if k not in ("account_id", "media_file_id")
                        },
                        "updated_at": sa.func.now(),
                        "deleted_at": None,
                    },
                )
                .returning(tracks.c.id)
            )
        )
    )
    await s.execute(sa.delete(track_artists).where(track_artists.c.track_id == track_id))
    rows = [
        {"track_id": track_id, "artist_id": a, "role": "main", "position": i}
        for i, a in enumerate(main_ids)
    ]
    rows += [
        {"track_id": track_id, "artist_id": a, "role": "feat", "position": i}
        for i, a in enumerate(feat_ids)
    ]
    await s.execute(pg_insert(track_artists).values(rows).on_conflict_do_nothing())
    if tags.lyrics:
        await s.execute(
            pg_insert(lyrics)
            .values(
                media_file_id=media_file_id,
                text=tags.lyrics,
                source="tag",
                sanitized_at=sa.func.now(),
            )
            .on_conflict_do_nothing(index_elements=["media_file_id"])
        )
    await record_change(s, account_id, "track", track_id)
    if album_id:
        await record_change(s, account_id, "album", album_id)
    for a in {*main_ids, *feat_ids}:
        await record_change(s, account_id, "artist", a)
    return track_id


OnRegistered = Callable[[uuid.UUID], Awaitable[None]] | None


async def ingest_file(
    sm: SM,
    account_id: uuid.UUID,
    path: Path,
    storage: str = "reference",
    on_registered: OnRegistered = None,
) -> uuid.UUID | None:
    """hash → probe → tags → register for one file. Returns the track id, or None on failure."""
    st = await asyncio.to_thread(path.stat)
    sha = await asyncio.to_thread(sha256_file, path)
    async with sm() as s:
        mf = await s.scalar(
            pg_insert(media_files)
            .values(
                sha256=sha,
                storage=storage,
                path=str(path),
                size_bytes=st.st_size,
                mtime=st.st_mtime,
            )
            .on_conflict_do_update(index_elements=["sha256"], set_={"sha256": sha})
            .returning(media_files.c.id)
        )
        mf_id = uuid.UUID(str(mf))
        state = await s.scalar(sa.select(media_files.c.state).where(media_files.c.id == mf_id))
        await s.commit()
    try:
        probe = await ffprobe(path)
        fields = probe_fields(probe)
        tags = await asyncio.to_thread(read_tags, path, probe)
    except (ValueError, TimeoutError, OSError) as e:
        async with sm() as s:
            await s.execute(
                sa.update(media_files)
                .where(media_files.c.id == mf_id)
                .values(state="failed", error=str(e))
            )
            await s.commit()
        log.warning("ingest_failed", path=str(path), error=str(e))
        return None
    async with sm() as s:
        await s.execute(
            sa.update(media_files)
            .where(media_files.c.id == mf_id)
            .values(
                **fields, state="registered" if state in ("registered", "media_done") else "probed"
            )
        )
        track_id = await register(s, account_id, mf_id, tags, fields["duration_ms"])
        await s.execute(
            sa.update(media_files)
            .where(media_files.c.id == mf_id, media_files.c.state == "probed")
            .values(state="registered")
        )
        await s.commit()
    if on_registered is not None:
        await on_registered(mf_id)
    return track_id


async def scan_folder(
    sm: SM, account_id: uuid.UUID, root: Path, on_registered: OnRegistered = None
) -> dict[str, int]:
    """Walk a granted folder; only new or changed files (by path, size, mtime) are ingested."""

    def walk() -> list[tuple[Path, int, float]]:  # directory walk + stat off the event loop
        out = []
        for d, _, fs in os.walk(root):
            for f in fs:
                if Path(f).suffix.lower() in AUDIO_EXT:
                    st = (Path(d) / f).stat()
                    out.append((Path(d) / f, st.st_size, st.st_mtime))
        return out

    stats = await asyncio.to_thread(walk)
    files = [p for p, _, _ in stats]
    async with sm() as s:
        known = (
            {
                r.path: (r.size_bytes, r.mtime, r.id)
                for r in await s.execute(
                    sa.select(
                        media_files.c.path,
                        media_files.c.size_bytes,
                        media_files.c.mtime,
                        media_files.c.id,
                    ).where(media_files.c.path.in_([str(f) for f in files]))
                )
            }
            if files
            else {}
        )
        mine: set[uuid.UUID] = set(
            (
                await s.scalars(
                    sa.select(tracks.c.media_file_id).where(
                        tracks.c.account_id == account_id, tracks.c.deleted_at.is_(None)
                    )
                )
            ).all()
        )
        job = await s.scalar(
            sa.insert(jobs)
            .values(account_id=account_id, kind="scan", total=len(files))
            .returning(jobs.c.id)
        )
        await s.commit()
    counts = {"files": len(files), "ingested": 0, "unchanged": 0, "failed": 0}
    last_pct = -1
    for i, (f, size, mtime) in enumerate(stats):
        k = known.get(str(f))
        if k and k[0] == size and k[1] == mtime and k[2] in mine:
            counts["unchanged"] += 1
        elif await ingest_file(sm, account_id, f, on_registered=on_registered):
            counts["ingested"] += 1
        else:
            counts["failed"] += 1
        pct = (i + 1) * 100 // len(files)
        if pct != last_pct and i + 1 < len(files):  # throttled to 1% steps
            last_pct = pct
            async with sm() as s:
                await s.execute(
                    sa.update(jobs)
                    .where(jobs.c.id == job)
                    .values(done=i + 1, updated_at=sa.func.now())
                )
                await notify(s, account_id, "job", job=job, done=i + 1, total=len(files))
                await s.commit()
    async with sm() as s:
        await s.execute(
            sa.update(jobs)
            .where(jobs.c.id == job)
            .values(state="done", done=len(files), updated_at=sa.func.now())
        )
        await notify(s, account_id, "job", job=job, done=len(files), total=len(files), state="done")
        await s.commit()
    return counts


async def finalize_upload(
    sm: SM, media_dir: Path, upload_id: uuid.UUID, on_registered: OnRegistered = None
) -> uuid.UUID | None:
    """Verify the declared sha256, move the file into managed storage, ingest it."""
    async with sm() as s:
        up = (await s.execute(sa.select(uploads).where(uploads.c.id == upload_id))).one()
    part = media_dir / "uploads" / f"{upload_id}.part"
    got = await asyncio.to_thread(sha256_file, part)
    if got != up.sha256:
        async with sm() as s:
            await s.execute(
                sa.update(uploads)
                .where(uploads.c.id == upload_id)
                .values(state="failed", error="sha256 mismatch", updated_at=sa.func.now())
            )
            await s.commit()
        return None  # the part is kept: the client can resend from its own copy
    ext = Path(up.filename).suffix.lower() or ".bin"
    dest = media_dir / got[:2] / f"{got}{ext}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    await asyncio.to_thread(shutil.move, str(part), str(dest))
    track = await ingest_file(
        sm, up.account_id, dest, storage="managed", on_registered=on_registered
    )
    async with sm() as s:
        await s.execute(
            sa.update(uploads)
            .where(uploads.c.id == upload_id)
            .values(state="done" if track else "failed", updated_at=sa.func.now())
        )
        await s.commit()
    return track
