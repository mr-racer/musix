"""A synthetic 6k-track account for the phase-1 bench (spec §10: "dataset = snapshot size").

Every track is registered through the ingest's own `register`, so catalog rows and
change_log look real; listens, playlists and signals go through their services. Each
synthetic track gets its own media_files row (a fake sha) whose rendition directory is a
symlink to one of the dev subset's real ones, so manifests sign real files and stream
start is real. Idempotent per account: an existing bench account is left as it is.
Usage (from v2/server): uv run python ../tools/bench/v2/synth.py [--tracks 6000]
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import hashlib
import os
import random
import uuid
from pathlib import Path

import httpx
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import distinct_on

from musix.contexts.library import ingest
from musix.contexts.library.models import albums, media_files, renditions, tracks
from musix.contexts.listening import schemas as LS
from musix.contexts.listening import service as listening
from musix.contexts.listening.models import listen_events, taste_signals
from musix.contexts.listening.schemas import SignalIn
from musix.contexts.playlists.models import playlists as playlist_table
from musix.contexts.playlists import schemas as PS
from musix.contexts.playlists import service as playlists
from musix.contexts.media.audio import tier_dir
from musix.infra import db
from musix.settings import Settings

API = os.environ.get("MUSIX_BENCH_API", "http://127.0.0.1:18000/api/v2")
OWNER = {"email": "owner@example.com", "password": "owner-pass-123"}
BENCH = {"email": "bench@example.com", "password": "bench-pass-123"}
DEVICE = {"name": "bench-synth", "platform": "android"}
GENRES = ["Rock", "Pop", "Electronic", "Hip-Hop", "Jazz", "Classical", "Indie", "Metal",
          "R&B", "Folk", "Ambient", "Soundtrack", "Русский рок", "Поп"]


def login(creds: dict[str, str]) -> dict[str, str] | None:
    r = httpx.post(f"{API}/auth/login", json={**creds, "device": DEVICE}, timeout=30)
    return r.json() if r.status_code == 200 else None


def bench_account(creds: dict[str, str]) -> tuple[dict[str, str], bool]:
    if tok := login(creds):
        return tok, False
    owner = login(OWNER)
    assert owner, "the dev owner must exist (make dev + setup)"
    code = httpx.post(f"{API}/invites", headers={"Authorization": f"Bearer {owner['accessToken']}"}).json()["code"]
    r = httpx.post(f"{API}/auth/register", json={**creds, "inviteCode": code, "device": DEVICE}, timeout=30)
    r.raise_for_status()
    return r.json(), True


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tracks", type=int, default=6000)
    ap.add_argument("--email", default=BENCH["email"])
    ap.add_argument("--listens", type=int, default=20_000)
    args = ap.parse_args()
    settings = Settings()
    media = Path(settings.media_dir)
    tok, _ = bench_account({"email": args.email, "password": BENCH["password"]})
    acct, device = uuid.UUID(tok["accountId"]), uuid.UUID(tok["deviceId"])
    engine = db.make_engine(settings, statement_timeout_ms=600_000)
    sm = db.make_sessionmaker(engine)
    rnd = random.Random(6000)

    async def count(table: sa.Table) -> int:
        async with sm() as s:
            return int(await s.scalar(sa.select(sa.func.count()).where(table.c.account_id == acct)) or 0)

    async with sm() as s:  # the subset's real, fully processed files
        real = (await s.execute(
            sa.select(media_files, tracks.c.cover_image_id)
            .join(tracks, tracks.c.media_file_id == media_files.c.id)
            .where(media_files.c.state == "media_done", tracks.c.cover_image_id.is_not(None))
            .ext(distinct_on(media_files.c.id))
        )).all()
        rend = {}
        for r in await s.execute(sa.select(renditions).where(renditions.c.media_file_id.in_([x.id for x in real]))):
            rend.setdefault(r.media_file_id, []).append(r)
    assert real, "process the dev subset first (media:backfill)"
    n_artists, n_albums = max(1, args.tracks // 15), max(1, args.tracks // 10)
    album_of = {b: (f"Synth Artist {rnd.randrange(n_artists):04d}", 1990 + rnd.randrange(35)) for b in range(n_albums)}
    async with sm() as s:  # resumable: every step checks what is already there
        track_ids: list[uuid.UUID] = list(await s.scalars(
            sa.select(tracks.c.id).where(tracks.c.account_id == acct).order_by(tracks.c.added_at)))
    probe_cols = ["storage", "path", "size_bytes", "mtime", "container", "codec", "sample_rate", "bit_depth",
                  "channels", "bitrate_kbps", "duration_ms", "lufs_integrated", "true_peak_dbtp", "loudness_range"]
    for start in range(len(track_ids), args.tracks, 250):
        async with sm() as s:
            for i in range(start, min(start + 250, args.tracks)):
                src = real[i % len(real)]
                sha = hashlib.sha256(f"synth:{acct}:{i}".encode()).hexdigest()
                d = tier_dir(media, sha)
                if not d.exists():
                    d.parent.mkdir(parents=True, exist_ok=True)
                    d.symlink_to(tier_dir(media, src.sha256))
                mf = await s.scalar(sa.insert(media_files).values(
                    sha256=sha, state="media_done", **{c: getattr(src, c) for c in probe_cols}
                ).returning(media_files.c.id))
                for r in rend.get(src.id, []):
                    await s.execute(sa.insert(renditions).values(
                        media_file_id=mf, **{k: v for k, v in r._mapping.items() if k not in ("media_file_id",)}))
                b = rnd.randrange(n_albums)
                artist, year = album_of[b]
                feat = f" feat. Synth Artist {rnd.randrange(n_artists):04d}" if rnd.random() < 0.1 else ""
                tags = ingest.Tags(
                    title=f"Synth Track {i:05d}", artist=artist + feat, album_artist=artist,
                    album=f"Synth Album {b:04d}", year=year, genre=rnd.choice(GENRES),
                    track_no=i % 14 + 1, disc_no=1, lyrics=None,
                )
                tid = await ingest.register(s, acct, mf, tags, src.duration_ms)
                await s.execute(sa.update(tracks).where(tracks.c.id == tid).values(cover_image_id=src.cover_image_id))
                await s.execute(sa.update(albums).where(
                    albums.c.id == sa.select(tracks.c.album_id).where(tracks.c.id == tid).scalar_subquery(),
                    albums.c.cover_image_id.is_(None)).values(cover_image_id=src.cover_image_id))
                track_ids.append(tid)
            await s.commit()
        print(f"tracks {len(track_ids)}/{args.tracks}", flush=True)
    now = dt.datetime.now(dt.UTC)
    liked = rnd.sample(track_ids, len(track_ids) // 5)  # a fifth of the library gets most plays
    for b in range(args.listens // 100 if not await count(listen_events) else 0):  # over 90 days
        events = []
        for _ in range(100):
            t = rnd.choice(liked) if rnd.random() < 0.7 else rnd.choice(track_ids)
            played = rnd.choice([rnd.randint(1000, 20000), rnd.randint(150_000, 240_000)])
            events.append(LS.ListenIn(
                client_event_id=uuid.uuid4(), session_id=f"synth-{b // 10}", track_id=t,
                started_at=now - dt.timedelta(minutes=rnd.randrange(90 * 24 * 60)),
                played_ms=played, duration_ms=240_000,
                end_reason="completed" if played > 150_000 else "skipped", skipped_early=played < 30_000,
            ))
        async with sm() as s:
            await listening.ingest_listens(s, acct, device, LS.ListenBatchIn(events=events))
    for p in range(20 if not await count(playlist_table) else 0):
        async with sm() as s:
            pl = await playlists.create(s, acct, PS.PlaylistIn(name=f"Synth Playlist {p:02d}"))
        async with sm() as s:
            await playlists.add_items(s, acct, pl.id, PS.ItemsAdd(
                items=[PS.ItemIn(track_id=t) for t in rnd.sample(track_ids, min(60, len(track_ids)))]))
    for t in rnd.sample(track_ids, min(200, len(track_ids))) if not await count(taste_signals) else []:
        async with sm() as s:
            await listening.add_signal(s, acct, t, SignalIn(kind=rnd.choice(["fire", "water"]), client_event_id=uuid.uuid4()))
    await engine.dispose()
    print(f"bench account {args.email} {acct}: {len(track_ids)} tracks")


if __name__ == "__main__":
    asyncio.run(main())
