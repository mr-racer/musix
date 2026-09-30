"""Yandex Music: the link, the device-flow login, the import.

- The login is v1's device flow without v1's thread: `start` asks Yandex for a device
  code and stores the session (every api worker sees it); each status poll makes one
  token request (`poll_device_token`), so nothing blocks for ten minutes.
- The token is Fernet-encrypted with the instance key (v1 derived its own key;
  `token_enc` never leaves this module, responses carry only the login).
- The import job resolves the selected sources (v1 `playlists`), skips what this
  account imported before, downloads through the shared `yandex` bucket (v1: a 0.5 s
  throttle), and hands each file to the upload pipeline — a file whose content the
  server already has is registered from the stored copy, not stored again (sha256)."""

from __future__ import annotations

import asyncio
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

from musix.contexts.imports.models import yandex_auth, yandex_imports, yandex_links
from musix.contexts.library import ingest
from musix.contexts.library.models import media_files
from musix.errors import Invalid, NotFound, Unavailable
from musix.infra.changelog import notify
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


async def _client(s: AsyncSession, fernet: Fernet, account_id: uuid.UUID) -> Any:
    from yandex_music import Client

    enc = await s.scalar(
        sa.select(yandex_links.c.token_enc).where(yandex_links.c.account_id == account_id)
    )
    if enc is None:
        raise NotLinked("yandex account not linked")
    token = fernet.decrypt(enc.encode()).decode()
    return await asyncio.to_thread(lambda: Client(token).init())


async def sources(s: AsyncSession, fernet: Fernet, account_id: uuid.UUID) -> list[dict[str, Any]]:
    from musix.yandex import playlists

    client = await _client(s, fernet, account_id)
    return await asyncio.to_thread(playlists.list_sources, client)


class _BucketThrottle:
    """v1's `Throttle.wait()` shape over the shared bucket, called from worker threads."""

    def __init__(self, sm: SM, loop: asyncio.AbstractEventLoop) -> None:
        self.sm, self.loop = sm, loop

    def wait(self) -> None:
        asyncio.run_coroutine_threadsafe(acquire(self.sm, YANDEX), self.loop).result()


async def store(
    sm: SM, media_dir: Path, account_id: uuid.UUID, path: Path, on_registered: Any = None
) -> uuid.UUID | None:
    """One downloaded file into the library: content the server has is registered
    from the stored copy (dedup by sha256); new content is moved into managed storage
    and ingested exactly like an upload. → the media file id."""
    sha = await asyncio.to_thread(ingest.sha256_file, path)
    async with sm() as s:
        known = (
            await s.execute(
                sa.select(media_files.c.id, media_files.c.path).where(media_files.c.sha256 == sha)
            )
        ).first()
    if known is not None:
        await asyncio.to_thread(path.unlink, True)
        await ingest.ingest_file(sm, account_id, Path(known.path), on_registered=on_registered)
        return uuid.UUID(str(known.id))
    dest = media_dir / sha[:2] / f"{sha}{path.suffix.lower() or '.bin'}"
    await asyncio.to_thread(dest.parent.mkdir, parents=True, exist_ok=True)
    await asyncio.to_thread(shutil.move, str(path), str(dest))
    await ingest.ingest_file(sm, account_id, dest, storage="managed", on_registered=on_registered)
    async with sm() as s:
        mf = await s.scalar(sa.select(media_files.c.id).where(media_files.c.sha256 == sha))
    return uuid.UUID(str(mf)) if mf else None


async def run_import(
    sm: SM,
    fernet: Fernet,
    media_dir: Path,
    account_id: uuid.UUID,
    job: str,
    selected: list[Any],
    on_registered: Any = None,
) -> dict[str, Any]:
    from musix.yandex import downloader, playlists

    async with sm() as s:
        client = await _client(s, fernet, account_id)
        done_ids: set[str] = set(
            await s.scalars(
                sa.select(yandex_imports.c.yandex_track_id).where(
                    yandex_imports.c.account_id == account_id
                )
            )
        )

    def resolve() -> list[
        Any
    ]:  # v1 `_resolve_merged_tracks`: a track in two sources is fetched once
        seen: set[str] = set()
        out = []
        for src in selected:
            for t in playlists.resolve_tracks(client, src):
                if str(t.id) not in seen:
                    seen.add(str(t.id))
                    out.append(t)
        return out

    tracks = [t for t in await asyncio.to_thread(resolve) if str(t.id) not in done_ids]
    throttle = _BucketThrottle(sm, asyncio.get_running_loop())
    tmp = media_dir / "yandex-tmp" / str(account_id)
    report: dict[str, Any] = {
        "total": len(tracks),
        "downloaded": 0,
        "already": len(done_ids),
        "skipped": [],
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
                .on_conflict_do_update(index_elements=["account_id", "yandex_track_id"], set_=vals)
            )
            await s.commit()

    for i, t in enumerate(tracks, 1):
        artist = ", ".join(a.name for a in (t.artists or []) if getattr(a, "name", None))
        if not artist.strip() or not (t.title or "").strip():
            await record(str(t.id), "skipped", "no title/artist")
            report["skipped"].append(
                {"artist": artist, "title": t.title, "reason": "no title/artist"}
            )
        else:
            res = await asyncio.to_thread(downloader.download_track, t, tmp, throttle=throttle)
            if not res.get("ok"):
                await record(str(t.id), "skipped", res.get("reason"))
                report["skipped"].append(
                    {"artist": artist, "title": t.title, "reason": res.get("reason")}
                )
            else:
                mf = await store(sm, media_dir, account_id, Path(res["path"]), on_registered)
                await record(str(t.id), "downloaded", None, mf)
                report["downloaded"] += 1
        async with sm() as s:
            await notify(s, account_id, "job", job=job, done=i, total=len(tracks))
            await s.commit()
    async with sm() as s:
        await notify(
            s, account_id, "job", job=job, done=len(tracks), total=len(tracks), state="done"
        )
        await s.commit()
    return report
