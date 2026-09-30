"""The migrator's `files` stage (phase 3 spec §5). Runs on the host: v1's media and v2's
media dir are one filesystem there, and a hardlink cannot cross a bind mount (EXDEV).

- managed uploads (`/app/media/<account>/audio/<sha>.<ext>`) → hardlinked to
  `<media>/<sha[:2]>/<sha><ext>`; `media_files.path` follows. `/music` stays referenced.
- every media file gets its `lossless` link in the tier dir (what `media:process` does).
- v1's transcodes (`cache/transcoded/<acct>/<track>.flac|.m4a`: ALAC → FLAC, Dolby → AAC)
  → hardlinked as the `lossless_compat` rendition, when newer than the source.
- track covers and artist photos → hardlinked under `<media>/import/v1/`, then imported
  by `media:import_images` jobs on the target database, drained by a one-shot worker
  (the host has no libvips; the server image does).
- AAC `high`/`economy` tiers are NOT built (spec §5): `media:backfill` at idle time."""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

import sqlalchemy as sa

from musix.contexts.library.models import media_files, renditions, tracks
from musix.contexts.media import audio

# the target stack: dev by default; the prod stack sets both (make prod-migrate)
MEDIA = Path(os.environ.get("MUSIX_MIGRATE_MEDIA", "/mnt/data/musix-v2-media"))
BATCH = 150
COMPOSE = Path(os.environ.get("MUSIX_MIGRATE_COMPOSE", Path(__file__).resolve().parents[2] / "deploy" / "compose.dev.yml"))


COPY_FOREIGN = False  # set by --copy-foreign (dev): see _link


def _link(src: Path, dst: Path) -> str:
    """'linked' | 'copied' | 'exists' | 'missing' | 'foreign' | 'error:<errno>'.

    A file another user owns (v1's container wrote its uploads and transcodes as root)
    cannot be hardlinked under fs.protected_hardlinks: the cutover runs the tool as
    root; a dev run copies it with --copy-foreign, or leaves it ('foreign')."""
    if not src.is_file():
        return "missing"
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        return "exists"
    try:
        os.link(src, dst)
    except PermissionError:
        if not COPY_FOREIGN:
            return "foreign"
        tmp = dst.with_suffix(dst.suffix + ".part")
        shutil.copy2(src, tmp)
        tmp.rename(dst)
        return "copied"
    except OSError as e:
        return f"error:{e.errno}"
    return "linked"


def _duration(p: Path) -> float | None:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True, timeout=60)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return None


def _symlink(src: Path, dst: Path) -> bool:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if os.path.lexists(dst):
        return False
    os.symlink(src, dst)
    return True


