"""Load a v1 prod snapshot into a dev v2 database — the first slice of the phase 3
migrator (accounts, library, lyrics, vectors, listens, signals, playlists).

It writes through v2's own code (`ingest.register`, `listening.ingest_listens`, the
playlist service), so the rows look exactly like v2's own. Vectors are COPIED from the
snapshot's Qdrant dump, never recomputed (phase 3 §4): v2's ml reproduces them
(Task 1 parity), and a copy costs minutes where a re-embed costs hours of CPU.

Usage (from v2/server):
    uv run python ../tools/migrate/load_snapshot.py /mnt/data/musix-snapshots/2026-09-29 \
        [--db musix_snap] [--reset]
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import gzip
import json
import sqlite3
import time
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any

import asyncpg
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from qdrant_client import models
from sqlalchemy.dialects.postgresql import insert as pg_insert

from musix.contexts.identity.models import account_settings, accounts, devices, instance
from musix.contexts.library import ingest
from musix.contexts.library.models import (
    library_files,
    lyrics,
    media_files,
    track_artists,
    tracks,
)
from musix.contexts.listening import schemas as LS
from musix.contexts.listening import service as listening
from musix.contexts.listening.models import taste_signals
from musix.contexts.playlists import schemas as PS
from musix.contexts.playlists import service as playlists
from musix.infra import db, vectors
from musix.settings import Settings

SERVER = Path(__file__).resolve().parents[2] / "server"
NS = uuid.UUID("5b1e7c0e-0000-4000-8000-000000000001")  # v1 ids → stable v2 client ids


def v1_time(s: str | float | None) -> dt.datetime | None:
    if not s:
        return None
    if isinstance(s, int | float):  # some v1 tables store unix seconds
        return dt.datetime.fromtimestamp(s, dt.UTC)
    t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=dt.UTC)  # v1 stored naive UTC


class Loader:
    def __init__(self, snap: Path, url: str, qdrant_url: str) -> None:
        self.snap = snap
        self.sq = sqlite3.connect(f"file:{snap / 'metadata.db'}?mode=ro", uri=True)
        self.sq.row_factory = sqlite3.Row
        self.engine = db.make_engine(Settings(_env_file=None, database_url=url), statement_timeout_ms=600_000)  # type: ignore[call-arg]
        self.sm = db.make_sessionmaker(self.engine)
        self.q = vectors.client(qdrant_url)
        man = json.loads((snap / "manifest.json").read_text())
        self.host_map: dict[str, str] = man["host_map"]
        self.by_path = {f["path"]: f for f in man["files"]}
        self.acct: dict[str, uuid.UUID] = {}  # v1 user hex → account
        self.device: dict[uuid.UUID, uuid.UUID] = {}
        self.track: dict[tuple[str, str], uuid.UUID] = {}  # (collection, v1 track id) → track
        self.mf_of_track: dict[uuid.UUID, uuid.UUID] = {}

    def host(self, p: str) -> str:
        for a, b in self.host_map.items():
            if p.startswith(a):
                return b + p[len(a):]
        return p

    def rows(self, sql: str, *args: Any) -> list[sqlite3.Row]:
        return list(self.sq.execute(sql, args))

    async def accounts(self) -> None:
        async with self.sm() as s:
            await s.execute(pg_insert(instance).values(mode="shared").on_conflict_do_nothing())
            for u in self.rows("select * from users order by created_at"):
                aid = await s.scalar(
                    sa.insert(accounts).values(
                        email=u["email"], password_hash=u["password_hash"],  # argon2id, carried as-is
                        role="owner" if u["role"] == "owner" else "member",
                        premium=bool(u["premium"]), index_root=u["index_root"],
                        created_at=v1_time(u["created_at"]), last_login_at=v1_time(u["last_login_at"]),
                    ).returning(accounts.c.id)
                )
                await s.execute(sa.insert(account_settings).values(account_id=aid, value={}))
                self.device[aid] = await s.scalar(
                    sa.insert(devices).values(account_id=aid, name="v1 import", platform="web")
                    .returning(devices.c.id)
                )
                self.acct[u["id"]] = aid
            # the migrator's id maps (phase 3 keeps them): tools and gates translate through them
            await s.execute(sa.text(
                "CREATE TABLE IF NOT EXISTS migr_account_map (v1_user_id text PRIMARY KEY, account_id uuid NOT NULL)"
            ))
            await s.execute(sa.text(
                "CREATE TABLE IF NOT EXISTS migr_track_map ("
                "v1_collection text NOT NULL, v1_track_id text NOT NULL, track_id uuid PRIMARY KEY)"
            ))
            for v1_id, aid in self.acct.items():
                await s.execute(sa.text("INSERT INTO migr_account_map VALUES (:v, :a)"), {"v": v1_id, "a": aid})
            await s.commit()

    async def library(self) -> None:
        rows = self.rows("select * from track_metadata order by collection_name, created_at")
        for i in range(0, len(rows), 500):
            async with self.sm() as s:
                for r in rows[i : i + 500]:
                    acct = self.acct.get(r["collection_name"].removeprefix("acct_"))
                    f = self.by_path.get(r["file_path"])
                    if acct is None or f is None:
                        continue
                    path = self.host(r["file_path"])
                    mf = await s.scalar(
                        pg_insert(media_files).values(
                            sha256=f["sha256"], storage="reference" if r["file_path"].startswith("/music/") else "managed",
                            path=path, size_bytes=f["size"], mtime=f["mtime"],
                            container=Path(path).suffix.lstrip(".").lower() or None,
                            bitrate_kbps=r["bitrate_kbps"], duration_ms=round((r["duration"] or 0) * 1000) or None,
                            axes=json.loads(r["sonic_axes"]) if r["sonic_axes"] else None,
                            sonic_tags=json.loads(r["sonic_tags"]) if r["sonic_tags"] else None,
                            state="registered", intel_state="indexed",
                        ).on_conflict_do_update(index_elements=["sha256"], set_={"sha256": f["sha256"]})
                        .returning(media_files.c.id)
                    )
                    tags = ingest.Tags(
                        title=r["title"] or Path(path).stem, artist=r["artist"] or "Unknown Artist",
                        album_artist=None, album=r["album"] or "", year=r["year"], genre=r["genre"],
                        track_no=r["track_number"], disc_no=r["disc_number"], lyrics=None,
                    )
                    tid = await ingest.register(s, acct, mf, tags, round((r["duration"] or 0) * 1000) or None)
                    await s.execute(
                        sa.update(tracks).where(tracks.c.id == tid).values(added_at=v1_time(r["created_at"]))
                    )
                    await s.execute(
                        pg_insert(library_files).values(
                            account_id=acct, path=path, size_bytes=f["size"], mtime=f["mtime"], media_file_id=mf
                        ).on_conflict_do_nothing()
                    )
                    self.track[(r["collection_name"], r["track_id"])] = tid
                    self.mf_of_track[tid] = mf
                    await s.execute(sa.text("INSERT INTO migr_track_map VALUES (:c, :v, :t)"),
                                    {"c": r["collection_name"], "v": r["track_id"], "t": tid})
                await s.commit()
            print(f"  tracks {min(i + 500, len(rows))}/{len(rows)}", flush=True)

    async def points(self) -> None:
        """One point per content: the first account's vectors, every owner in `owners`."""
        await vectors.ensure(self.q)
        async with self.sm() as s:
            owners: dict[uuid.UUID, list[str]] = defaultdict(list)
            for mf, acct in await s.execute(sa.select(tracks.c.media_file_id, tracks.c.account_id).distinct()):
                owners[mf].append(str(acct))
            arts: dict[uuid.UUID, list[str]] = defaultdict(list)
            first_track: dict[uuid.UUID, Any] = {}
            for r in await s.execute(
                sa.select(tracks.c.id, tracks.c.media_file_id, tracks.c.album_id, tracks.c.genre, tracks.c.year,
                          tracks.c.duration_ms).order_by(tracks.c.added_at)
            ):
                first_track.setdefault(r.media_file_id, r)
            for tid, aid in await s.execute(
                sa.select(track_artists.c.track_id, track_artists.c.artist_id)
                .order_by(track_artists.c.role != "main", track_artists.c.position)  # main first, then feat
            ):
                arts[tid].append(str(aid))
            axes = dict((await s.execute(sa.select(media_files.c.id, media_files.c.axes))).all())
        done: set[uuid.UUID] = set()
        batch: list[models.PointStruct] = []
        lyric_rows: list[dict[str, Any]] = []
        for f in sorted((self.snap / "qdrant").glob("acct_*.jsonl.gz"), key=lambda p: p.stat().st_size, reverse=True):
            coll = f.name.removesuffix(".jsonl.gz")
            with gzip.open(f, "rt", encoding="utf-8") as fh:
                for line in fh:
                    r = json.loads(line)
                    tid = self.track.get((coll, str(r["id"])))
                    mf = self.mf_of_track.get(tid) if tid else None
                    if mf is None or mf in done:
                        continue
                    done.add(mf)
                    v = r["vector"]
                    vec: dict[str, Any] = {}
                    if "text" in v:
                        vec["text"] = v["text"]
                    if "clap" in v:
                        vec["clap"] = v["clap"]
                    if v.get("bm25", {}).get("indices"):
                        vec["bm25"] = models.SparseVector(indices=v["bm25"]["indices"], values=v["bm25"]["values"])
                    if r["payload"].get("clap_chunks"):
                        vec["clap_chunks"] = r["payload"]["clap_chunks"]
                    t = first_track[mf]
                    payload = {
                        "owners": sorted(owners[mf]), "artist_ids": arts.get(t.id, []),
                        "album_id": str(t.album_id) if t.album_id else None, "genre": t.genre,
                        "year": t.year, "duration_ms": t.duration_ms, **(axes.get(mf) or {}),
                    }
                    batch.append(models.PointStruct(id=str(mf), vector=vec, payload=payload))
                    if r["payload"].get("lyrics"):
                        lyric_rows.append({"media_file_id": mf, "text": r["payload"]["lyrics"], "source": "v1"})
                    if len(batch) >= 64:
                        await self.q.upsert(vectors.TRACKS, batch, wait=True)
                        batch = []
            print(f"  points after {coll}: {len(done)}", flush=True)
        if batch:
            await self.q.upsert(vectors.TRACKS, batch, wait=True)
        async with self.sm() as s:
            for i in range(0, len(lyric_rows), 1000):
                await s.execute(pg_insert(lyrics).values(lyric_rows[i : i + 1000]).on_conflict_do_nothing())
            await s.commit()

    async def listens(self) -> None:
        by_acct: dict[uuid.UUID, list[LS.ListenIn]] = defaultdict(list)
        for e in self.rows("select * from playback_events order by played_at, id"):
            tid = self.track.get((e["collection_name"], e["track_id"]))
            acct = self.acct.get(e["collection_name"].removeprefix("acct_"))
            if tid is None or acct is None:
                continue
            dur = e["total_dur"] or 0
            played = e["played_sec"] or 0
            reason = "completed" if dur and played >= 0.9 * dur else "skipped" if e["skipped_early"] else "stopped"
            by_acct[acct].append(LS.ListenIn(
                client_event_id=uuid.uuid5(NS, f"event:{e['id']}"), session_id=e["session_id"] or "v1",
                track_id=tid, started_at=v1_time(e["played_at"]), played_ms=round(played * 1000),
                duration_ms=round(dur * 1000) or None, end_reason=reason,
                skipped_early=bool(e["skipped_early"]), interacted=bool(e["interacted"]),
                influence=bool(e["influence"]) if e["influence"] is not None else True, source=e["source"],
            ))
        for acct, evs in by_acct.items():
            for i in range(0, len(evs), 100):
                async with self.sm() as s:
                    await listening.ingest_listens(s, acct, self.device[acct], LS.ListenBatchIn(events=evs[i : i + 100]))
        async with self.sm() as s:
            for g in self.rows("select * from taste_signals order by created_at"):
                tid = self.track.get((g["collection_name"], g["track_id"]))
                acct = self.acct.get(g["collection_name"].removeprefix("acct_"))
                if tid and acct:
                    await s.execute(pg_insert(taste_signals).values(
                        client_event_id=uuid.uuid5(NS, f"signal:{g['id']}"), account_id=acct,
                        session_id=g["session_id"], track_id=tid, kind=g["kind"], created_at=v1_time(g["created_at"]),
                    ).on_conflict_do_nothing())
            await s.commit()

    async def playlists(self) -> None:
        for p in self.rows("select * from playlists order by created_at"):
            acct = self.acct.get(p["collection_name"].removeprefix("acct_"))
            if acct is None:
                continue
            items = [self.track.get((p["collection_name"], t["track_id"]))
                     for t in self.rows("select * from playlist_tracks where playlist_id = ? order by position", p["id"])]
            async with self.sm() as s:
                pl = await playlists.create(s, acct, PS.PlaylistIn(name=p["name"], description=p["description"]))
            if any(items):
                async with self.sm() as s:
                    await playlists.add_items(s, acct, pl.id, PS.ItemsAdd(items=[PS.ItemIn(track_id=t) for t in items if t]))

    async def report(self) -> None:
        async with self.sm() as s:
            for u, aid in self.acct.items():
                n_t = await s.scalar(sa.select(sa.func.count()).where(tracks.c.account_id == aid))
                n_e = await s.scalar(sa.text("select count(*) from listen_events where account_id = :a"), {"a": aid})
                v1_t = self.sq.execute("select count(*) from track_metadata where collection_name = ?", (f"acct_{u}",)).fetchone()[0]
                v1_e = self.sq.execute("select count(*) from playback_events where collection_name = ?", (f"acct_{u}",)).fetchone()[0]
                print(f"  {u[:8]}: tracks {n_t}/{v1_t}  listens {n_e}/{v1_e}")
        info = await self.q.get_collection(vectors.TRACKS)
        print(f"  qdrant tracks: {info.points_count} points")

    async def close(self) -> None:
        await self.q.close()
        await self.engine.dispose()


