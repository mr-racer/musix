"""Yandex Music: the link, the device-flow login, the import.

- The login is v1's device flow without v1's thread: `start` asks Yandex for a device
  code and stores the session (every api worker sees it); each status poll makes one
  token request (`poll_device_token`), so nothing blocks for ten minutes.
- The token is Fernet-encrypted with the instance key (v1 derived its own key;
  `token_enc` never leaves this module, responses carry only the login).
- The import job resolves the selected sources (v1 `playlists`), skips what this
  account has (imported before, or the same song already in the library), downloads
  through the shared `yandex` bucket (v1: a 0.5 s throttle), and hands each file to the
  upload pipeline — a file whose content the server already has is registered from the
  stored copy, not stored again (sha256).
- Every Yandex track's fate is kept in `yandex_imports` (downloaded / matched / failed /
  unavailable), so a top-up fetches only what is new or failed on the network, and the
  picker shows what is here. Each imported source gets one MusiX playlist
  (`origin = 'yandex'`) that later imports only add to (the owner, 2026-10-12)."""

from __future__ import annotations

import asyncio
import bisect
import datetime as dt
import logging
import shutil
import uuid
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from cryptography.fernet import Fernet
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.imports.models import (
    yandex_auth,
    yandex_imports,
    yandex_links,
    yandex_playlist_tracks,
    yandex_playlists,
)
from musix.contexts.library import ingest
from musix.contexts.library.models import media_files, songs, tracks
from musix.contexts.library.slug import song_key
from musix.contexts.playlists import fractional
from musix.contexts.playlists.models import playlist_items
from musix.contexts.playlists.models import playlists as playlists_t
from musix.errors import Invalid, NotFound, Unavailable
from musix.infra.changelog import notify, record_change
from musix.infra.ratelimit import Source, acquire

SM = async_sessionmaker[AsyncSession]
YANDEX = Source("yandex", rate=2.0, burst=2)  # v1: one call per 0.5 s across download workers
log = logging.getLogger(__name__)


class NotLinked(Invalid):
    pass


async def link_status(s: AsyncSession, account_id: uuid.UUID) -> dict[str, Any]:
    row = (
        await s.execute(
            sa.select(yandex_links.c.login, yandex_links.c.linked_at).where(
                yandex_links.c.account_id == account_id
            )
        )
    ).first()
    return {
        "linked": row is not None,
        "login": row.login if row else None,
        "linked_at": row.linked_at if row else None,
    }


async def unlink(s: AsyncSession, account_id: uuid.UUID) -> None:
    await s.execute(sa.delete(yandex_links).where(yandex_links.c.account_id == account_id))
    await s.commit()


async def start_auth(s: AsyncSession, fernet: Fernet, account_id: uuid.UUID) -> dict[str, Any]:
    from yandex_music import ClientAsync

    try:
        code = await ClientAsync().request_device_code(device_name="MusiX")
    except Exception as e:
        raise Unavailable(f"yandex: {type(e).__name__}") from e
    expires = dt.datetime.now(dt.UTC) + dt.timedelta(
        seconds=int(getattr(code, "expires_in", 600) or 600)
    )
    sid = await s.scalar(
        sa.insert(yandex_auth)
        .values(
            account_id=account_id,
            device_code_enc=fernet.encrypt(code.device_code.encode()).decode(),
            user_code=code.user_code,
            verification_url=code.verification_url,
            expires_at=expires,
        )
        .returning(yandex_auth.c.id)
    )
    await s.commit()
    return {
        "session_id": sid,
        "status": "pending",
        "user_code": code.user_code,
        "verification_url": code.verification_url,
        "expires_at": expires,
        "reason": None,
    }


