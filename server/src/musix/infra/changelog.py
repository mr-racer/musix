"""Every synced mutation writes a change_log row IN THE SAME TRANSACTION (spec §7),
through this one helper, and NOTIFYs listeners after commit. Every other realtime event
(jobs, presence, instance status) goes through `notify` on the same channel."""

from __future__ import annotations

import json
import uuid

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from musix.infra.tables import change_log

CHANNEL = "musix_events"


async def record_change(
    s: AsyncSession,
    account_id: uuid.UUID,
    entity: str,
    entity_id: str | uuid.UUID,
    op: str = "upsert",
) -> int:
    seq = await s.scalar(
        sa.insert(change_log)
        .values(account_id=account_id, entity=entity, entity_id=str(entity_id), op=op)
        .returning(change_log.c.seq)
    )
    await notify(s, account_id, "sync", seq=seq)
    return int(seq or 0)


async def notify(
    s: AsyncSession, account_id: uuid.UUID | None, kind: str, **fields: object
) -> None:
    """One event on the shared channel; `account` None = every connected client.
    pg_notify is transactional: delivered only if this transaction commits."""
    payload = {"account": str(account_id) if account_id else None, "kind": kind, **fields}
    await s.execute(
        sa.text("select pg_notify(:ch, :payload)"),
        {"ch": CHANNEL, "payload": json.dumps(payload, default=str)},
    )
