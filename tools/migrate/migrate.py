"""The v1 → v2 migrator (phase 3 spec): a phase 0 snapshot in, a populated v2 out.

    uv run python ../tools/migrate/migrate.py run /mnt/data/musix-snapshots/2026-09-29 \
        --db musix_mig [--stages accounts,library,...] [--dry-run]

Stages, in order (each re-runnable alone — every row is keyed by an id that survives a
re-run: v1's account and track ids, uuid5 of v1's event/signal/playlist ids, sha256 for
media, slugs for the catalog; so a stage upserts instead of truncating what later stages
built on):

    accounts   users → accounts (v1 ids, argon2id hashes as-is), a `legacy-v1` device,
               invites, instance and its LLM settings, per-account settings
    library    media_files from the manifest (sha256), tracks with v1 ids through ingest's
               own `register`, library_files; the artist split compared with v1's
    vectors    Qdrant: text / bm25 / clap copied, clap_chunks → multivector, owners; lyrics
    knowledge  facts, refinements and v1's refinement sets, bios, relations, vibe lines,
               aliases, the negative cache, MusicBrainz verdicts, AudioDB profiles
    listening  listen events through the listening service (the stats are v2's own),
               signals, playlists (fractional keys in v1's order)
    misc       answered quiz rounds + skill, Yandex import history (+ tokens with the v1 key)
    files      managed uploads hardlinked, `lossless` links, v1's transcodes as
               lossless_compat renditions, covers and artist images queued to the worker
    post       the «Поток» state jobs and the ranker train queued
    verify     the migration gate (verify.py)

`--dry-run` skips `files` (no hardlink, no media-dir write) and still verifies."""

from __future__ import annotations

import argparse
import asyncio
import base64
import datetime as dt
import gzip
import hashlib
import json
import os
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

from musix.contexts.identity.models import account_settings, accounts, devices, instance, instance_settings, invites
from musix.contexts.library import ingest
from musix.contexts.library.models import library_files, lyrics, media_files, track_artists, tracks
from musix.contexts.listening import schemas as LS
from musix.contexts.listening import service as listening
from musix.contexts.listening.models import taste_signals
from musix.contexts.playlists import schemas as PS
from musix.contexts.playlists import service as playlists
from musix.contexts.playlists.models import playlist_items
from musix.infra import db, vectors
from musix.settings import Settings

SERVER = Path(__file__).resolve().parents[2] / "server"
NS = uuid.UUID("5b1e7c0e-0000-4000-8000-000000000001")  # v1 ids → stable v2 ids (as phase 2's loader)
STAGES = ["accounts", "library", "vectors", "knowledge", "listening", "misc", "files", "post", "verify"]
DEVICE = "legacy-v1"
V1_ROOT = Path("/mnt/data/lyrics-search")  # v1's tree: covers, transcodes, media (read-only)
# stream spec §4: v1's liked-share slider → a familiarity preset
LIKED_SHARE = [(0.0, "unfamiliar"), (0.8, "favorites")]


def v1_time(s: Any) -> dt.datetime | None:
    if s is None or s == "":
        return None
    if isinstance(s, int | float):  # some v1 tables store unix seconds
        return dt.datetime.fromtimestamp(s, dt.UTC)
    t = dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=dt.UTC)  # v1 stored naive UTC


def account_id(v1_user: str) -> uuid.UUID:
    return uuid.UUID(hex=v1_user.replace("-", ""))


def familiarity(share: float | None) -> str | None:
    if share is None:
        return None
    if share <= LIKED_SHARE[0][0]:
        return LIKED_SHARE[0][1]
    return LIKED_SHARE[1][1] if share >= LIKED_SHARE[1][0] else "mix"


def end_reason(played: float, dur: float, skipped_early: bool) -> str:
    """Spec §3: completed if ≥ 90 % was heard, else skipped if v1 flagged an early skip."""
    if dur and played >= 0.9 * dur:
        return "completed"
    return "skipped" if skipped_early else "stopped"


