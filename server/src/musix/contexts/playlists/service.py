"""Playlists: soft-deleted rows (tombstones for /sync), items ordered by fractional
keys — adding or moving an item writes that item's row and nothing else."""

from __future__ import annotations

import datetime as dt
import uuid

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.library.service import own_track_ids
from musix.contexts.playlists import fractional
from musix.contexts.playlists import schemas as S
from musix.contexts.playlists.models import playlist_items, playlists
from musix.errors import Conflict, Invalid, NotFound
from musix.infra.changelog import record_change

P, It = playlists.c, playlist_items.c
_LIVE_ITEMS = (
    sa.select(sa.func.count())
    .where(It.playlist_id == P.id, It.deleted_at.is_(None))
    .scalar_subquery()
    .label("item_count")
)


def now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


async def _owned(s: AsyncSession, account_id: uuid.UUID, pid: uuid.UUID) -> None:
    ok = await s.scalar(
        sa.select(P.id)
        .where(P.id == pid, P.account_id == account_id, P.deleted_at.is_(None))
        .with_for_update()  # serializes concurrent edits of one playlist's order
    )
    if ok is None:
        raise NotFound("playlist")


async def _one(s: AsyncSession, pid: uuid.UUID) -> S.PlaylistOut:
    row = (await s.execute(sa.select(playlists, _LIVE_ITEMS).where(P.id == pid))).one()
    return S.PlaylistOut.model_validate(row._mapping)


async def list_playlists(s: AsyncSession, account_id: uuid.UUID) -> list[S.PlaylistOut]:
    rows = await s.execute(
        sa.select(playlists, _LIVE_ITEMS)
        .where(P.account_id == account_id, P.deleted_at.is_(None))
        .order_by(P.updated_at.desc())
    )
    return [S.PlaylistOut.model_validate(r._mapping) for r in rows]


async def create(s: AsyncSession, account_id: uuid.UUID, body: S.PlaylistIn) -> S.PlaylistOut:
    values = {"account_id": account_id, "name": body.name, "description": body.description}
    pid = await s.scalar(
        pg_insert(playlists)
        .values(**values, **({"id": body.id} if body.id else {}))
        .on_conflict_do_nothing(index_elements=["id"])
        .returning(P.id)
    )
    if pid is None:  # a replayed offline create is fine; someone else's id is not
        row = (await s.execute(sa.select(P.account_id, P.deleted_at).where(P.id == body.id))).one()
        if row.account_id != account_id:
            raise Conflict("playlist id taken")
        if row.deleted_at is not None:  # a replay must not resurrect what was deleted since
            raise Conflict("playlist was deleted")
        return await _one(s, body.id)  # type: ignore[arg-type]
    await record_change(s, account_id, "playlist", pid)
    await s.commit()
    return await _one(s, pid)


async def update(
    s: AsyncSession, account_id: uuid.UUID, pid: uuid.UUID, body: S.PlaylistPatch
) -> S.PlaylistOut:
    await _owned(s, account_id, pid)
    changes = body.model_dump(exclude_unset=True)
    if changes:
        await s.execute(sa.update(playlists).where(P.id == pid).values(**changes, updated_at=now()))
        await record_change(s, account_id, "playlist", pid)
    await s.commit()
    return await _one(s, pid)


async def delete(s: AsyncSession, account_id: uuid.UUID, pid: uuid.UUID) -> None:
    await _owned(s, account_id, pid)
    await s.execute(sa.update(playlists).where(P.id == pid).values(deleted_at=now()))
    await record_change(s, account_id, "playlist", pid, op="delete")
    await s.commit()


async def items(s: AsyncSession, account_id: uuid.UUID, pid: uuid.UUID) -> list[S.ItemOut]:
    ok = await s.scalar(
        sa.select(P.id).where(P.id == pid, P.account_id == account_id, P.deleted_at.is_(None))
    )
    if ok is None:
        raise NotFound("playlist")
    rows = await s.execute(
        sa.select(It.item_id, It.track_id, It.position, It.added_at)
        .where(It.playlist_id == pid, It.deleted_at.is_(None))
        .order_by(It.position, It.item_id)  # equal keys from two offline devices: stable
    )
    return [S.ItemOut.model_validate(r._mapping) for r in rows]


