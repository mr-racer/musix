"""The Procrastinate app (Postgres-backed task queue).

Procrastinate talks to Postgres through psycopg 3, not asyncpg, so it takes the
plain libpq conninfo from `Settings`.
"""

from __future__ import annotations

import procrastinate

from musix.settings import Settings


def make_queue_app(settings: Settings) -> procrastinate.App:
    from musix.workers.tasks import blueprint

    app = procrastinate.App(
        connector=procrastinate.PsycopgConnector(conninfo=settings.procrastinate_conninfo)
    )
    app.add_tasks_from(blueprint, namespace="core")
    return app
