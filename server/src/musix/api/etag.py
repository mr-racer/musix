"""ETags for personalized GETs (spec §6): computed from a cheap version read BEFORE the
body, so a 304 never builds the shape."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import sqlalchemy as sa
from fastapi import Request, Response

from musix.contexts.listening.models import account_track_stats
from musix.infra.tables import change_log

NOT_MODIFIED: dict[int | str, dict[str, Any]] = {304: {"description": "Not modified"}}


async def tag_for(
    request: Request, account_id: uuid.UUID, shape: str, with_plays: bool = False
) -> str:
    return (await versioned_tag(request, account_id, shape, with_plays))[0]


async def versioned_tag(
    request: Request,
    account_id: uuid.UUID,
    shape: str,
    with_plays: bool = False,
    also: tuple[Any, ...] = (),
) -> tuple[str, int]:
    """(ETag, change_log head). The tag hashes the head plus, for shapes that rank by
    listening (not change-logged), the latest play; the head doubles as a cache key."""
    cols: list[Any] = [
        sa.select(sa.func.max(change_log.c.seq))
        .where(change_log.c.account_id == account_id)
        .scalar_subquery()
    ]
    if with_plays:
        st = account_track_stats.c
        cols.append(
            sa.select(sa.func.max(st.last_played_at))
            .where(st.account_id == account_id)
            .scalar_subquery()
        )
    cols.extend(also)  # further versions a shape depends on (scalar subqueries)
    async with request.app.state.sessionmaker() as s:
        version = tuple((await s.execute(sa.select(*cols))).one())
    return make(shape, account_id, version), int(version[0] or 0)


# Bumped when a response's shape changes while its data does not (a new field, a text now
# cleaned on the way out): every tag moves once, so no client keeps revalidating an old
# body into 304s. 2: artist cutout/country, bios without the agent's notes (2026-10-01).
REV = 2


def make(*parts: object) -> str:
    return 'W/"' + hashlib.sha256(repr((REV, *parts)).encode()).hexdigest()[:24] + '"'


def matches(request: Request, tag: str) -> bool:
    inm = request.headers.get("if-none-match")
    if not inm:
        return False
    return inm.strip() == "*" or tag in {t.strip() for t in inm.split(",")}


async def conditional(
    request: Request, response: Response, tag: str, build: Callable[[], Awaitable[Any]]
) -> Any:
    headers = {"ETag": tag, "Cache-Control": "private, no-cache"}
    if matches(request, tag):
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return await build()