async def poll_auth(
    s: AsyncSession, fernet: Fernet, account_id: uuid.UUID, session_id: uuid.UUID
) -> dict[str, Any]:
    from yandex_music import ClientAsync
    from yandex_music.exceptions import DeviceAuthError

    row = (
        await s.execute(
            sa.select(yandex_auth).where(
                yandex_auth.c.id == session_id, yandex_auth.c.account_id == account_id
            )
        )
    ).first()
    if row is None:
        raise NotFound("session")
    out = {
        "session_id": row.id,
        "status": row.status,
        "user_code": row.user_code,
        "verification_url": row.verification_url,
        "expires_at": row.expires_at,
        "reason": row.reason,
    }
    if row.status != "pending":
        return out
    if dt.datetime.now(dt.UTC) > row.expires_at:
        await s.execute(
            sa.update(yandex_auth).where(yandex_auth.c.id == session_id).values(status="expired")
        )
        await s.commit()
        return {**out, "status": "expired"}
    try:
        token = await ClientAsync().poll_device_token(
            fernet.decrypt(row.device_code_enc.encode()).decode()
        )
    except DeviceAuthError as e:
        reason = "denied" if "denied" in str(e) else "expired" if "expired" in str(e) else "error"
        await s.execute(
            sa.update(yandex_auth)
            .where(yandex_auth.c.id == session_id)
            .values(status="error" if reason == "error" else "expired", reason=reason)
        )
        await s.commit()
        return {**out, "status": "error" if reason == "error" else "expired", "reason": reason}
    except Exception:
        return {**out, "reason": "network"}  # transient: the next poll asks again
    if token is None:
        return out  # authorization_pending
    login, uid = None, None
    try:
        me = await (await ClientAsync(token.access_token).init()).account_status()
        acc = getattr(me, "account", None)
        uid = str(acc.uid) if acc else None
        login = (getattr(acc, "login", None) or getattr(acc, "display_name", None)) if acc else None
    except Exception:  # the login is a label, not a requirement (v1)
        log.debug("[yandex] could not read the account", exc_info=True)
    expires = (
        dt.datetime.now(dt.UTC) + dt.timedelta(seconds=float(token.expires_in))
        if getattr(token, "expires_in", None)
        else None
    )
    vals = {
        "account_id": account_id,
        "token_enc": fernet.encrypt(token.access_token.encode()).decode(),
        "yandex_uid": uid,
        "login": login,
        "expires_at": expires,
        "linked_at": sa.func.now(),
    }
    await s.execute(
        pg_insert(yandex_links)
        .values(**vals)
        .on_conflict_do_update(index_elements=["account_id"], set_=vals)
    )
    await s.execute(
        sa.update(yandex_auth).where(yandex_auth.c.id == session_id).values(status="authorized")
    )
    await s.commit()
    return {**out, "status": "authorized"}


async def _ym(fn: Any, *args: Any) -> Any:
    """A blocking Yandex call off the loop, its failures as domain errors: an expired token
    is «link again» (400 + `relink`), not a 500; a network failure is a 503."""
    from yandex_music.exceptions import NetworkError, UnauthorizedError

    try:
        return await asyncio.to_thread(fn, *args)
    except UnauthorizedError as e:
        raise NotLinked("yandex token expired: link the account again", relink=True) from e
    except NetworkError as e:
        raise Unavailable(f"yandex: {type(e).__name__}") from e


async def _client(s: AsyncSession, fernet: Fernet, account_id: uuid.UUID) -> Any:
    from yandex_music import Client

    enc = await s.scalar(
        sa.select(yandex_links.c.token_enc).where(yandex_links.c.account_id == account_id)
    )
    if enc is None:
        raise NotLinked("yandex account not linked")
    token = fernet.decrypt(enc.encode()).decode()
    return await _ym(lambda: Client(token).init())


def source_key(source: Any) -> str:
    """The stored name of a source: "likes" or the playlist kind."""
    if source == "likes":
        return "likes"
    if isinstance(source, dict) and "kind" in source:
        return str(int(source["kind"]))
    raise Invalid('source must be "likes" or {"kind": N}')


