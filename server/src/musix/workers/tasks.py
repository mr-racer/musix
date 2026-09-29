"""Core queue tasks. Phase 0's `ping` proves a worker consumes the queue."""

from __future__ import annotations

import procrastinate


async def ping() -> str:
    return "pong"


def register(app: procrastinate.App) -> None:
    app.task(name="core:ping", queue="default")(ping)