async def _neighbours(
    s: AsyncSession, pid: uuid.UUID, after: uuid.UUID | None, skip: uuid.UUID | None = None
) -> tuple[str | None, str | None]:
    """Keys of `after` (None: the top) and of the live item right below it."""
    live = [It.playlist_id == pid, It.deleted_at.is_(None)]
    if skip is not None:
        live.append(It.item_id != skip)
    lo = None
    if after is not None:
        lo = await s.scalar(sa.select(It.position).where(*live, It.item_id == after))
        if lo is None:
            raise NotFound("afterItemId")
    q = sa.select(It.position).where(*live).order_by(It.position).limit(1)
    hi = await s.scalar(q.where(It.position > lo) if lo is not None else q)
    return lo, hi


async def add_items(
    s: AsyncSession, account_id: uuid.UUID, pid: uuid.UUID, body: S.ItemsAdd
) -> list[S.ItemOut]:
    await _owned(s, account_id, pid)
    ids = {i.track_id for i in body.items}
    unknown = ids - await own_track_ids(s, account_id, ids)
    if unknown:  # a bad reference in the body, not a missing URL resource: 400, not 404
        raise Invalid("unknown trackId", track_ids=sorted(map(str, unknown)))
    if body.positions is not None:
        if len(body.positions) != len(body.items):
            raise Invalid("positions must match items")
        keys = body.positions
    elif body.after_item_id is None:
        last = await s.scalar(
            sa.select(sa.func.max(It.position)).where(
                It.playlist_id == pid, It.deleted_at.is_(None)
            )
        )
        keys = fractional.keys_between(last, None, len(body.items))
    else:
        keys = fractional.keys_between(
            *await _neighbours(s, pid, body.after_item_id), len(body.items)
        )
    rows = [
        {
            "playlist_id": pid,
            "item_id": i.item_id or uuid.uuid4(),
            "track_id": i.track_id,
            "position": k,
        }
        for i, k in zip(body.items, keys, strict=True)
    ]
    inserted = await s.scalars(
        pg_insert(playlist_items).values(rows).on_conflict_do_nothing().returning(It.item_id)
    )
    for item_id in inserted:  # replayed item ids are no-ops
        await record_change(s, account_id, "playlistItem", item_id)
    await s.commit()
    return await items(s, account_id, pid)


async def move_item(
    s: AsyncSession, account_id: uuid.UUID, pid: uuid.UUID, item_id: uuid.UUID, body: S.ItemMove
) -> S.ItemOut:
    await _owned(s, account_id, pid)
    if body.position is not None:
        key = body.position
    else:
        if body.after_item_id == item_id:
            raise Invalid("cannot move an item after itself")
        key = fractional.key_between(*await _neighbours(s, pid, body.after_item_id, skip=item_id))
    row = (
        await s.execute(
            sa.update(playlist_items)
            .where(It.playlist_id == pid, It.item_id == item_id, It.deleted_at.is_(None))
            .values(position=key)
            .returning(It.item_id, It.track_id, It.position, It.added_at)
        )
    ).first()
    if row is None:
        raise NotFound("item")
    await record_change(s, account_id, "playlistItem", item_id)
    await s.commit()
    return S.ItemOut.model_validate(row._mapping)


async def remove_item(
    s: AsyncSession, account_id: uuid.UUID, pid: uuid.UUID, item_id: uuid.UUID
) -> None:
    await _owned(s, account_id, pid)
    hit = await s.scalar(
        sa.update(playlist_items)
        .where(It.playlist_id == pid, It.item_id == item_id, It.deleted_at.is_(None))
        .values(deleted_at=now())
        .returning(It.item_id)
    )
    if hit is None:
        raise NotFound("item")
    await record_change(s, account_id, "playlistItem", item_id, op="delete")
    await s.commit()
