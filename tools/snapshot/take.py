"""Take a prod snapshot → /mnt/data/musix-snapshots/<YYYY-MM-DD>/, read-only against prod.

- metadata.db: sqlite3 online backup (WAL-safe) from a mode=ro connection.
- qdrant/: every collection scrolled out by qdrant_dump.py in a throwaway container
  on the prod network (the prod Qdrant port is not published on the host).
- manifest.json: every library media file with size, mtime and sha256 (hash cache).
- derived.json: cache/transcoded and frontend/covers, listed without hashes.

The snapshot never leaves this machine (the directory is chmod 700).
Usage: uv run --project v2/server python v2/tools/snapshot/take.py [--date D] [--force]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import sqlite3
import subprocess
import time
from pathlib import Path

from hashcache import HashCache

ROOT = Path(os.environ.get("MUSIX_SNAPSHOTS", "/mnt/data/musix-snapshots"))
PROD_DB = Path(os.environ.get("MUSIX_PROD_DB", "/home/ivan/musix-db/metadata.db"))
PROD_NETWORK = "lyrics-search_default"
IMAGE = "musix-v2-server:dev"
REPO = Path(__file__).resolve().parents[3]
# Paths are recorded as the containers see them (Qdrant payloads and track_metadata
# use these); this is how they map onto the host.
HOST_MAP = {"/music/": "/mnt/data/music/", "/app/media/": f"{REPO}/media/"}
DERIVED = [REPO / "cache" / "transcoded", REPO / "frontend" / "covers"]


def to_host(p: str) -> Path | None:
    for c, h in HOST_MAP.items():
        if p.startswith(c):
            return Path(h + p[len(c):])
    return None


def backup_sqlite(dest: Path) -> None:
    src = sqlite3.connect(f"file:{PROD_DB}?mode=ro", uri=True)
    dst = sqlite3.connect(dest)
    with dst:
        src.backup(dst)
    src.close()
    dst.close()


def dump_qdrant(out: Path) -> None:
    out.mkdir()
    subprocess.run(["docker", "run", "--rm", "--network", PROD_NETWORK,
                    "--user", f"{os.getuid()}:{os.getgid()}",
                    "-v", f"{Path(__file__).parent}:/tool:ro", "-v", f"{out}:/out",
                    IMAGE, "python", "/tool/qdrant_dump.py", "http://qdrant:6333", "/out"],
                   check=True)


def media_manifest(db: Path, cache: HashCache) -> dict[str, object]:
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    paths = {r[0] for r in conn.execute("select distinct file_path from track_metadata "
                                        "where file_path is not null")}
    conn.close()
    uploads = REPO / "media"
    if uploads.exists():
        paths |= {"/app/media/" + str(p.relative_to(uploads)) for p in uploads.rglob("*") if p.is_file()}
    files, missing, t0 = [], [], time.time()
    for i, p in enumerate(sorted(paths)):
        host = to_host(p)
        if host is None or not host.exists():
            missing.append(p)
            continue
        size, mtime, digest = cache.sha256(host)
        files.append({"path": p, "size": size, "mtime": mtime, "sha256": digest})
        if (i + 1) % 500 == 0:
            print(f"manifest {i + 1}/{len(paths)} ({time.time() - t0:.0f}s)", flush=True)
    return {"host_map": HOST_MAP, "files": files, "missing": missing}


def derived_manifest() -> dict[str, object]:
    out: dict[str, object] = {}
    for d in DERIVED:
        out[str(d)] = [{"path": str(p.relative_to(d)), "size": p.stat().st_size, "mtime": p.stat().st_mtime}
                       for p in d.rglob("*") if p.is_file()] if d.exists() else []
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=dt.date.today().isoformat())
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    ROOT.mkdir(parents=True, exist_ok=True)
    ROOT.chmod(0o700)
    final, tmp = ROOT / a.date, ROOT / f".{a.date}.partial"
    if final.exists() and not a.force:
        raise SystemExit(f"{final} exists (use --force)")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir()
    t0 = time.time()
    backup_sqlite(tmp / "metadata.db")
    print(f"sqlite: {(tmp / 'metadata.db').stat().st_size / 1e6:.0f} MB", flush=True)
    dump_qdrant(tmp / "qdrant")
    cache = HashCache(ROOT / ".hashcache.sqlite")
    man = media_manifest(tmp / "metadata.db", cache)
    cache.close()
    man["taken_at"] = dt.datetime.now().isoformat(timespec="seconds")
    (tmp / "manifest.json").write_text(json.dumps(man))
    (tmp / "derived.json").write_text(json.dumps(derived_manifest()))
    if final.exists():
        shutil.rmtree(final)
    tmp.rename(final)
    print(f"snapshot {final}: {len(man['files'])} media files ({len(man['missing'])} missing), "
          f"hash cache {cache.hits} hits / {cache.misses} new, {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
