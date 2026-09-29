"""Queue tasks, on a Blueprint so every App built by make_queue_app carries them
(the CLI's module-level app and a test's app alike). Phase 0 has only `ping`,
which proves a worker consumes the queue."""

from __future__ import annotations

import procrastinate

blueprint = procrastinate.Blueprint()


@blueprint.task(name="ping", queue="default")
async def ping() -> str:
    return "pong"
