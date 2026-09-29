"""The phase 0 skeleton against real Postgres 18 + Qdrant."""

from __future__ import annotations

import asyncpg
import pytest
from fastapi.testclient import TestClient

from musix.api.app import create_app
from musix.infra.queue import make_queue_app
from musix.settings import Settings

pytestmark = pytest.mark.integration


async def test_baseline_migration(settings: Settings) -> None:
    conn = await asyncpg.connect(settings.procrastinate_conninfo)
    try:
        exts = {r["extname"] for r in await conn.fetch("select extname from pg_extension")}
        assert {"pg_trgm", "unaccent", "pg_stat_statements"} <= exts
        assert (await conn.fetchval("select uuidv7()")).version == 7
        n = await conn.fetchval(
            "select count(*) from information_schema.tables where table_name like 'procrastinate_%'"
        )
        assert n >= 4
    finally:
        await conn.close()


async def test_worker_runs_a_deferred_task(settings: Settings) -> None:
    app = make_queue_app(settings)
    async with app.open_async():
        job_id = await app.configure_task("core:ping").defer_async()
        await app.run_worker_async(queues=["default"], wait=False)
        jobs = list(await app.job_manager.list_jobs_async(id=job_id))
        assert jobs[0].status == "succeeded"


def test_ready_is_200_with_real_dependencies(settings: Settings) -> None:
    with TestClient(create_app(settings)) as client:
        r = client.get("/api/v2/ready")
    assert r.status_code == 200, r.text
    assert r.json()["checks"] == {"postgres": "ok", "qdrant": "ok"}