class Migrator:
    def __init__(self, snap: Path, url: str, qdrant_url: str, dry_run: bool = False) -> None:
        self.snap, self.dry_run, self.url = snap, dry_run, url
        self.sq = sqlite3.connect(f"file:{snap / 'metadata.db'}?mode=ro", uri=True)
        self.sq.row_factory = sqlite3.Row
        self.engine = db.make_engine(Settings(_env_file=None, database_url=url), statement_timeout_ms=600_000)  # type: ignore[call-arg]
        self.sm = db.make_sessionmaker(self.engine)
        self.q = vectors.client(qdrant_url)
        man = json.loads((snap / "manifest.json").read_text())
        self.host_map: dict[str, str] = man["host_map"]
        self.by_path = {f["path"]: f for f in man["files"]}
        self.counts: dict[str, dict[str, Any]] = {}

    # ── helpers ──────────────────────────────────────────────────────────────

    def host(self, p: str) -> str:
        for a, b in self.host_map.items():
            if p.startswith(a):
                return b + p[len(a) :]
        return p

    def rows(self, sql: str, *args: Any) -> list[sqlite3.Row]:
        return list(self.sq.execute(sql, args))

    def accounts_v1(self) -> dict[str, uuid.UUID]:
        """collection `acct_<hex>` → account id (v1's id, kept)."""
        return {f"acct_{u['id'].replace('-', '')}": account_id(u["id"]) for u in self.rows("select id from users")}

    async def device_of(self) -> dict[uuid.UUID, uuid.UUID]:
        async with self.sm() as s:
            return dict((await s.execute(sa.select(devices.c.account_id, devices.c.id).where(devices.c.name == DEVICE))).all())

    def live_tracks(self) -> dict[str, str]:
        """v1 track id → collection, for the tracks the library stage migrates."""
        return {r["track_id"]: r["collection_name"] for r in self.rows("select track_id, collection_name from track_metadata")}

    # ── stages ───────────────────────────────────────────────────────────────

    async def accounts(self) -> dict[str, Any]:
        n = {"accounts": 0, "invites": 0}
        async with self.sm() as s:
            mode = "shared"  # v1 'server'/'sharing' both ran one shared box; phase 2 loaded it so
            await s.execute(pg_insert(instance).values(mode=mode).on_conflict_do_nothing())
            for u in self.rows("select * from users order by created_at"):
                vals = {"email": u["email"], "password_hash": u["password_hash"],  # argon2id, as-is
                        "role": "owner" if u["role"] == "owner" else "member", "premium": bool(u["premium"]),
                        "index_root": u["index_root"], "created_at": v1_time(u["created_at"]),
                        "last_login_at": v1_time(u["last_login_at"])}
                aid = account_id(u["id"])
                await s.execute(pg_insert(accounts).values(id=aid, **vals).on_conflict_do_update(index_elements=["id"], set_=vals))
                dev = uuid.uuid5(NS, f"device:{u['id']}")
                await s.execute(pg_insert(devices).values(id=dev, account_id=aid, name=DEVICE, platform="web").on_conflict_do_nothing())
                n["accounts"] += 1
            for r in self.rows("select * from collection_settings"):
                aid = account_id(r["collection_name"].removeprefix("acct_"))
                value: dict[str, Any] = {"aiEnabled": bool(r["ai_enabled"])}
                fam = familiarity(r["stream_liked_share"])
                if fam:
                    value["stream"] = {"familiarity": fam, "sound": None}
                await s.execute(pg_insert(account_settings).values(account_id=aid, value=value)
                                .on_conflict_do_update(index_elements=["account_id"], set_={"value": value}))
            known = {account_id(u["id"]) for u in self.rows("select id from users")}
            for r in self.rows("select * from invites"):
                by = account_id(r["created_by"])
                if by not in known:
                    continue
                vals = {"created_by": by, "created_at": v1_time(r["created_at"]), "expires_at": v1_time(r["expires_at"]),
                        "consumed_by": account_id(r["consumed_by"]) if r["consumed_by"] else None,
                        "consumed_at": v1_time(r["consumed_at"])}
                await s.execute(pg_insert(invites).values(code=r["code"], **vals).on_conflict_do_update(index_elements=["code"], set_=vals))
                n["invites"] += 1
            settings = {r["key"]: r["value"] for r in self.rows("select key, value from instance_settings")}
            llm = {"baseUrl": settings.get("LLM_BASE_URL") or None, "model": settings.get("LLM_MODEL") or None}
            await s.execute(pg_insert(instance_settings).values(key="llm", value=llm)
                            .on_conflict_do_update(index_elements=["key"], set_={"value": llm}))
            # the migrator's id maps (the gates and tools translate through them)
            await s.execute(sa.text("CREATE TABLE IF NOT EXISTS migr_account_map (v1_user_id text PRIMARY KEY, account_id uuid NOT NULL)"))
            await s.execute(sa.text("CREATE TABLE IF NOT EXISTS migr_track_map (v1_collection text NOT NULL, v1_track_id text NOT NULL, track_id uuid PRIMARY KEY)"))
            await s.execute(sa.text("CREATE TABLE IF NOT EXISTS migr_runs (stage text, started_at timestamptz, seconds real, counts jsonb)"))
            for u in self.rows("select id from users"):
                await s.execute(sa.text("INSERT INTO migr_account_map VALUES (:v, :a) ON CONFLICT DO NOTHING"),
                                {"v": u["id"], "a": account_id(u["id"])})
            await s.commit()
        return n

    async def library(self) -> dict[str, Any]:
        accts = self.accounts_v1()
        n = {"tracks": 0, "media_files": 0, "no_file": 0, "split_differs": 0}
        rows = self.rows("select * from track_metadata order by collection_name, created_at")
        v1_slugs: dict[str, list[str]] = defaultdict(list)
        for r in self.rows("select track_id, artist_slug from track_artist_slugs order by track_id"):
            v1_slugs[r["track_id"]].append(r["artist_slug"])
        for i in range(0, len(rows), 500):
            async with self.sm() as s:
                for r in rows[i : i + 500]:
                    acct, f = accts.get(r["collection_name"]), self.by_path.get(r["file_path"])
                    if acct is None or f is None:
                        n["no_file"] += 1
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
                        title=r["title"] or Path(path).stem, artist=r["artist"] or "Unknown Artist", album_artist=None,
                        album=r["album"] or "", year=r["year"], genre=r["genre"], track_no=r["track_number"],
                        disc_no=r["disc_number"], lyrics=None,
                    )
                    tid = await ingest.register(s, acct, mf, tags, round((r["duration"] or 0) * 1000) or None,
                                                track_id=uuid.UUID(r["track_id"]))
                    await s.execute(sa.update(tracks).where(tracks.c.id == tid).values(added_at=v1_time(r["created_at"])))
                    await s.execute(pg_insert(library_files).values(account_id=acct, path=path, size_bytes=f["size"],
                                                                    mtime=f["mtime"], media_file_id=mf).on_conflict_do_nothing())
                    await s.execute(sa.text("INSERT INTO migr_track_map VALUES (:c, :v, :t) ON CONFLICT DO NOTHING"),
                                    {"c": r["collection_name"], "v": r["track_id"], "t": tid})
                    n["tracks"] += 1
                await s.commit()
        async with self.sm() as s:  # spec §3: the artist split re-run, compared with v1's (reported, not guessed)
            ours: dict[str, list[str]] = defaultdict(list)
            for tid, slug in await s.execute(sa.text(
                "SELECT ta.track_id::text, a.slug FROM track_artists ta JOIN artists a ON a.id = ta.artist_id "
                "ORDER BY ta.track_id, ta.role <> 'main', ta.position")):
                ours[tid].append(slug)
            n["media_files"] = await s.scalar(sa.select(sa.func.count()).select_from(media_files))
        n["split_differs"] = sum(1 for t, sl in v1_slugs.items() if t in ours and sorted(ours[t]) != sorted(sl))
        n["split_compared"] = sum(1 for t in v1_slugs if t in ours)
        return n

    async def vectors(self) -> dict[str, Any]:
        """One point per content: the first account's vectors, every owner in `owners`."""
        await vectors.ensure(self.q)
        accts = list(self.accounts_v1().values())
        await self.q.delete(vectors.TRACKS, points_selector=models.FilterSelector(filter=models.Filter(
            should=[models.FieldCondition(key="owners", match=models.MatchValue(value=str(a))) for a in accts])))
        async with self.sm() as s:
            owners: dict[uuid.UUID, list[str]] = defaultdict(list)
            for mf, acct in await s.execute(sa.select(tracks.c.media_file_id, tracks.c.account_id).distinct()):
                owners[mf].append(str(acct))
            first: dict[uuid.UUID, Any] = {}
            for r in await s.execute(sa.select(tracks.c.id, tracks.c.media_file_id, tracks.c.album_id, tracks.c.genre,
                                               tracks.c.year, tracks.c.duration_ms).order_by(tracks.c.added_at)):
                first.setdefault(r.media_file_id, r)
            arts: dict[uuid.UUID, list[str]] = defaultdict(list)
            for tid, aid in await s.execute(sa.select(track_artists.c.track_id, track_artists.c.artist_id)
                                            .order_by(track_artists.c.role != "main", track_artists.c.position)):
                arts[tid].append(str(aid))
            axes = dict((await s.execute(sa.select(media_files.c.id, media_files.c.axes))).all())
            mf_of = dict((str(t), m) for t, m in (await s.execute(sa.select(tracks.c.id, tracks.c.media_file_id))).all())
        done: set[uuid.UUID] = set()
        batch: list[models.PointStruct] = []
        lyric_rows: list[dict[str, Any]] = []
        n = {"points": 0, "with_chunks": 0, "lyrics": 0}
        for f in sorted((self.snap / "qdrant").glob("acct_*.jsonl.gz"), key=lambda p: p.stat().st_size, reverse=True):
            with gzip.open(f, "rt", encoding="utf-8") as fh:
                for line in fh:
                    r = json.loads(line)
                    mf = mf_of.get(str(r["id"]))
                    if mf is None or mf in done:
                        continue
                    done.add(mf)
                    v = r["vector"]
                    vec: dict[str, Any] = {k: v[k] for k in ("text", "clap") if k in v}
                    if v.get("bm25", {}).get("indices"):
                        vec["bm25"] = models.SparseVector(indices=v["bm25"]["indices"], values=v["bm25"]["values"])
                    if r["payload"].get("clap_chunks"):
                        vec["clap_chunks"] = r["payload"]["clap_chunks"]
                        n["with_chunks"] += 1
                    t = first[mf]
                    payload = {"owners": sorted(owners[mf]), "artist_ids": arts.get(t.id, []),
                               "album_id": str(t.album_id) if t.album_id else None, "genre": t.genre, "year": t.year,
                               "duration_ms": t.duration_ms, **(axes.get(mf) or {})}
                    batch.append(models.PointStruct(id=str(mf), vector=vec, payload=payload))
                    if r["payload"].get("lyrics"):
                        lyric_rows.append({"media_file_id": mf, "text": r["payload"]["lyrics"], "source": "legacy"})
                    if len(batch) >= 64:
                        await self.q.upsert(vectors.TRACKS, batch, wait=True)
                        n["points"] += len(batch)
                        batch = []
        if batch:
            await self.q.upsert(vectors.TRACKS, batch, wait=True)
            n["points"] += len(batch)
        async with self.sm() as s:  # spec §4: payload lyrics only where no file tag carried any
            for i in range(0, len(lyric_rows), 1000):
                got = await s.execute(pg_insert(lyrics).values(lyric_rows[i : i + 1000]).on_conflict_do_nothing().returning(lyrics.c.media_file_id))
                n["lyrics"] += len(got.all())
            await s.commit()
        return n

    async def knowledge(self) -> dict[str, Any]:
        from knowledge import Loader as KnowledgeLoader

        pg = await asyncpg.connect(self.url)
        try:
            k = KnowledgeLoader(self.snap, pg)
            await k.run()
            return dict(k.counts)
        finally:
            await pg.close()

    async def listening(self) -> dict[str, Any]:
        accts, dev = self.accounts_v1(), await self.device_of()
        live = self.live_tracks()
        n = {"listens": 0, "listens_skipped": 0, "signals": 0, "playlists": 0, "items": 0}
        by_acct: dict[uuid.UUID, list[LS.ListenIn]] = defaultdict(list)
        for e in self.rows("select * from playback_events order by played_at, id"):
            acct = accts.get(e["collection_name"])
            if acct is None or live.get(e["track_id"]) != e["collection_name"]:
                n["listens_skipped"] += 1
                continue
            dur, played = e["total_dur"] or 0, e["played_sec"] or 0
            by_acct[acct].append(LS.ListenIn(
                client_event_id=uuid.uuid5(NS, f"event:{e['id']}"), session_id=e["session_id"] or "v1",
                track_id=uuid.UUID(e["track_id"]), started_at=v1_time(e["played_at"]), played_ms=round(played * 1000),
                duration_ms=round(dur * 1000) or None, end_reason=end_reason(played, dur, bool(e["skipped_early"])),
                skipped_early=bool(e["skipped_early"]), interacted=bool(e["interacted"]),
                influence=bool(e["influence"]) if e["influence"] is not None else True, source=e["source"],
                context_type=None,
            ))
        for acct, evs in by_acct.items():
            for i in range(0, len(evs), 100):
                async with self.sm() as s:
                    await listening.ingest_listens(s, acct, dev[acct], LS.ListenBatchIn(events=evs[i : i + 100]))
            n["listens"] += len(evs)
        async with self.sm() as s:
            for g in self.rows("select * from taste_signals order by created_at"):
                acct = accts.get(g["collection_name"])
                if acct is None or live.get(g["track_id"]) != g["collection_name"]:
                    continue
                await s.execute(pg_insert(taste_signals).values(
                    client_event_id=uuid.uuid5(NS, f"signal:{g['id']}"), account_id=acct, session_id=g["session_id"],
                    track_id=uuid.UUID(g["track_id"]), kind=g["kind"], created_at=v1_time(g["created_at"]),
                ).on_conflict_do_nothing())
                n["signals"] += 1
            await s.commit()
        for p in self.rows("select * from playlists order by created_at, id"):
            acct = accts.get(p["collection_name"])
            if acct is None:
                continue
            pid = uuid.uuid5(NS, f"playlist:{p['id']}")
            items = [uuid.UUID(t["track_id"]) for t in self.rows("select track_id from playlist_tracks where playlist_id = ? order by position", p["id"])
                     if live.get(t["track_id"]) == p["collection_name"]]
            async with self.sm() as s:
                await playlists.create(s, acct, PS.PlaylistIn(id=pid, name=p["name"], description=p["description"]))
            async with self.sm() as s:  # a re-run rebuilds the items, in v1's order
                await s.execute(sa.delete(playlist_items).where(playlist_items.c.playlist_id == pid))
                await s.commit()
            if items:
                async with self.sm() as s:
                    await playlists.add_items(s, acct, pid, PS.ItemsAdd(items=[PS.ItemIn(track_id=t) for t in items]))
            n["playlists"] += 1
            n["items"] += len(items)
        return n

    async def misc(self) -> dict[str, Any]:
        from musix.contexts.imports.models import yandex_imports, yandex_links
        from musix.contexts.quiz.models import quiz_rounds, quiz_skill

        accts = self.accounts_v1()
        n = {"quiz_rounds": 0, "quiz_skill": 0, "yandex_imports": 0, "yandex_links": 0, "yandex_tokens": "skipped (no v1 key)"}
        async with self.sm() as s:
            for r in self.rows("select * from quiz_rounds where answered_at is not null"):
                acct = accts.get(r["collection_name"])
                if acct is None:
                    continue
                vals = {"account_id": acct, "mode": r["mode"], "track_id": uuid.UUID(r["track_id"]) if r["track_id"] else None,
                        "spec": json.loads(r["spec_json"]), "answer": json.loads(r["answer_json"]) if r["answer_json"] else None,
                        "correct": bool(r["correct"]) if r["correct"] is not None else None, "score": r["score"],
                        "created_at": v1_time(r["created_at"]), "expires_at": v1_time(r["expires_at"]), "answered_at": v1_time(r["answered_at"])}
                await s.execute(pg_insert(quiz_rounds).values(id=uuid.uuid5(NS, f"quiz:{r['round_id']}"), **vals).on_conflict_do_nothing())
                n["quiz_rounds"] += 1
            for r in self.rows("select * from quiz_skill"):
                acct = accts.get(r["collection_name"])
                if acct is None:
                    continue
                vals = {"account_id": acct, "mode": r["mode"], "skill": r["skill"], "n_answered": r["n_answered"],
                        "band_lo": r["band_lo"], "band_hi": r["band_hi"], "out_of_band": r["out_of_band"]}
                await s.execute(pg_insert(quiz_skill).values(**vals).on_conflict_do_update(index_elements=["account_id", "mode"], set_=vals))
                n["quiz_skill"] += 1
            known = {account_id(u["id"]) for u in self.rows("select id from users")}
            for r in self.rows("select * from yandex_imports"):
                aid = account_id(r["account_id"])
                if aid not in known:
                    continue
                vals = {"account_id": aid, "yandex_track_id": r["yandex_track_id"],
                        "status": "downloaded" if r["status"] in ("downloaded", "indexed", "done") else "skipped",
                        "reason": r["reason"], "updated_at": v1_time(r["imported_at"])}
                await s.execute(pg_insert(yandex_imports).values(**vals).on_conflict_do_nothing())
                n["yandex_imports"] += 1
            v1_key = _v1_ym_key()
            if v1_key is not None:
                from cryptography.fernet import Fernet

                from musix.infra import secrets

                v2 = secrets.fernet_only(Settings().secrets_dir)
                if v2 is None:
                    n["yandex_tokens"] = "skipped (no v2 Fernet key readable)"
                else:
                    old = Fernet(v1_key)
                    for r in self.rows("select * from yandex_accounts"):
                        aid = account_id(r["account_id"])
                        blob = json.loads(old.decrypt(r["enc_token"].encode()).decode())
                        token = blob.get("access_token") if isinstance(blob, dict) else str(blob)
                        vals = {"account_id": aid, "token_enc": v2.encrypt(token.encode()).decode(), "yandex_uid": r["yandex_uid"],
                                "login": r["yandex_login"], "expires_at": v1_time(r["expires_at"]), "linked_at": v1_time(r["linked_at"])}
                        await s.execute(pg_insert(yandex_links).values(**vals).on_conflict_do_update(index_elements=["account_id"], set_=vals))
                        n["yandex_links"] += 1
                    n["yandex_tokens"] = "re-encrypted"
            await s.commit()
        return n

    async def files(self) -> dict[str, Any]:
        from files import run_files

        return await run_files(self)

    async def post(self) -> dict[str, Any]:
        """«Поток» warm after the run: the state jobs per account and one ranker train."""
        from procrastinate import App, PsycopgConnector
        from procrastinate.exceptions import AlreadyEnqueued

        app = App(connector=PsycopgConnector(conninfo=self.url))
        n = {"queued": 0, "already_queued": 0}  # a re-run before a worker drained the first is a no-op

        async def defer(name: str, lock: str, **kw: Any) -> None:
            try:
                await app.configure_task(name, queue="default", queueing_lock=lock).defer_async(**kw)
                n["queued"] += 1
            except AlreadyEnqueued:
                n["already_queued"] += 1

        async with app.open_async():
            for a in self.accounts_v1().values():
                for name in ("stream:genres", "stream:colisten", "stream:profile", "stream:taste_map"):
                    await defer(name, f"{name}:{a}", account_id=str(a))
            await defer("stream:train", "stream:train")
        return n

    async def verify(self) -> dict[str, Any]:
        from verify import run_verify

        return await run_verify(self)

    async def close(self) -> None:
        self.sq.close()
        await self.q.close()
        await self.engine.dispose()