async def prepare(admin_dsn: str, name: str, reset: bool, qdrant_url: str) -> str:
    conn = await asyncpg.connect(admin_dsn)
    exists = await conn.fetchval("select 1 from pg_database where datname = $1", name)
    url = admin_dsn.rsplit("/", 1)[0] + f"/{name}"
    if exists and reset:
        # the old load's points first: they are owned by accounts about to disappear
        old = await asyncpg.connect(url)
        try:
            ids = [str(r[0]) for r in await old.fetch("select id from accounts")]
        except asyncpg.UndefinedTableError:  # a load that died before its schema existed
            ids = []
        await old.close()
        if ids:
            q = vectors.client(qdrant_url)
            if await q.collection_exists(vectors.TRACKS):
                await q.delete(vectors.TRACKS, points_selector=models.FilterSelector(filter=models.Filter(
                    must=[models.FieldCondition(key="owners", match=models.MatchAny(any=ids))])), wait=True)
            await q.close()
        await conn.execute(f'DROP DATABASE "{name}" WITH (FORCE)')
        exists = False
    if not exists:
        await conn.execute(f'CREATE DATABASE "{name}"')
    await conn.close()
    cfg = Config(str(SERVER / "alembic.ini"))
    cfg.set_main_option("script_location", str(SERVER / "migrations"))
    cfg.attributes["url"] = Settings(_env_file=None, database_url=url).sqlalchemy_sync_url  # type: ignore[call-arg]
    await asyncio.to_thread(command.upgrade, cfg, "head")
    return url


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("snapshot", type=Path)
    ap.add_argument("--db", default="musix_snap")
    ap.add_argument("--admin", default="postgresql://musix:musix@127.0.0.1:18432/musix")
    ap.add_argument("--qdrant", default="http://127.0.0.1:18333")
    ap.add_argument("--reset", action="store_true", help="drop the database first (the Qdrant points of the old load stay: ids are fresh uuids)")
    a = ap.parse_args()
    url = await prepare(a.admin, a.db, a.reset, a.qdrant)
    ld = Loader(a.snapshot, url, a.qdrant)
    async with ld.sm() as s:
        if await s.scalar(sa.select(sa.func.count()).select_from(accounts)):
            print(f"{a.db} is already loaded (use --reset)")
            await ld.close()
            return
    for step in (ld.accounts, ld.library, ld.points, ld.listens, ld.playlists, ld.report):
        t = time.time()
        print(f"{step.__name__}…", flush=True)
        await step()
        print(f"  {time.time() - t:.0f} s", flush=True)
    await ld.close()


if __name__ == "__main__":
    asyncio.run(main())
