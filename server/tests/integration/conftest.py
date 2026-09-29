"""One Postgres 18 and one Qdrant container per test session, migrated once."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from testcontainers.community.postgres import PostgresContainer
from testcontainers.community.qdrant import QdrantContainer

from musix.settings import Settings

SERVER = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def settings() -> Iterator[Settings]:
    pg = PostgresContainer(
        "postgres:18", username="musix", password="musix", dbname="musix", driver=None
    ).with_command("postgres -c shared_preload_libraries=pg_stat_statements")
    qd = QdrantContainer("qdrant/qdrant:v1.18.2")
    with pg, qd:
        s = Settings(
            _env_file=None,
            database_url=pg.get_connection_url(),  # type: ignore[call-arg]
            qdrant_url=f"http://{qd.rest_host_address}",
        )
        cfg = Config(str(SERVER / "alembic.ini"))
        cfg.attributes["url"] = s.sqlalchemy_sync_url
        command.upgrade(cfg, "head")
        yield s
