"""The turn job, on its own `assistant` queue (worker-assistant, several turns at once).

It used to share the single-slot `ai` worker with bulk enrichment, where priority only
reorders the queue: a turn waited out a running bio («minutes») whole, and then held
the slot for a minute of mostly network waits. Now the turns run beside the bulk jobs
and the LLM is shared through `infra.llm.turn_lock`: bulk calls hold off while a turn
runs."""

from __future__ import annotations

import uuid

import procrastinate

from musix.contexts.assistant import service
from musix.workers.context import llm, ml, qdrant, sessionmaker, settings

INTERACTIVE = 10


async def turn(turn_id: str) -> str:
    return await service.run(
        sessionmaker(),
        llm(),
        await qdrant(),
        ml(),
        settings().procrastinate_conninfo,
        uuid.UUID(turn_id),
    )


async def prune(timestamp: int) -> int:
    """Turns older than a week go (their results were read long ago)."""
    import sqlalchemy as sa

    async with sessionmaker()() as s:
        n = await s.scalar(
            sa.text(
                "WITH d AS (DELETE FROM assistant_turns WHERE created_at < now() - interval '7 days'"
                " RETURNING 1) SELECT count(*) FROM d"
            )
        )
        await s.execute(
            sa.text("DELETE FROM web_pages WHERE fetched_at < now() - interval '7 days'")
        )
        await s.commit()
    return int(n or 0)


async def defer(turn_id: uuid.UUID) -> None:
    from musix.workers.app import app

    await app.configure_task("assistant:turn", priority=INTERACTIVE).defer_async(
        turn_id=str(turn_id)
    )


def register(app: procrastinate.App) -> None:
    app.task(name="assistant:turn", queue="assistant")(turn)
    p = app.task(name="assistant:prune", queue="default")(prune)
    app.periodic(cron="17 4 * * *", periodic_id="assistant_prune")(p)