async def sources(s: AsyncSession, fernet: Fernet, account_id: uuid.UUID) -> list[dict[str, Any]]:
    """The account's sources, each with the MusiX playlist made for it (if any)."""
    from musix.yandex import playlists

    client = await _client(s, fernet, account_id)
    got = await _ym(playlists.list_sources, client)
    links = {
        r.source: r
        for r in await s.execute(
            sa.select(
                yandex_playlists.c.source,
                yandex_playlists.c.playlist_id,
                yandex_playlists.c.synced_at,
            )
            .join(playlists_t, playlists_t.c.id == yandex_playlists.c.playlist_id)
            .where(yandex_playlists.c.account_id == account_id, playlists_t.c.deleted_at.is_(None))
        )
    }
    out = []
    for src in got:
        link = links.get(source_key(src["source"]))
        out.append(
            {
                **src,
                "playlist_id": link.playlist_id if link else None,
                "synced_at": link.synced_at if link else None,
            }
        )
    return out


def _song_of(t: Any) -> str:
    """The library's song key for a Yandex track — the downloader writes exactly these tags."""
    artist = ", ".join(a.name for a in (t.artists or []) if getattr(a, "name", None))
    return song_key(artist, t.title or "")


async def _states(
    s: AsyncSession, account_id: uuid.UUID, ts: list[Any]
) -> dict[str, dict[str, Any]]:
    """Each Yandex track's fate in this account: `imported` (a live track here, `track_id`),
    `removed` (we brought it, the listener deleted it), `failed`, `unavailable`, or `new`.

    A song the library already has under the same key counts as here (no second copy), and
    the link is written down (`matched`), as is the file of v1's imports (v1 kept no file id).
    """
    T = tracks.c
    ids = [str(t.id) for t in ts]
    rows = {
        r.yandex_track_id: r
        for r in await s.execute(
            sa.select(
                yandex_imports.c.yandex_track_id,
                yandex_imports.c.status,
                yandex_imports.c.reason,
                yandex_imports.c.media_file_id,
            ).where(
                yandex_imports.c.account_id == account_id, yandex_imports.c.yandex_track_id.in_(ids)
            )
        )
    }
    mfs = {r.media_file_id for r in rows.values() if r.media_file_id}
    live_by_mf = {
        mf: tid
        for mf, tid in await s.execute(
            sa.select(T.media_file_id, T.id).where(
                T.account_id == account_id, T.media_file_id.in_(mfs), T.deleted_at.is_(None)
            )
        )
    }
    keys = {str(t.id): _song_of(t) for t in ts}
    live_by_song: dict[str, tuple[uuid.UUID, uuid.UUID]] = {}
    for slug, tid, mf in await s.execute(
        sa.select(songs.c.slug, T.id, T.media_file_id)
        .join(songs, songs.c.id == T.song_id)
        .where(
            T.account_id == account_id, T.deleted_at.is_(None), songs.c.slug.in_(set(keys.values()))
        )
        .order_by(T.added_at)
    ):
        live_by_song.setdefault(slug, (tid, mf))  # the oldest copy wins: it is the one played
    out: dict[str, dict[str, Any]] = {}
    links: list[dict[str, Any]] = []
    for ytid in ids:
        r = rows.get(ytid)
        hit = live_by_mf.get(r.media_file_id) if r is not None and r.media_file_id else None
        if hit is not None:
            out[ytid] = {"state": "imported", "track_id": hit, "reason": None}
            continue
        song = live_by_song.get(keys[ytid])
        brought = r is not None and r.status in ("downloaded", "matched")
        if song is not None:
            out[ytid] = {"state": "imported", "track_id": song[0], "reason": None}
            if r is not None and brought and r.media_file_id:
                continue  # ours was deleted, another copy of the song stays: keep our link
            links.append(
                {
                    "account_id": account_id,
                    "yandex_track_id": ytid,
                    "status": r.status if r is not None and brought else "matched",
                    "reason": None,
                    "media_file_id": song[1],
                }
            )
        elif brought:
            out[ytid] = {"state": "removed", "track_id": None, "reason": None}
        elif r is not None:
            out[ytid] = {"state": r.status, "track_id": None, "reason": r.reason}
        else:
            out[ytid] = {"state": "new", "track_id": None, "reason": None}
    if links:
        stmt = pg_insert(yandex_imports).values(links)
        await s.execute(
            stmt.on_conflict_do_update(
                index_elements=["account_id", "yandex_track_id"],
                set_={
                    "status": stmt.excluded.status,
                    "media_file_id": stmt.excluded.media_file_id,
                    "reason": None,
                    "updated_at": sa.func.now(),
                },
            )
        )
    return out


