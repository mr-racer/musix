"""The owner's admin: members, folder grants, the instance, ops numbers. Every read here
is aggregate — an admin view never lists another account's tracks (spec §2, users never
see other users' tracks)."""

from __future__ import annotations

import datetime as dt
import uuid
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.admin import schemas as S
from musix.contexts.identity.models import (
    accounts,
    devices,
    instance,
    instance_settings,
    invites,
    refresh_tokens,
)
from musix.contexts.library.models import media_files, renditions, tracks
from musix.errors import Forbidden, Invalid, NotFound

IS = instance_settings.c


async def _setting(s: AsyncSession, key: str) -> dict[str, Any]:
    return await s.scalar(sa.select(IS.value).where(IS.key == key)) or {}


async def _put_setting(s: AsyncSession, key: str, value: dict[str, Any]) -> None:
    await s.execute(
        pg_insert(instance_settings)
        .values(key=key, value=value)
        .on_conflict_do_update(
            index_elements=["key"], set_={"value": value, "updated_at": sa.func.now()}
        )
    )


async def instance_view(s: AsyncSession) -> S.InstanceOut:
    mode = await s.scalar(sa.select(instance.c.mode))
    cfg = S.InstanceSettings.model_validate(await _setting(s, "instance"))
    llm = (await _setting(s, "status")).get("llm") or "unknown"
    return S.InstanceOut(
        setup_required=mode is None,
        mode=mode,
        name=cfg.name,
        llm=llm,
        ai_for_members=cfg.ai_for_members,
    )


async def get_instance(s: AsyncSession) -> S.InstanceSettings:
    return S.InstanceSettings.model_validate(await _setting(s, "instance"))


async def put_instance(s: AsyncSession, body: S.InstanceSettings) -> S.InstanceSettings:
    await _put_setting(s, "instance", body.model_dump())
    await s.commit()
    return body


async def registration_open(s: AsyncSession) -> bool:
    return (await get_instance(s)).registration != "closed"


async def ai_allowed(s: AsyncSession, role: str) -> bool:
    return role == "owner" or (await get_instance(s)).ai_for_members


def _count(table: sa.Table, *where: Any) -> sa.Subquery:
    return (
        sa.select(table.c.account_id, sa.func.count().label("n"))
        .where(*where)
        .group_by(table.c.account_id)
        .subquery()
    )


async def members(s: AsyncSession) -> list[S.MemberOut]:
    from musix.contexts.listening.models import listen_events, taste_signals

    A = accounts.c
    t = _count(tracks, tracks.c.deleted_at.is_(None))
    le = _count(listen_events)
    lk = _count(taste_signals, taste_signals.c.kind == "fire")
    dv = _count(devices, devices.c.revoked_at.is_(None))
    inv = (
        sa.select(invites.c.consumed_by, invites.c.code)
        .where(invites.c.consumed_by.is_not(None))
        .subquery()
    )
    rows = await s.execute(
        sa.select(
            A.id,
            A.email,
            A.role,
            A.display_name,
            A.index_root,
            A.premium,
            A.created_at,
            A.last_login_at,
            inv.c.code.label("invite_code"),
            sa.func.coalesce(t.c.n, 0).label("tracks"),
            sa.func.coalesce(le.c.n, 0).label("listens"),
            sa.func.coalesce(lk.c.n, 0).label("likes"),
            sa.func.coalesce(dv.c.n, 0).label("devices"),
        )
        .outerjoin(inv, inv.c.consumed_by == A.id)
        .outerjoin(t, t.c.account_id == A.id)
        .outerjoin(le, le.c.account_id == A.id)
        .outerjoin(lk, lk.c.account_id == A.id)
        .outerjoin(dv, dv.c.account_id == A.id)
        .order_by(A.role.desc(), A.created_at)
    )
    return [S.MemberOut.model_validate(r._mapping) for r in rows]


async def patch_member(
    s: AsyncSession, member: uuid.UUID, body: S.MemberPatch, roots: list[str]
) -> S.MemberOut:
    values: dict[str, Any] = {}
    if body.index_root is not None:
        if body.index_root == "":
            values["index_root"] = None
        else:
            p = Path(body.index_root)
            if not p.is_absolute() or ".." in p.parts:
                raise Invalid("path must be absolute, without '..'")
            if not any(p.is_relative_to(r) for r in roots):
                raise Invalid("path is outside the library roots", roots=roots)
            values["index_root"] = str(p)
    if body.premium is not None:
        values["premium"] = body.premium
    if values:
        hit = await s.scalar(
            sa.update(accounts)
            .where(accounts.c.id == member)
            .values(**values)
            .returning(accounts.c.id)
        )
        if hit is None:
            raise NotFound("no such account")
        await s.commit()
    found = next((m for m in await members(s) if m.id == member), None)
    if found is None:
        raise NotFound("no such account")
    return found


