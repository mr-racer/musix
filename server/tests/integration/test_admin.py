"""The owner's admin and the web session (phase 5 §2, §1)."""

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from tests.integration.conftest import bearer

pytestmark = pytest.mark.integration

WEB = {"name": "Chrome on Linux", "platform": "web"}


async def test_admin_is_owner_only_counts_only_gates_ai_and_deletes(  # type: ignore[no-untyped-def]
    sm, client: TestClient, owner: dict[str, str], listener
) -> None:
    m, acct, track_ids = listener
    for method, path in [
        ("get", "/api/v2/admin/members"),
        ("get", "/api/v2/admin/ops"),
        ("put", "/api/v2/admin/instance"),
        ("patch", f"/api/v2/admin/members/{m['accountId']}"),
        ("post", "/api/v2/admin/renditions/backfill"),
    ]:
        r = client.request(method, path, headers=bearer(m), json={})
        assert r.status_code == 403, (path, r.status_code)
    rows = client.get("/api/v2/admin/members", headers=bearer(owner)).json()
    mine = next(r for r in rows if r["id"] == m["accountId"])
    # aggregate numbers about another account, never its titles or files
    assert set(mine) == {
        "id", "email", "role", "displayName", "indexRoot", "premium", "inviteCode",
        "createdAt", "lastLoginAt", "tracks", "listens", "likes", "devices",
    }  # fmt: skip
    # the AI policy: off → members cannot start turns, the owner still can
    cfg = {"name": "MusiX", "registration": "invite", "aiForMembers": False}
    assert client.put("/api/v2/admin/instance", headers=bearer(owner), json=cfg).status_code == 200
    turn = {"message": "hi", "lang": "ru"}
    assert client.post("/api/v2/assistant/turns", headers=bearer(m), json=turn).status_code == 403
    assert client.get("/api/v2/instance").json()["aiForMembers"] is False
    cfg["aiForMembers"] = True
    client.put("/api/v2/admin/instance", headers=bearer(owner), json=cfg)
    assert mine["tracks"] == len(track_ids) == 3
    # v1's delete: the typed email must match; the owner can never be deleted
    gone = f"/api/v2/admin/members/{acct}"
    bad = client.request("delete", gone, headers=bearer(owner), json={"confirmEmail": "x@y.z"})
    assert bad.status_code == 400
    me = f"/api/v2/admin/members/{owner['accountId']}"
    confirm = {"confirmEmail": "owner@example.com"}
    assert client.request("delete", me, headers=bearer(owner), json=confirm).status_code == 403
    confirm = {"confirmEmail": mine["email"]}
    assert client.request("delete", gone, headers=bearer(owner), json=confirm).status_code == 204
    async with sm() as s:
        left = await s.scalar(
            sa.text(
                "select (select count(*) from tracks where account_id = :a)"
                " + (select count(*) from devices where account_id = :a)"
                " + (select count(*) from accounts where id = :a)"
            ),
            {"a": acct},
        )
        reown = await s.scalar(
            sa.text("select count(*) from procrastinate_jobs where task_name = 'intel:reown'")
        )
    assert left == 0
    assert reown >= 1  # the vector payloads drop the account after the commit
    # its session ends: the refresh is gone (the ≤15 min access JWT expires on its own)
    dead = client.post("/api/v2/auth/refresh", json={"refreshToken": m["refreshToken"]})
    assert dead.status_code == 401


def test_web_refresh_lives_in_an_httponly_cookie_and_reuse_revokes(client: TestClient) -> None:
    creds = {"email": "owner@example.com", "password": "owner-pass-123", "device": WEB}
    r = client.post("/api/v2/auth/login", json=creds)
    assert r.status_code == 200
    assert r.json()["refreshToken"] is None  # never readable by page script
    set_cookie = r.headers["set-cookie"]
    for attr in ("HttpOnly", "Secure", "SameSite=strict", "Path=/api/v2/auth"):
        assert attr.lower() in set_cookie.lower(), attr
    first = r.cookies["mx_rt"]

    def refresh(token: str):  # type: ignore[no-untyped-def]
        return client.post("/api/v2/auth/refresh", headers={"Cookie": f"mx_rt={token}"})

    ok = refresh(first)
    assert ok.status_code == 200
    assert ok.json()["accessToken"]
    second = ok.cookies["mx_rt"]
    assert second != first
    stolen = refresh(first)  # a replayed cookie = theft: the family dies, the cookie is dropped
    assert stolen.status_code == 401
    assert (
        'mx_rt=""' in stolen.headers["set-cookie"]
        or "max-age=0" in stolen.headers["set-cookie"].lower()
    )
    assert refresh(second).status_code == 401