def _v1_ym_key() -> bytes | None:
    """v1 `token_store._resolve_key`, from the operator's env only (never read from v1's
    .env by this tool, never printed)."""
    explicit = os.environ.get("V1_YM_TOKEN_KEY")
    if explicit:
        return explicit.encode()
    secret = os.environ.get("V1_JWT_SECRET")
    if secret:
        return base64.urlsafe_b64encode(hashlib.sha256(secret.encode() + b"ym-token").digest())
    return None


async def prepare(admin_dsn: str, name: str, reset: bool, qdrant_url: str) -> str:
    """The target database at Alembic head; `reset` drops it first (and the Qdrant points
    its accounts owned)."""
    conn = await asyncpg.connect(admin_dsn)
    exists = await conn.fetchval("select 1 from pg_database where datname = $1", name)
    url = admin_dsn.rsplit("/", 1)[0] + f"/{name}"
    if exists and reset:
        old = await asyncpg.connect(url)
        try:
            ids = [str(r[0]) for r in await old.fetch("select id from accounts")]
        except asyncpg.UndefinedTableError:
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


async def run(snap: Path, name: str, stages: list[str], dry_run: bool, admin_dsn: str, qdrant_url: str,
              reset: bool = False) -> dict[str, Any]:
    url = await prepare(admin_dsn, name, reset, qdrant_url)
    m = Migrator(snap, url, qdrant_url, dry_run)
    report: dict[str, Any] = {"snapshot": snap.name, "db": name, "dry_run": dry_run, "stages": {}}
    try:
        for stage in STAGES:
            if stage not in stages or (dry_run and stage == "files"):
                continue
            t = time.time()
            started = dt.datetime.now(dt.UTC)
            counts = await getattr(m, stage)()
            secs = round(time.time() - t, 1)
            report["stages"][stage] = {"seconds": secs, **counts}
            print(f"{stage:10} {secs:7.1f}s  {json.dumps(counts, ensure_ascii=False, default=str)[:400]}", flush=True)
            if stage != "verify":
                async with m.sm() as s:
                    await s.execute(sa.text("INSERT INTO migr_runs VALUES (:s, :t, :sec, CAST(:c AS jsonb))"),
                                    {"s": stage, "t": started, "sec": secs, "c": json.dumps(counts, default=str)})
                    await s.commit()
    finally:
        await m.close()
    return report


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("snapshot", type=Path)
    r.add_argument("--db", default="musix_mig")
    r.add_argument("--stages", default=",".join(STAGES))
    r.add_argument("--dry-run", action="store_true")
    r.add_argument("--reset", action="store_true", help="drop the target database first")
    r.add_argument("--copy-foreign", action="store_true",
                   help="copy (not hardlink) media files another user owns — dev runs; the cutover runs as root")
    r.add_argument("--admin-dsn", default="postgresql://musix:musix@127.0.0.1:18432/postgres")
    r.add_argument("--qdrant", default="http://127.0.0.1:18333")
    r.add_argument("--out", type=Path)
    a = ap.parse_args()
    import files as files_stage

    files_stage.COPY_FOREIGN = a.copy_foreign
    t = time.time()
    report = asyncio.run(run(a.snapshot, a.db, a.stages.split(","), a.dry_run, a.admin_dsn, a.qdrant, a.reset))
    report["total_seconds"] = round(time.time() - t, 1)
    print(f"total {report['total_seconds']}s")
    if a.out:
        a.out.write_text(json.dumps(report, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