async def purge(
    s: AsyncSession, owner: uuid.UUID, member: uuid.UUID, confirm_email: str
) -> list[uuid.UUID]:
    """v1's account delete: the account and everything keyed by it, in one transaction.
    Shared content (media files, songs, artists, facts) stays — other accounts may hold
    it; the vector payloads are re-owned by `intel:reown` after the commit. Returns the
    media files whose ownership changed."""
    row = (
        await s.execute(sa.select(accounts.c.email, accounts.c.role).where(accounts.c.id == member))
    ).first()
    if row is None:
        raise NotFound("no such account")
    if member == owner or row.role == "owner":
        raise Forbidden("the owner account cannot be deleted")
    if row.email.lower() != confirm_email.strip().lower():
        raise Invalid("the typed email does not match")
    mfs: list[uuid.UUID] = list(
        (
            await s.scalars(
                sa.select(tracks.c.media_file_id).where(tracks.c.account_id == member).distinct()
            )
        ).all()
    )
    from musix.contexts.playlists.models import playlist_items, playlists

    dev_ids = sa.select(devices.c.id).where(devices.c.account_id == member)
    await s.execute(sa.delete(refresh_tokens).where(refresh_tokens.c.device_id.in_(dev_ids)))
    await s.execute(
        sa.delete(playlist_items).where(
            playlist_items.c.playlist_id.in_(
                sa.select(playlists.c.id).where(playlists.c.account_id == member)
            )
        )
    )
    # everything else keyed by the account, children of `tracks` and `devices` first; the
    # table list comes from the catalog so a new per-account table cannot be forgotten
    keyed: list[str] = list(
        (
            await s.scalars(
                sa.text(
                    "select c.table_name from information_schema.columns c "
                    "join information_schema.tables t using (table_schema, table_name) "
                    "where c.table_schema = 'public' and c.column_name = 'account_id' "
                    "and t.table_type = 'BASE TABLE' and c.table_name not in "
                    "('accounts', 'tracks', 'devices', 'playlists')"
                )
            )
        ).all()
    )
    # the names come from the catalog and the literals below, never from the request
    for name in sorted(keyed):
        sql = f'delete from "{name}" where account_id = :a'  # noqa: S608
        await s.execute(sa.text(sql), {"a": member})
    mine = "select id from tracks where account_id = :a"
    for child in ("track_artists", "playlist_items"):  # keyed by the account's tracks, not by it
        sql = f"delete from {child} where track_id in ({mine})"  # noqa: S608
        await s.execute(sa.text(sql), {"a": member})
    await s.execute(sa.delete(playlists).where(playlists.c.account_id == member))
    await s.execute(sa.delete(tracks).where(tracks.c.account_id == member))
    await s.execute(sa.delete(devices).where(devices.c.account_id == member))
    await s.execute(
        sa.update(invites).where(invites.c.consumed_by == member).values(consumed_by=None)
    )
    await s.execute(sa.delete(invites).where(invites.c.created_by == member))
    await s.execute(sa.delete(accounts).where(accounts.c.id == member))
    await s.commit()
    return mfs


async def ops(s: AsyncSession, budget_gb: int) -> S.OpsOut:
    q = await s.execute(
        sa.text(
            "select queue_name, status::text, count(*) from procrastinate_jobs "
            "where status in ('todo', 'doing', 'failed') group by 1, 2 order by 1, 2"
        )
    )
    tiers = await s.execute(
        sa.select(
            renditions.c.tier,
            sa.func.count(),
            sa.func.coalesce(sa.func.sum(renditions.c.size_bytes), 0),
        )
        .group_by(renditions.c.tier)
        .order_by(renditions.c.tier)
    )
    M = media_files.c
    m = (
        await s.execute(
            sa.select(
                sa.func.count(),
                sa.func.coalesce(sa.func.sum(M.size_bytes), 0),
                sa.func.count().filter(sa.or_(M.codec.is_(None), M.lufs_integrated.is_(None))),
            )
        )
    ).one()
    rbytes = await s.scalar(sa.select(sa.func.coalesce(sa.func.sum(renditions.c.size_bytes), 0)))
    from musix.contexts.listening.models import listen_events

    since = dt.datetime.now(dt.UTC) - dt.timedelta(hours=24)
    return S.OpsOut(
        queues=[S.QueueDepth(queue=a, status=b, jobs=c) for a, b, c in q],
        media_bytes=int(m[1]),
        rendition_bytes=int(rbytes or 0),
        rendition_budget_bytes=budget_gb * 1024**3,
        media_files=int(m[0]),
        unprocessed=int(m[2]),
        renditions=[S.TierCoverage(tier=a, files=b, bytes=int(c)) for a, b, c in tiers],
        accounts=int(await s.scalar(sa.select(sa.func.count()).select_from(accounts)) or 0),
        tracks=int(
            await s.scalar(
                sa.select(sa.func.count()).select_from(tracks).where(tracks.c.deleted_at.is_(None))
            )
            or 0
        ),
        listens_24h=int(
            await s.scalar(
                sa.select(sa.func.count())
                .select_from(listen_events)
                .where(listen_events.c.started_at >= since)
            )
            or 0
        ),
    )
