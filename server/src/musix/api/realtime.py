"""The realtime channel (spec §8): `GET /api/v2/ws`.

Fan-out: ONE Postgres channel (`musix_events`) with the account in the payload; each api
process LISTENs once on a dedicated asyncpg connection and routes to its own sockets.
Ruling vs spec §8 ("a channel per account"): one LISTEN is simpler, and at ≤ 20 users
the per-event filter is free.

Each socket has a bounded queue and its own writer, so a slow client never stalls the
notify callback: on overflow it is closed and reconnects with `lastSeq`. NOTIFYs lost
while the listener reconnects are covered the same way — every socket is told to sync."""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import asyncpg
import sqlalchemy as sa
import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from musix.contexts.identity.models import instance_settings
from musix.contexts.identity.security import verify_access
from musix.contexts.sync.service import delta_cursor, head_seq
from musix.errors import Unauthorized
from musix.infra.changelog import CHANNEL, notify

log = structlog.get_logger()
HEARTBEAT_S = 25.0
AUTH_TIMEOUT_S = 10.0
QUEUE_MAX = 256
router = APIRouter(tags=["realtime"])


@dataclass(eq=False)
class Client:
    account_id: uuid.UUID
    device_id: uuid.UUID
    queue: asyncio.Queue[dict[str, Any]] = field(default_factory=lambda: asyncio.Queue(QUEUE_MAX))
    overflow: asyncio.Event = field(default_factory=asyncio.Event)

    def push(self, msg: dict[str, Any]) -> None:
        try:
            self.queue.put_nowait(msg)
        except asyncio.QueueFull:
            self.overflow.set()


def route(payload: dict[str, Any]) -> dict[str, Any] | None:
    """A NOTIFY payload → the client message (None: not for clients)."""
    kind = payload.get("kind")
    if kind == "sync":
        seq = int(payload["seq"])
        return {"type": "sync.changed", "seq": seq, "cursor": delta_cursor(seq)}
    if kind == "job":
        t = "job.done" if payload.get("state") == "done" else "job.progress"
        return {"type": t, **{k: payload[k] for k in ("job", "done", "total") if k in payload}}
    if kind == "instance":
        return {"type": "instance.status", "status": payload.get("status")}
    if kind == "presence":
        return {
            "type": "device.presence",
            "deviceId": payload["device"],
            "online": payload["online"],
        }
    return None  # "listens" is for the stream state (phase 2)


class Hub:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._clients: dict[uuid.UUID, set[Client]] = {}
        self._task: asyncio.Task[None] | None = None
        self.connected = asyncio.Event()

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    def join(self, c: Client) -> None:
        self._clients.setdefault(c.account_id, set()).add(c)

    def leave(self, c: Client) -> None:
        peers = self._clients.get(c.account_id)
        if peers is not None:
            peers.discard(c)
            if not peers:
                del self._clients[c.account_id]

    def _on_notify(self, _conn: Any, _pid: int, _channel: str, raw: str) -> None:
        try:
            payload = json.loads(raw)
            msg = route(payload)
        except (ValueError, KeyError, TypeError):
            log.warning("realtime.bad_payload", payload=raw[:200])
            return
        if msg is None:
            return
        account = payload.get("account")
        targets = (
            [c for cs in self._clients.values() for c in cs]
            if account is None
            else self._clients.get(uuid.UUID(account), ())
        )
        for c in list(targets):
            if msg["type"] == "device.presence" and str(c.device_id) == payload["device"]:
                continue
            c.push(msg)

    async def _run(self) -> None:
        backoff, first = 1.0, True
        while True:
            conn: asyncpg.Connection | None = None
            try:
                conn = await asyncpg.connect(self._dsn)
                lost = asyncio.Event()
                conn.add_termination_listener(lambda _c, ev=lost: ev.set())
                await conn.add_listener(CHANNEL, self._on_notify)
                self.connected.set()
                if not first:  # events may have been missed while we were away
                    for cs in self._clients.values():
                        for c in cs:
                            c.push({"type": "sync.changed", "seq": None, "cursor": None})
                first, backoff = False, 1.0
                await lost.wait()
                log.warning("realtime.listener_lost")
            except asyncio.CancelledError:
                if conn is not None and not conn.is_closed():
                    await conn.close()
                raise
            except (OSError, asyncpg.PostgresError) as e:
                log.warning("realtime.listener_error", error=str(e))
            self.connected.clear()
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)


async def _auth(ws: WebSocket) -> tuple[Any, int | None]:
    msg = await asyncio.wait_for(ws.receive_json(), AUTH_TIMEOUT_S)
    if not isinstance(msg, dict) or msg.get("type") != "auth" or not msg.get("token"):
        raise Unauthorized("the first message must be auth")
    last = msg.get("lastSeq")
    return verify_access(ws.app.state.secrets, str(msg["token"])), int(
        last
    ) if last is not None else None


async def _presence(ws: WebSocket, c: Client, online: bool) -> None:
    async with ws.app.state.sessionmaker() as s:
        await notify(s, c.account_id, "presence", device=str(c.device_id), online=online)
        await s.commit()


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    try:
        p, last_seq = await _auth(ws)
    except (TimeoutError, Unauthorized, ValueError, TypeError, WebSocketDisconnect):
        with contextlib.suppress(Exception):
            await ws.close(code=4401)
        return
    hub: Hub = ws.app.state.hub
    c = Client(p.account_id, p.device_id)
    hub.join(c)  # before reading the head: nothing between the two is lost
    expires_at = p.expires_at
    try:
        async with ws.app.state.sessionmaker() as s:
            head = await head_seq(s, p.account_id)
            status = await s.scalar(
                sa.select(instance_settings.c.value).where(instance_settings.c.key == "status")
            )
        await ws.send_json({"type": "ready", "seq": head})
        if status is not None:
            await ws.send_json({"type": "instance.status", "status": status})
        if last_seq is not None and head > last_seq:
            await ws.send_json({"type": "sync.changed", "seq": head, "cursor": delta_cursor(head)})
        await _presence(ws, c, True)

        async def writer() -> None:
            while True:
                await ws.send_json(await c.queue.get())

        async def reader() -> None:
            nonlocal expires_at
            while True:
                msg = await ws.receive_json()
                if isinstance(msg, dict) and msg.get("type") == "auth" and msg.get("token"):
                    np = verify_access(ws.app.state.secrets, str(msg["token"]))  # a refreshed token
                    if np.account_id != p.account_id:
                        raise Unauthorized("account changed")
                    expires_at = np.expires_at

        async def heartbeat() -> None:
            while True:
                await asyncio.sleep(HEARTBEAT_S)
                if time.time() > expires_at:
                    raise Unauthorized("access token expired")
                c.push({"type": "ping"})

        async def overflow() -> None:
            await c.overflow.wait()

        tasks = [asyncio.create_task(f()) for f in (writer, reader, heartbeat, overflow)]
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        err = next((t.exception() for t in done if not t.cancelled() and t.exception()), None)
        code = 4401 if isinstance(err, Unauthorized) else 1013 if c.overflow.is_set() else 1000
        if not isinstance(err, WebSocketDisconnect):
            with contextlib.suppress(Exception):
                await ws.close(code=code)
    finally:
        hub.leave(c)
        # shielded: a cancelled endpoint must not strand a pooled connection mid-query;
        # the cancellation itself still propagates
        leaving = asyncio.ensure_future(_presence(ws, c, False))
        with contextlib.suppress(Exception):
            await asyncio.shield(leaving)
