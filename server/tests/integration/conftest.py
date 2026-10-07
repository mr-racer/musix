"""One Postgres 18 and one Qdrant container per test session, migrated once."""

from __future__ import annotations

import os
import shutil
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
import sqlalchemy as sa
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
            weather_latlon="",  # the tests never ask Open-Meteo: a clear sky, no network
        )
        cfg = Config(str(SERVER / "alembic.ini"))
        cfg.attributes["url"] = s.sqlalchemy_sync_url
        command.upgrade(cfg, "head")
        # The worker context builds its own Settings() from the env and the defaults, so it
        # gets pointed here too. Without this, in-process tasks reached the dev stack's
        # Postgres and Qdrant. Nobody noticed until that stack was stopped (2026-10-01).
        env = {"MUSIX_DATABASE_URL": s.database_url, "MUSIX_QDRANT_URL": s.qdrant_url,
               "MUSIX_SECRETS_DIR": s.secrets_dir, "MUSIX_MEDIA_DIR": s.media_dir,
               "MUSIX_WEATHER_LATLON": ""}
        before = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            yield s
        finally:
            for k, v in before.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


@pytest.fixture
async def sm(settings: Settings):  # type: ignore[no-untyped-def]
    from musix.infra import db

    engine = db.make_engine(settings)
    yield db.make_sessionmaker(engine)
    await engine.dispose()


@pytest.fixture(scope="session")
def client(settings: Settings) -> Iterator[TestClient]:
    from fastapi.testclient import TestClient

    from musix.api.app import create_app

    with TestClient(create_app(settings)) as c:
        yield c


DEVICE = {"name": "pytest", "platform": "android"}  # native: the web keeps its refresh in a cookie


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


AUDIO = SERVER / "tests" / "fixtures" / "audio"


async def new_listener(sm, tmp_path: Path, client: TestClient, owner: dict[str, str]):  # type: ignore[no-untyped-def]
    """A fresh member with the three fixture tracks: (tokens, account id, sorted track ids)."""
    from musix.contexts.library import ingest
    from musix.contexts.library.models import tracks

    tok = member(client, owner, f"l-{uuid.uuid4().hex[:8]}@example.com")
    for f in AUDIO.glob("tiny.*"):
        shutil.copy(f, tmp_path / f.name)
    acct = uuid.UUID(tok["accountId"])
    await ingest.scan_folder(sm, acct, tmp_path)
    async with sm() as s:
        ids = list(await s.scalars(sa.select(tracks.c.id).where(tracks.c.account_id == acct)))
    return tok, acct, sorted(ids)


@pytest.fixture
async def listener(sm, tmp_path: Path, client: TestClient, owner: dict[str, str]):  # type: ignore[no-untyped-def]
    return await new_listener(sm, tmp_path, client, owner)
