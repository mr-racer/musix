"""One Postgres 18 and one Qdrant container per test session, migrated once."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from alembic import command
from alembic.config import Config
from testcontainers.community.postgres import PostgresContainer
from testcontainers.community.qdrant import QdrantContainer

from musix.settings import Settings

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

SERVER = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def settings(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Settings]:
    pg = PostgresContainer(
        "postgres:18", username="musix", password="musix", dbname="musix", driver=None
    ).with_command("postgres -c shared_preload_libraries=pg_stat_statements")
    qd = QdrantContainer("qdrant/qdrant:v1.18.2")
    with pg, qd:
        s = Settings(
            _env_file=None,
            database_url=pg.get_connection_url(),  # type: ignore[call-arg]
            qdrant_url=f"http://{qd.rest_host_address}",
            secrets_dir=str(tmp_path_factory.mktemp("secrets")),
            media_dir=str(tmp_path_factory.mktemp("media")),
        )
        cfg = Config(str(SERVER / "alembic.ini"))
        cfg.attributes["url"] = s.sqlalchemy_sync_url
        command.upgrade(cfg, "head")
        yield s


@pytest.fixture(scope="session")
def client(settings: Settings) -> Iterator[TestClient]:
    from fastapi.testclient import TestClient

    from musix.api.app import create_app

    with TestClient(create_app(settings)) as c:
        yield c


DEVICE = {"name": "pytest", "platform": "web"}


@pytest.fixture(scope="session")
def owner(client: TestClient) -> dict[str, str]:
    """The instance owner (set up once per test session)."""
    r = client.post(
        "/api/v2/auth/setup",
        json={
            "email": "owner@example.com",
            "password": "owner-pass-123",
            "mode": "shared",
            "device": DEVICE,
        },
    )
    assert r.status_code == 201, r.text
    return dict(r.json())


def bearer(tokens: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['accessToken']}"}


def member(client: TestClient, owner: dict[str, str], email: str) -> dict[str, str]:
    code = client.post("/api/v2/invites", headers=bearer(owner)).json()["code"]
    r = client.post(
        "/api/v2/auth/register",
        json={"email": email, "password": "member-pass-123", "inviteCode": code, "device": DEVICE},
    )
    assert r.status_code == 201, r.text
    return dict(r.json())