async def source_tracks(
    s: AsyncSession, fernet: Fernet, account_id: uuid.UUID, source: Any
) -> list[dict[str, Any]]:
    """A source's tracks for the picker, each with its fate here (`state`, `trackId`) and
    whether it already sits in the MusiX playlist made for the source."""
    from musix.yandex import playlists

    client = await _client(s, fernet, account_id)
    _, got = await _ym(playlists.resolve_source, client, source)
    st = await _states(s, account_id, got)
    placed: set[str] = set(
        await s.scalars(
            sa.select(yandex_playlist_tracks.c.yandex_track_id).where(
                yandex_playlist_tracks.c.account_id == account_id,
                yandex_playlist_tracks.c.source == source_key(source),
            )
        )
    )
    await s.commit()  # the links `_states` found
    out = []
    for t in got:
        r = playlists.track_row(t)
        x = st[r["id"]]
        out.append(
            {
                **r,
                **x,
                "imported": x["state"] == "imported",
                "in_playlist": r["id"] in placed,
            }
        )
    return out


async def fresh(s: AsyncSession, fernet: Fernet, account_id: uuid.UUID) -> list[dict[str, Any]]:
    """How many new songs each mirrored source has in Yandex: what «Обновить из Яндекса»
    would bring (new tracks and network failures; Yandex's refusals never count). The
    sources are read from Yandex side by side; the fates here one after another."""
    from musix.yandex import playlists

    keys: list[str] = list(
        await s.scalars(
            sa.select(yandex_playlists.c.source)
            .join(playlists_t, playlists_t.c.id == yandex_playlists.c.playlist_id)
            .where(yandex_playlists.c.account_id == account_id, playlists_t.c.deleted_at.is_(None))
        )
    )
    if not keys:
        return []
    client = await _client(s, fernet, account_id)
    srcs: list[Any] = ["likes" if k == "likes" else {"kind": int(k)} for k in keys]
    got = await asyncio.gather(*(_ym(playlists.resolve_source, client, x) for x in srcs))
    out = []
    for src, (_, ts) in zip(srcs, got, strict=True):
        st = await _states(s, account_id, ts)
        n = sum(
            1
            for t in ts
            if playlists.track_row(t)["available"] and st[str(t.id)]["state"] in ("new", "failed")
        )
        out.append({"source": src, "fresh": n, "track_count": len(ts)})
    await s.commit()  # the links `_states` found
    return out


class _BucketThrottle:
    """v1's `Throttle.wait()` shape over the shared bucket, called from worker threads."""

    def __init__(self, sm: SM, loop: asyncio.AbstractEventLoop) -> None:
        self.sm, self.loop = sm, loop

    def wait(self) -> None:
        asyncio.run_coroutine_threadsafe(acquire(self.sm, YANDEX), self.loop).result()


