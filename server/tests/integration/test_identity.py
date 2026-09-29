"""Identity against real Postgres 18 (spec §4)."""

import datetime as dt
import uuid

import pytest
from fastapi.testclient import TestClient

from musix.contexts.identity.security import Principal, issue_access
from tests.integration.conftest import DEVICE, bearer, member

pytestmark = pytest.mark.integration


def test_refresh_rotates(client: TestClient, owner: dict[str, str]) -> None:
    r = client.post("/api/v2/auth/refresh", json={"refreshToken": owner["refreshToken"]})
    assert r.status_code == 200
    new = r.json()
    assert new["refreshToken"] != owner["refreshToken"]
    assert client.get("/api/v2/devices", headers=bearer(new)).status_code == 200
    owner.update(new)  # later tests use the fresh pair


def test_reusing_a_rotated_refresh_revokes_the_family(
    client: TestClient, owner: dict[str, str]
) -> None:
    t = client.post(
        "/api/v2/auth/login",
        json={"email": "owner@example.com", "password": "owner-pass-123", "device": DEVICE},
    ).json()
    rotated = client.post("/api/v2/auth/refresh", json={"refreshToken": t["refreshToken"]}).json()
    stolen = client.post("/api/v2/auth/refresh", json={"refreshToken": t["refreshToken"]})
    assert stolen.status_code == 401
    assert "reuse" in stolen.json()["detail"]
    # the legitimate newest token of that family is dead too
    assert (
        client.post(
            "/api/v2/auth/refresh", json={"refreshToken": rotated["refreshToken"]}
        ).status_code
        == 401
    )


def test_expired_access_is_401_problem(client: TestClient, owner: dict[str, str]) -> None:
    keys = client.app.state.secrets  # type: ignore[attr-defined]
    old = issue_access(
        keys,
        Principal(uuid.UUID(owner["accountId"]), uuid.UUID(owner["deviceId"]), "owner"),
        now=dt.datetime.now(dt.UTC) - dt.timedelta(hours=1),
    )
    r = client.get("/api/v2/devices", headers={"Authorization": f"Bearer {old}"})
    assert r.status_code == 401
    assert r.headers["content-type"] == "application/problem+json"


def test_invite_is_single_use(client: TestClient, owner: dict[str, str]) -> None:
    code = client.post("/api/v2/invites", headers=bearer(owner)).json()["code"]
    body = {"password": "member-pass-123", "inviteCode": code, "device": DEVICE}
    assert (
        client.post("/api/v2/auth/register", json={**body, "email": "a@example.com"}).status_code
        == 201
    )
    assert (
        client.post("/api/v2/auth/register", json={**body, "email": "b@example.com"}).status_code
        == 400
    )


def test_member_cannot_call_owner_routes(client: TestClient, owner: dict[str, str]) -> None:
    m = member(client, owner, "c@example.com")
    assert client.post("/api/v2/invites", headers=bearer(m)).status_code == 403


def test_deleting_a_device_revokes_its_refresh(client: TestClient, owner: dict[str, str]) -> None:
    m = member(client, owner, "d@example.com")
    assert client.delete(f"/api/v2/devices/{m['deviceId']}", headers=bearer(m)).status_code == 204
    assert (
        client.post("/api/v2/auth/refresh", json={"refreshToken": m["refreshToken"]}).status_code
        == 401
    )
