"""Core queue tasks. Phase 0's `ping` proves a worker consumes the queue."""

from __future__ import annotations

from typing import Any

import httpx
import procrastinate
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from musix.contexts.identity.models import instance_settings
from musix.infra.changelog import notify
from musix.workers.context import sessionmaker, settings

IS = instance_settings.c


async def ping() -> str:
    return "pong"


async def _llm_status(base: str | None) -> str:
    if not base:
        return "unconfigured"
    try:
        async with httpx.AsyncClient(timeout=3.0, trust_env=False) as h:
            r = await h.get(base.rstrip("/") + "/models")
    except httpx.HTTPError:
        return "down"
    return "up" if r.is_success else "unauthorized" if r.status_code in (401, 403) else "down"


async def probe_instance(timestamp: int) -> str:
    """LLM availability, probed once for everyone (v1 had each client poll every 60 s).
    Pushed as `instance.status` only when it changes."""
    sm = sessionmaker()
    async with sm() as s:
        cfg: dict[str, Any] = await s.scalar(sa.select(IS.value).where(IS.key == "llm")) or {}
    status = {"llm": await _llm_status(cfg.get("baseUrl") or settings().llm_base_url)}
    async with sm() as s:
        prev = await s.scalar(sa.select(IS.value).where(IS.key == "status").with_for_update())
        if prev != status:
            await s.execute(
                pg_insert(instance_settings)
                .values(key="status", value=status)
                .on_conflict_do_update(
                    index_elements=["key"], set_={"value": status, "updated_at": sa.func.now()}
                )
            )
            await notify(s, None, "instance", status=status)
        await s.commit()
    return status["llm"]


async def prune_idempotency(timestamp: int) -> int:
    from musix.api.idempotency import prune

    async with sessionmaker()() as s:
        n = await prune(s)
        await s.commit()
    return n


def register(app: procrastinate.App) -> None:
    app.task(name="core:ping", queue="default")(ping)
    probe = app.task(name="core:probe_instance", queue="default")(probe_instance)
    app.periodic(cron="* * * * *", periodic_id="probe_instance")(probe)
    prune_task = app.task(name="core:prune_idempotency", queue="default")(prune_idempotency)
    app.periodic(cron="17 * * * *", periodic_id="prune_idempotency")(prune_task)