async def run_files(m: Any) -> dict[str, Any]:
    from migrate import V1_ROOT

    n: dict[str, Any] = {"uploads": {}, "lossless_links": 0, "compat": 0, "compat_stale": 0, "covers": 0, "artist_images": 0}
    async with m.sm() as s:
        mfs = (await s.execute(sa.select(media_files.c.id, media_files.c.sha256, media_files.c.path, media_files.c.storage,
                                         media_files.c.mtime))).all()
    # 1. managed uploads: hardlinks into v2's content-addressed layout
    moves = []
    for r in mfs:
        if r.storage != "managed" or r.path.startswith(str(MEDIA)):
            continue
        src = Path(r.path)
        dst = MEDIA / r.sha256[:2] / f"{r.sha256}{src.suffix.lower()}"
        res = await asyncio.to_thread(_link, src, dst)
        n["uploads"][res.split(":")[0]] = n["uploads"].get(res.split(":")[0], 0) + 1
        if res in ("linked", "copied", "exists"):
            moves.append((r.id, str(dst)))
    async with m.sm() as s:
        for mid, path in moves:
            await s.execute(sa.update(media_files).where(media_files.c.id == mid).values(path=path))
        await s.commit()
    paths = {r.id: (dict(moves).get(r.id) or r.path) for r in mfs}
    # 2. the lossless link per media file
    for r in mfs:
        if await asyncio.to_thread(_symlink, Path(paths[r.id]).resolve(),
                                   audio.tier_dir(MEDIA, r.sha256) / f"lossless{Path(paths[r.id]).suffix.lower()}"):
            n["lossless_links"] += 1
    # 3. v1's transcodes as lossless_compat
    async with m.sm() as s:
        mf_of = {str(t): mf for t, mf in (await s.execute(sa.select(tracks.c.id, tracks.c.media_file_id))).all()}
    by_id = {r.id: r for r in mfs}
    rend = []
    for acct_dir in (V1_ROOT / "cache" / "transcoded").glob("acct_*"):
        for f in acct_dir.iterdir():
            mid = mf_of.get(f.stem)
            if mid is None or f.suffix not in (".flac", ".m4a"):
                continue
            r = by_id[mid]
            if f.stat().st_mtime < (r.mtime or 0):
                # the source was touched after the transcode (v1 rewrote tags in place): the
                # audio is the same when the durations are — otherwise media:process redoes it
                a, b = await asyncio.to_thread(_duration, f), await asyncio.to_thread(_duration, Path(paths[mid]))
                if a is None or b is None or abs(a - b) > 0.2:
                    n["compat_stale"] += 1
                    continue
            dst = audio.tier_dir(MEDIA, r.sha256) / f"lossless_compat{f.suffix}"
            res = await asyncio.to_thread(_link, f, dst)
            n["compat_links"] = n.get("compat_links", {})
            n["compat_links"][res.split(":")[0]] = n["compat_links"].get(res.split(":")[0], 0) + 1
            if res in ("linked", "copied", "exists"):
                rend.append({"media_file_id": mid, "tier": "lossless_compat", "path": str(dst),
                             "codec": "flac" if f.suffix == ".flac" else "aac",
                             "bitrate_kbps": None if f.suffix == ".flac" else 320, "size_bytes": dst.stat().st_size})
    async with m.sm() as s:
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        for row in rend:
            await s.execute(pg_insert(renditions).values(**row).on_conflict_do_nothing())
        await s.commit()
    n["compat"] = len(rend)
    # 4. covers and artist photos → import jobs, drained by a one-shot worker
    imp = MEDIA / "import" / "v1"
    covers: dict[str, str] = {}
    for r in m.rows("select track_id, cover_art_path from track_metadata where cover_art_path is not null"):
        src = V1_ROOT / "frontend" / r["cover_art_path"].lstrip("/")
        dst = imp / "covers" / src.name
        if await asyncio.to_thread(_link, src, dst) in ("linked", "copied", "exists"):
            covers[r["track_id"]] = str(dst)
    async with m.sm() as s:
        artist_ids = dict((await s.execute(sa.text("SELECT slug, id::text FROM artists"))).all())
    arts: dict[str, dict[str, str]] = {}
    for r in m.rows("select slug, thumb_path, cutout_path from artists where thumb_path is not null or cutout_path is not null"):
        aid = artist_ids.get(r["slug"])
        if aid is None:
            continue
        for key, col in (("thumb", "thumb_path"), ("cutout", "cutout_path")):
            if r[col]:
                src = V1_ROOT / "frontend" / r[col].lstrip("/")
                dst = imp / "artists" / src.name
                if await asyncio.to_thread(_link, src, dst) in ("linked", "copied", "exists"):
                    arts.setdefault(aid, {})[key] = str(dst)
    n["covers"], n["artist_images"] = len(covers), sum(len(v) for v in arts.values())
    batches: list[dict[str, Any]] = []
    items = list(covers.items())
    for i in range(0, len(items), BATCH):
        batches.append({"covers": dict(items[i : i + BATCH])})
    aitems = list(arts.items())
    for i in range(0, len(aitems), BATCH):
        batches.append({"artists": dict(aitems[i : i + BATCH])})
    from procrastinate import App, PsycopgConnector

    async with m.sm() as s:  # a re-run replaces the batches of an earlier one
        await s.execute(sa.text("DELETE FROM procrastinate_jobs WHERE task_name = 'media:import_images' AND status <> 'doing'"))
        await s.commit()
    app = App(connector=PsycopgConnector(conninfo=m.url))
    async with app.open_async():
        for b in batches:
            await app.configure_task("media:import_images", queue="media").defer_async(batch=b)
    n["image_jobs"] = len(batches)
    n["image_worker"] = await asyncio.to_thread(_drain, m.url)
    return n


def _drain(url: str) -> str:
    """A one-shot worker of the server image on the target database's `media` queue."""
    db = url.rsplit("/", 1)[1]
    cmd = ["docker", "compose", "-f", str(COMPOSE), "run", "--rm", "--no-deps",
           "-e", f"MUSIX_DATABASE_URL=postgresql://musix:{os.environ.get('MUSIX_PG_PASSWORD', 'musix')}@postgres:5432/{db}",
           "worker", "procrastinate", "--app=musix.workers.app.app", "worker",
           "--queues", "media", "--concurrency", "3", "--one-shot"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
    return "ok" if r.returncode == 0 else f"exit {r.returncode}: {r.stderr.strip()[-300:]}"
