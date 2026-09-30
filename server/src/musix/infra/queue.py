"""The Procrastinate app (Postgres-backed task queue).

Procrastinate talks to Postgres through psycopg 3, not asyncpg, so it takes the
plain libpq conninfo from `Settings`. Tasks are registered per App (see
contexts/library/tasks.py for why not a shared Blueprint).
"""

from __future__ import annotations

import procrastinate

from musix.settings import Settings


def make_queue_app(settings: Settings) -> procrastinate.App:
    from musix.contexts.intel import tasks as intel
    from musix.contexts.knowledge import tasks as knowledge
    from musix.contexts.library import tasks as library
    from musix.contexts.media import tasks as media
    from musix.contexts.stream import tasks as stream
    from musix.workers import tasks as core

    app = procrastinate.App(
        connector=procrastinate.PsycopgConnector(conninfo=settings.procrastinate_conninfo)
    )
    core.register(app)
    library.register(app)
    media.register(app)
    intel.register(app)
    stream.register(app)
    knowledge.register(app)
    return app
