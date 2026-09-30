"""Identity use cases. Transactions are short; argon2 runs off the event loop."""

from __future__ import annotations

import asyncio
import datetime as dt
import re
import secrets as pysecrets
import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.identity import schemas as S
from musix.contexts.identity import security as sec
from musix.contexts.identity.models import (
    account_settings,
    accounts,
    devices,
    instance,
    invites,
    refresh_tokens,
)
from musix.errors import Conflict, Forbidden, Invalid, NotFound, Unauthorized
from musix.infra.changelog import record_change
from musix.infra.secrets import Secrets

INVITE_TTL = dt.timedelta(days=7)


def now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


async def _issue(
    s: AsyncSession,
    k: Secrets,
    account_id: uuid.UUID,
    role: str,
    device_id: uuid.UUID,
    family_id: uuid.UUID | None = None,
) -> S.Tokens:
    token, digest = sec.new_refresh()
    await s.execute(
        sa.insert(refresh_tokens).values(
            device_id=device_id,
            family_id=family_id or uuid.uuid4(),
            token_hash=digest,
            expires_at=now() + sec.REFRESH_TTL,
        )
    )
    access = sec.issue_access(k, sec.Principal(account_id, device_id, role))
    return S.Tokens(
        access_token=access,
        refresh_token=token,
        expires_in=int(sec.ACCESS_TTL.total_seconds()),
        account_id=account_id,
        device_id=device_id,
        role=role,
    )


async def _new_device(s: AsyncSession, account_id: uuid.UUID, d: S.DeviceIn) -> uuid.UUID:
    return uuid.UUID(
        str(
            await s.scalar(
                sa.insert(devices)
                .values(
                    account_id=account_id,
                    name=d.name,
                    platform=d.platform,
                    app_version=d.app_version,
                )
                .returning(devices.c.id)
            )
        )
    )


EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+")


async def _create_account(s: AsyncSession, email: str, password: str, role: str) -> uuid.UUID:
    if not EMAIL_RE.fullmatch(email):
        raise Invalid("not an email address")
    pw = await asyncio.to_thread(sec.hash_password, password)
    try:
        aid = await s.scalar(
            sa.insert(accounts)
            .values(email=email, password_hash=pw, role=role)
            .returning(accounts.c.id)
        )
    except sa.exc.IntegrityError as e:
        raise Conflict("email already registered") from e
    await s.execute(sa.insert(account_settings).values(account_id=aid, value={}))
    return uuid.UUID(str(aid))


async def setup(s: AsyncSession, k: Secrets, body: S.SetupIn) -> S.Tokens:
    """First run: the owner and the instance mode. Only once."""
    if await s.scalar(sa.select(instance.c.mode)):
        raise Conflict("instance already set up")
    await s.execute(sa.insert(instance).values(mode=body.mode))
    aid = await _create_account(s, body.email, body.password, "owner")
    await s.execute(sa.update(accounts).where(accounts.c.id == aid).values(last_login_at=now()))
    dev = await _new_device(s, aid, body.device)
    tokens = await _issue(s, k, aid, "owner", dev)
    await s.commit()
    return tokens


async def login(s: AsyncSession, k: Secrets, body: S.LoginIn) -> S.Tokens:
    row = (
        await s.execute(
            sa.select(accounts.c.id, accounts.c.password_hash, accounts.c.role).where(
                accounts.c.email == body.email
            )
        )
    ).first()
    ok = row is not None and await asyncio.to_thread(
        sec.verify_password, row.password_hash, body.password
    )
    if not ok or row is None:
        raise Unauthorized("wrong email or password")
    await s.execute(sa.update(accounts).where(accounts.c.id == row.id).values(last_login_at=now()))
    dev = await _new_device(s, row.id, body.device)
    tokens = await _issue(s, k, row.id, row.role, dev)
    await s.commit()
    return tokens


async def register(s: AsyncSession, k: Secrets, body: S.RegisterIn) -> S.Tokens:
    from musix.contexts.admin.service import registration_open

    if not await registration_open(s):
        raise Forbidden("registration is closed on this server")
    inv = (
        await s.execute(
            sa.select(invites).where(invites.c.code == body.invite_code).with_for_update()
        )
    ).first()
    if inv is None or inv.consumed_at is not None or inv.expires_at < now():
        raise Invalid("invite is invalid, used or expired")
    aid = await _create_account(s, body.email, body.password, "member")
    await s.execute(sa.update(accounts).where(accounts.c.id == aid).values(last_login_at=now()))
    await s.execute(
        sa.update(invites)
        .where(invites.c.code == inv.code)
        .values(consumed_by=aid, consumed_at=now())
    )
    dev = await _new_device(s, aid, body.device)
    tokens = await _issue(s, k, aid, "member", dev)
    await s.commit()
    return tokens


