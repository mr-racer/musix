import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.handoff import schemas as S
from musix.contexts.handoff.models import device_online, playback_sessions
from musix.contexts.identity.models import devices
from musix.errors import Conflict, NotFound
from musix.infra.changelog import notify

ONLINE_S = 75  # three missed heartbeats (25 s) and a device is gone


async def touch(
    s: AsyncSession, account: uuid.UUID, device: uuid.UUID, can_play: bool | None = None
) -> None:
    """Online now (on connect, hello and every heartbeat); `can_play` None keeps what was said."""
    ins = insert(device_online).values(
        account_id=account, device_id=device, can_play=bool(can_play)
    )
    upd: dict[str, Any] = {"seen_at": sa.func.now()}
    if can_play is not None:
        upd["can_play"] = can_play
    await s.execute(ins.on_conflict_do_update(index_elements=[device_online.c.device_id], set_=upd))


async def gone(s: AsyncSession, device: uuid.UUID) -> None:
    await s.execute(sa.delete(device_online).where(device_online.c.device_id == device))


async def active(s: AsyncSession, account: uuid.UUID, me: uuid.UUID) -> list[S.ActiveDevice]:
    player = await s.scalar(
        sa.select(playback_sessions.c.device_id).where(playback_sessions.c.account_id == account)
    )
    rows = await s.execute(
        sa.select(devices.c.id, devices.c.name, devices.c.platform, device_online.c.can_play)
        .join(device_online, device_online.c.device_id == devices.c.id)
        .where(
            device_online.c.account_id == account,
            devices.c.revoked_at.is_(None),
            device_online.c.seen_at > sa.func.now() - sa.text(f"interval '{ONLINE_S} seconds'"),
        )
        .order_by(devices.c.name)
    )
    return [
        S.ActiveDevice(
            id=r.id,
            name=r.name,
            platform=r.platform,
            can_play=r.can_play,
            current=r.id == me,
            active=r.id == player,
        )
        for r in rows
    ]


async def session(s: AsyncSession, account: uuid.UUID) -> S.SessionOut:
    r = (
        await s.execute(
            sa.select(playback_sessions).where(playback_sessions.c.account_id == account)
        )
    ).first()
    if r is None:
        raise NotFound("no playback yet")
    return S.SessionOut(
        device_id=r.device_id,
        state=S.PlaybackState.model_validate(r.state),
        updated_at=r.updated_at,
    )


async def publish(
    s: AsyncSession, account: uuid.UUID, device: uuid.UUID, state: S.PlaybackState
) -> None:
    """The active player's state: kept (a new device can continue it) and announced to the
    account's other devices. The NOTIFY carries only a summary: payloads cap at 8 KB."""
    doc = state.model_dump(mode="json", by_alias=True)
    ins = insert(playback_sessions).values(account_id=account, device_id=device, state=doc)
    await s.execute(
        ins.on_conflict_do_update(
            index_elements=[playback_sessions.c.account_id],
            set_={"device_id": device, "state": doc, "updated_at": sa.func.now()},
        )
    )
    track = str(state.track_ids[state.index]) if state.track_ids else None
    await notify(
        s,
        account,
        "playback.state",
        device=str(device),
        trackId=track,
        playing=state.playing,
        positionMs=state.position_ms,
    )


async def _online(s: AsyncSession, account: uuid.UUID, device: uuid.UUID) -> bool:
    return bool(
        await s.scalar(
            sa.select(sa.literal(True)).where(
                device_online.c.device_id == device,
                device_online.c.account_id == account,
                device_online.c.seen_at > sa.func.now() - sa.text(f"interval '{ONLINE_S} seconds'"),
            )
        )
    )


async def transfer(
    s: AsyncSession, account: uuid.UUID, me: uuid.UUID, to: uuid.UUID, play: bool
) -> None:
    """`take` goes to the target, which fetches the session itself; the previous player gets
    `release` and pauses. Nothing changes here until the target publishes its own state."""
    if not await _online(s, account, to):
        raise NotFound("that device is not online")
    if not await s.scalar(
        sa.select(device_online.c.can_play).where(device_online.c.device_id == to)
    ):
        raise Conflict("that device cannot play now")
    row = (
        await s.execute(
            sa.select(playback_sessions.c.device_id).where(
                playback_sessions.c.account_id == account
            )
        )
    ).first()
    if row is None:
        raise NotFound("nothing to hand over yet")
    player = row.device_id
    await notify(s, account, "playback.take", target=str(to), play=play, by=str(me))
    if player is not None and player != to:
        await notify(s, account, "playback.release", target=str(player), to=str(to))


async def command(s: AsyncSession, account: uuid.UUID, me: uuid.UUID, cmd: S.CommandMsg) -> None:
    """A remote control press, delivered to the queue owner only; it applies it itself."""
    if not await _online(s, account, cmd.target):
        raise NotFound("that device is not online")
    await notify(
        s,
        account,
        "playback.command",
        target=str(cmd.target),
        command=cmd.command,
        by=str(me),
        **cmd.args(),
    )