async def store(
    sm: SM, media_dir: Path, account_id: uuid.UUID, path: Path, on_registered: Any = None
) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    """One downloaded file into the library: content the server has is registered
    from the stored copy (dedup by sha256); new content is moved into managed storage
    and ingested exactly like an upload. → (media file id, track id); the track id is
    None when the file could not be read (ingest marks the file `failed`)."""
    sha = await asyncio.to_thread(ingest.sha256_file, path)
    async with sm() as s:
        known = (
            await s.execute(
                sa.select(media_files.c.id, media_files.c.path).where(media_files.c.sha256 == sha)
            )
        ).first()
    if known is not None and await asyncio.to_thread(Path(known.path).exists):
        await asyncio.to_thread(path.unlink, True)
        tid = await ingest.ingest_file(
            sm, account_id, Path(known.path), on_registered=on_registered
        )
        return uuid.UUID(str(known.id)), tid
    dest = media_dir / sha[:2] / f"{sha}{path.suffix.lower() or '.bin'}"
    await asyncio.to_thread(dest.parent.mkdir, parents=True, exist_ok=True)
    await asyncio.to_thread(shutil.move, str(path), str(dest))
    tid = await ingest.ingest_file(
        sm, account_id, dest, storage="managed", on_registered=on_registered
    )
    async with sm() as s:
        mf = await s.scalar(sa.select(media_files.c.id).where(media_files.c.sha256 == sha))
    return (uuid.UUID(str(mf)) if mf else None), tid


# «Мне нравится» here is MusiX's own likes; the mirrored one says where it came from (the owner)
LIKES_PLAYLIST = "Мне нравится из Яндекс Музыки"
PERMANENT = ("not available", "no full audio", "no title/artist")
MIN_FREE = 3 * 1024**3  # the disk guard's floor (ops/disk-guard.sh): stop before Postgres starves


def fate(reason: str | None) -> str:
    """`unavailable` for what Yandex will not give (a whole-source import stops asking),
    `failed` for everything else — timeouts, dropped connections — tried again next time."""
    r = (reason or "").lower()
    return "unavailable" if any(p in r for p in PERMANENT) else "failed"


async def _place(
    s: AsyncSession,
    account_id: uuid.UUID,
    key: str,
    title: str,
    present: list[tuple[str, uuid.UUID]],
) -> tuple[uuid.UUID, int]:
    """The source's MusiX playlist (made on first import, again if the listener deleted it):
    adds the source's tracks that are here and were never placed, at their place in the
    Yandex order. Nothing is ever taken out; a track removed from it stays out.
    → (playlist id, tracks added)."""
    P, It, YP, YT = playlists_t.c, playlist_items.c, yandex_playlists.c, yandex_playlist_tracks.c
    pid = await s.scalar(
        sa.select(YP.playlist_id)
        .join(playlists_t, P.id == YP.playlist_id)
        .where(YP.account_id == account_id, YP.source == key, P.deleted_at.is_(None))
    )
    if pid is None:
        pid = await s.scalar(
            sa.insert(playlists_t)
            .values(account_id=account_id, name=title[:200], origin="yandex")
            .returning(P.id)
        )
        vals = {"account_id": account_id, "source": key, "playlist_id": pid, "title": title}
        await s.execute(
            pg_insert(yandex_playlists)
            .values(**vals)
            .on_conflict_do_update(index_elements=["account_id", "source"], set_=vals)
        )
        await s.execute(
            sa.delete(yandex_playlist_tracks).where(YT.account_id == account_id, YT.source == key)
        )
        await record_change(s, account_id, "playlist", pid)
    placed: set[str] = set(
        await s.scalars(
            sa.select(YT.yandex_track_id).where(YT.account_id == account_id, YT.source == key)
        )
    )
    live = (
        await s.execute(
            sa.select(It.track_id, It.position)
            .where(It.playlist_id == pid, It.deleted_at.is_(None))
            .order_by(It.position, It.item_id)
        )
    ).all()
    pos_of = {r.track_id: r.position for r in live}
    keys = sorted(r.position for r in live)
    # runs of new tracks between two tracks already in the playlist go between them
    rows: list[dict[str, Any]] = []
    run: list[uuid.UUID] = []
    anchor: str | None = None

    def flush() -> None:
        if not run:
            return
        hi_i = bisect.bisect_right(keys, anchor) if anchor is not None else 0
        hi = keys[hi_i] if hi_i < len(keys) else None
        new = fractional.keys_between(anchor, hi, len(run))
        rows.extend(
            {"playlist_id": pid, "item_id": uuid.uuid4(), "track_id": t, "position": k}
            for t, k in zip(run, new, strict=True)
        )
        keys[hi_i:hi_i] = new
        run.clear()

    seen: set[uuid.UUID] = set()
    for ytid, tid in present:
        if tid in pos_of:
            flush()
            anchor = pos_of[tid]
        elif ytid not in placed and tid not in seen:
            run.append(tid)
            seen.add(tid)
    flush()
    if rows:
        for i in range(0, len(rows), 1000):
            await s.execute(pg_insert(playlist_items).values(rows[i : i + 1000]))
        for r in rows:
            await record_change(s, account_id, "playlistItem", r["item_id"])
        await s.execute(sa.update(playlists_t).where(P.id == pid).values(updated_at=sa.func.now()))
        await record_change(s, account_id, "playlist", pid)
    mark = [
        {"account_id": account_id, "source": key, "yandex_track_id": y}
        for y, _ in present
        if y not in placed
    ]
    for i in range(0, len(mark), 1000):
        await s.execute(
            pg_insert(yandex_playlist_tracks).values(mark[i : i + 1000]).on_conflict_do_nothing()
        )
    await s.execute(
        sa.update(yandex_playlists)
        .where(YP.account_id == account_id, YP.source == key)
        .values(synced_at=sa.func.now(), title=title)
    )
    return uuid.UUID(str(pid)), len(rows)