async def refresh(s: AsyncSession, k: Secrets, token: str) -> S.Tokens:
    """Rotate. Presenting an already-rotated token = theft: the whole family is revoked."""
    rt = (
        await s.execute(
            sa.select(
                refresh_tokens,
                devices.c.account_id,
                devices.c.revoked_at.label("device_revoked"),
                accounts.c.role,
            )
            .join(devices, devices.c.id == refresh_tokens.c.device_id)
            .join(accounts, accounts.c.id == devices.c.account_id)
            .where(refresh_tokens.c.token_hash == sec.refresh_hash(token))
            .with_for_update(of=refresh_tokens)
        )
    ).first()
    if (
        rt is None
        or rt.revoked_at is not None
        or rt.device_revoked is not None
        or rt.expires_at < now()
    ):
        raise Unauthorized("refresh token is not valid")
    if rt.rotated_at is not None:
        await s.execute(
            sa.update(refresh_tokens)
            .where(refresh_tokens.c.family_id == rt.family_id)
            .values(revoked_at=now())
        )
        await s.commit()
        raise Unauthorized("refresh token reuse detected: the session is revoked")
    await s.execute(
        sa.update(refresh_tokens).where(refresh_tokens.c.id == rt.id).values(rotated_at=now())
    )
    await s.execute(
        sa.update(devices).where(devices.c.id == rt.device_id).values(last_seen_at=now())
    )
    tokens = await _issue(s, k, rt.account_id, rt.role, rt.device_id, rt.family_id)
    await s.commit()
    return tokens


async def revoke_device(s: AsyncSession, account_id: uuid.UUID, device_id: uuid.UUID) -> None:
    hit = await s.scalar(
        sa.update(devices)
        .where(
            devices.c.id == device_id,
            devices.c.account_id == account_id,
            devices.c.revoked_at.is_(None),
        )
        .values(revoked_at=now())
        .returning(devices.c.id)
    )
    if hit is None:
        raise NotFound("device")
    await s.execute(
        sa.update(refresh_tokens)
        .where(refresh_tokens.c.device_id == device_id, refresh_tokens.c.revoked_at.is_(None))
        .values(revoked_at=now())
    )
    await s.commit()


async def list_devices(
    s: AsyncSession, account_id: uuid.UUID, current: uuid.UUID
) -> list[S.DeviceOut]:
    rows = await s.execute(
        sa.select(devices)
        .where(devices.c.account_id == account_id, devices.c.revoked_at.is_(None))
        .order_by(devices.c.last_seen_at.desc())
    )
    return [S.DeviceOut.model_validate({**r._mapping, "current": r.id == current}) for r in rows]


async def create_invite(s: AsyncSession, owner: uuid.UUID) -> S.InviteOut:
    code = pysecrets.token_urlsafe(9)
    row = (
        await s.execute(
            sa.insert(invites)
            .values(code=code, created_by=owner, expires_at=now() + INVITE_TTL)
            .returning(invites)
        )
    ).one()
    await s.commit()
    return S.InviteOut(
        code=row.code, created_at=row.created_at, expires_at=row.expires_at, consumed=False
    )


async def list_invites(s: AsyncSession, owner: uuid.UUID) -> list[S.InviteOut]:
    rows = await s.execute(
        sa.select(invites)
        .where(invites.c.created_by == owner)
        .order_by(invites.c.created_at.desc())
    )
    return [
        S.InviteOut(
            code=r.code,
            created_at=r.created_at,
            expires_at=r.expires_at,
            consumed=r.consumed_at is not None,
        )
        for r in rows
    ]


async def revoke_invite(s: AsyncSession, owner: uuid.UUID, code: str) -> None:
    hit = await s.scalar(
        sa.delete(invites)
        .where(
            invites.c.code == code, invites.c.created_by == owner, invites.c.consumed_at.is_(None)
        )
        .returning(invites.c.code)
    )
    if hit is None:
        raise NotFound("invite")
    await s.commit()


async def get_settings(s: AsyncSession, account_id: uuid.UUID) -> dict[str, Any]:
    return dict(
        await s.scalar(
            sa.select(account_settings.c.value).where(account_settings.c.account_id == account_id)
        )
        or {}
    )


async def put_settings(
    s: AsyncSession, account_id: uuid.UUID, value: dict[str, Any]
) -> dict[str, Any]:
    await s.execute(
        pg_insert(account_settings)
        .values(account_id=account_id, value=value, updated_at=now())
        .on_conflict_do_update(
            index_elements=["account_id"], set_={"value": value, "updated_at": now()}
        )
    )
    await record_change(s, account_id, "settings", account_id)
    await s.commit()
    return value


def require_owner(role: str) -> None:
    if role != "owner":
        raise Forbidden("owner only")
