"""`Idempotency-Key` on mutating POSTs (spec §6), as payment APIs do it.

The first response to (account, key) is stored for 24 h and replayed to a retry of the
same request; the same key on a different request is 422, and a retry that arrives while
the first is still running is 409. 5xx responses are not stored, so they can be retried.
Pure ASGI (no BaseHTTPMiddleware): the body is buffered once for hashing and handed on."""

from __future__ import annotations

import hashlib
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import BYTEA, JSONB, UUID
from sqlalchemy.dialects.postgresql import insert as pg_insert
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from musix.contexts.identity.security import verify_access
from musix.errors import Unauthorized, problem
from musix.infra.tables import metadata

TTL = "24 hours"
idempotency_keys = sa.Table(
    "idempotency_keys",
    metadata,
    sa.Column("account_id", UUID(as_uuid=True), primary_key=True),
    sa.Column("key", sa.Text, primary_key=True),
    sa.Column("request_hash", BYTEA, nullable=False),
    sa.Column("status", sa.Integer),
    sa.Column("headers", JSONB),
    sa.Column("body", BYTEA),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
)
K = idempotency_keys.c


class IdempotencyMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        key, auth = headers.get(b"idempotency-key"), headers.get(b"authorization", b"")
        state = scope["app"].state
        try:
            if not key or not auth.startswith(b"Bearer ") or len(key) > 255:
                raise Unauthorized("")
            account = verify_access(state.secrets, auth[7:].decode()).account_id
        except (Unauthorized, UnicodeDecodeError):
            return await self.app(scope, receive, send)  # the route itself answers
        chunks, more = [], True
        while more:
            m = await receive()
            chunks.append(m.get("body", b""))
            more = m.get("more_body", False)
        body = b"".join(chunks)
        digest = hashlib.sha256(
            b"\n".join([scope["path"].encode(), scope.get("query_string", b""), body])
        ).digest()
        k = key.decode("latin-1")
        async with state.sessionmaker() as s:
            ins = pg_insert(idempotency_keys).values(account_id=account, key=k, request_hash=digest)
            claimed = await s.scalar(
                ins.on_conflict_do_update(  # an expired key is claimed afresh
                    index_elements=["account_id", "key"],
                    set_={
                        "request_hash": digest,
                        "status": None,
                        "headers": None,
                        "body": None,
                        "created_at": sa.func.now(),
                    },
                    where=K.created_at < sa.func.now() - sa.text(f"interval '{TTL}'"),
                ).returning(K.key)
            )
            prior = None
            if claimed is None:
                prior = (
                    await s.execute(
                        sa.select(K.request_hash, K.status, K.headers, K.body).where(
                            K.account_id == account, K.key == k
                        )
                    )
                ).one()
            await s.commit()
        if prior is not None:
            if prior.request_hash != digest:
                resp = problem(
                    422, "Idempotency-Key reused", "the key was used for another request"
                )
            elif prior.status is None:
                resp = problem(
                    409, "Request in progress", "a request with this key is still running"
                )
            else:
                return await _replay(send, prior.status, prior.headers or {}, prior.body or b"")
            return await resp(scope, receive, send)

        sent = False

        async def replay_body() -> Message:
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        out: dict[str, Any] = {"status": 500, "headers": {}, "body": []}

        async def capture(m: Message) -> None:
            if m["type"] == "http.response.start":
                out["status"] = m["status"]
                out["headers"] = {
                    n.decode(): v.decode()
                    for n, v in m.get("headers", [])
                    if n.lower() in (b"content-type", b"etag", b"location")
                }
            elif m["type"] == "http.response.body":
                out["body"].append(m.get("body", b""))
            await send(m)

        try:
            await self.app(scope, replay_body, capture)
        finally:
            async with state.sessionmaker() as s:
                where = sa.and_(K.account_id == account, K.key == k)
                if out["status"] < 500:
                    await s.execute(
                        sa.update(idempotency_keys)
                        .where(where)
                        .values(
                            status=out["status"], headers=out["headers"], body=b"".join(out["body"])
                        )
                    )
                else:
                    await s.execute(sa.delete(idempotency_keys).where(where))
                await s.commit()


async def _replay(send: Send, status: int, headers: dict[str, str], body: bytes) -> None:
    raw = [(n.encode(), v.encode()) for n, v in headers.items()]
    raw += [(b"idempotent-replayed", b"true"), (b"content-length", str(len(body)).encode())]
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


async def prune(s: Any) -> int:
    gone = await s.scalars(
        sa.delete(idempotency_keys)
        .where(K.created_at < sa.func.now() - sa.text(f"interval '{TTL}'"))
        .returning(K.key)
    )
    return len(list(gone))