async def run_import(
    sm: SM,
    fernet: Fernet,
    media_dir: Path,
    account_id: uuid.UUID,
    job: str,
    selected: list[Any],
    on_registered: Any = None,
    only: list[str] | None = None,
) -> dict[str, Any]:
    """Brings the sources' tracks into the library and into one MusiX playlist per source.

    `only`: the tracks picked in the web's list (None = the whole sources: a top-up that
    fetches what is new or failed before, never what Yandex refused or the listener deleted
    here). A failure of one track never stops the rest; the job always ends with `done` or
    `error`, so the progress bar never hangs."""
    try:
        return await _run(sm, fernet, media_dir, account_id, job, selected, on_registered, only)
    except Exception as e:
        log.exception("[yandex] import %s failed", job)
        async with sm() as s:
            await notify(s, account_id, "job", job=job, state="error", error=type(e).__name__)
            await s.commit()
        raise


async def _run(
    sm: SM,
    fernet: Fernet,
    media_dir: Path,
    account_id: uuid.UUID,
    job: str,
    selected: list[Any],
    on_registered: Any,
    only: list[str] | None,
) -> dict[str, Any]:
    from musix.yandex import downloader, playlists

    async with sm() as s:
        client = await _client(s, fernet, account_id)
    resolved: list[tuple[str, str, list[Any]]] = []  # (source key, title, tracks)
    for src in selected:
        title, ts = await _ym(playlists.resolve_source, client, src)
        key = source_key(src)
        resolved.append((key, LIKES_PLAYLIST if key == "likes" else title, ts))
    merged: dict[str, Any] = {}  # v1 `_resolve_merged_tracks`: a track in two sources once
    for _, _, ts in resolved:
        for t in ts:
            merged.setdefault(str(t.id), t)
    async with sm() as s:
        st = await _states(s, account_id, list(merged.values()))
        await s.commit()
    picked = set(only) if only is not None else None
    todo = [
        t
        for ytid, t in merged.items()
        if st[ytid]["state"] != "imported"
        and (
            ytid in picked
            if picked is not None
            else st[ytid]["state"]
            in ("new", "failed")  # a top-up: no resurrection, no futile retries
        )
    ]
    throttle = _BucketThrottle(sm, asyncio.get_running_loop())
    tmp = media_dir / "yandex-tmp" / str(account_id) / job.replace(":", "-")
    report: dict[str, Any] = {
        "total": len(todo),
        "downloaded": 0,
        "already": sum(1 for x in st.values() if x["state"] == "imported"),
        "skipped": [],
        "playlists": [],
    }

    async def record(
        ytid: str, status: str, reason: str | None = None, mf: uuid.UUID | None = None
    ) -> None:
        vals = {
            "account_id": account_id,
            "yandex_track_id": ytid,
            "status": status,
            "reason": reason,
            "media_file_id": mf,
            "updated_at": sa.func.now(),
        }
        async with sm() as s:
            await s.execute(
                pg_insert(yandex_imports)
                .values(**vals)
                .on_conflict_do_update(
                    index_elements=["account_id", "yandex_track_id"],
                    set_={**vals, "attempts": yandex_imports.c.attempts + 1},
                )
            )
            await s.commit()

    async def restore(ytid: str) -> uuid.UUID | None:
        """A track the listener deleted and now picked again: its file is still stored."""
        async with sm() as s:
            row = (
                await s.execute(
                    sa.select(media_files.c.id, media_files.c.path)
                    .join(yandex_imports, yandex_imports.c.media_file_id == media_files.c.id)
                    .where(
                        yandex_imports.c.account_id == account_id,
                        yandex_imports.c.yandex_track_id == ytid,
                    )
                )
            ).first()
        if row is None or not await asyncio.to_thread(Path(row.path).exists):
            return None
        tid = await ingest.ingest_file(sm, account_id, Path(row.path), on_registered=on_registered)
        return uuid.UUID(str(row.id)) if tid else None

    def skip(t: Any, artist: str, reason: str | None) -> None:
        report["skipped"].append({"artist": artist, "title": t.title, "reason": reason})

    try:
        for i, t in enumerate(todo, 1):
            ytid = str(t.id)
            artist = ", ".join(a.name for a in (t.artists or []) if getattr(a, "name", None))
            try:
                if (await asyncio.to_thread(shutil.disk_usage, media_dir)).free < MIN_FREE:
                    report["stopped"] = "disk full"
                    log.warning("[yandex] import %s stopped: under 3 GB free", job)
                    break
                mf = await restore(ytid) if st[ytid]["state"] == "removed" else None
                if mf is not None:
                    await record(ytid, "downloaded", None, mf)
                    report["downloaded"] += 1
                elif not artist.strip() or not (t.title or "").strip():
                    await record(ytid, "unavailable", "no title/artist")
                    skip(t, artist, "no title/artist")
                else:
                    res = await asyncio.to_thread(
                        downloader.download_track, t, tmp, throttle=throttle
                    )
                    if not res.get("ok"):
                        await record(ytid, fate(res.get("reason")), res.get("reason"))
                        skip(t, artist, res.get("reason"))
                    else:
                        mf, tid = await store(
                            sm, media_dir, account_id, Path(res["path"]), on_registered
                        )
                        if tid is None:
                            await record(ytid, "failed", "the file could not be read", mf)
                            skip(t, artist, "the file could not be read")
                        else:
                            await record(ytid, "downloaded", None, mf)
                            report["downloaded"] += 1
            except Exception as e:  # one track's trouble is not the job's
                log.warning("[yandex] track %s failed", ytid, exc_info=True)
                await record(ytid, "failed", f"{type(e).__name__}: {e}"[:300])
                skip(t, artist, type(e).__name__)
            async with sm() as s:
                await notify(s, account_id, "job", job=job, done=i, total=len(todo))
                await s.commit()
    finally:
        await asyncio.to_thread(shutil.rmtree, tmp, True)
    async with sm() as s:
        st = await _states(s, account_id, list(merged.values()))
        for key, title, ts in resolved:
            present = [
                (str(t.id), st[str(t.id)]["track_id"]) for t in ts if st[str(t.id)]["track_id"]
            ]
            if not present:
                continue  # nothing of it is here: no empty playlist
            pid, added = await _place(s, account_id, key, title, present)
            report["playlists"].append({"source": key, "playlist_id": str(pid), "added": added})
        await notify(s, account_id, "job", job=job, done=len(todo), total=len(todo), state="done")
        await s.commit()
    return report
