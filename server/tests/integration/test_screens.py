"""Screen shapes: ETag/304, account isolation; Idempotency-Key replays."""

import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.integration.conftest import bearer, new_listener

pytestmark = pytest.mark.integration


def test_if_none_match_gives_304_until_something_changes(client: TestClient, listener) -> None:  # type: ignore[no-untyped-def]
    tok, _, (a, *_) = listener
    h = bearer(tok)
    first = client.get("/api/v2/home", headers=h)
    assert first.status_code == 200
    assert len(first.json()["recentlyAdded"]) == 3
    tag = first.headers["etag"]
    again = client.get("/api/v2/home", headers={**h, "If-None-Match": tag})
    assert again.status_code == 304
    assert again.content == b""
    ev = {
        "clientEventId": str(uuid.uuid4()),
        "sessionId": "s",
        "trackId": str(a),
        "startedAt": "2026-09-30T10:00:00Z",
        "playedMs": 1000,
        "endReason": "stopped",
    }
    client.post("/api/v2/events/listens:batch", json={"events": [ev]}, headers=h)
    after = client.get("/api/v2/home", headers={**h, "If-None-Match": tag})
    assert after.status_code == 200  # a listen reorders «recent», though it is not change-logged
    assert after.json()["recent"][0]["id"] == str(a)


async def test_another_accounts_track_is_never_returned(
    sm, tmp_path: Path, client: TestClient, listener, owner
) -> None:  # type: ignore[no-untyped-def]
    tok, _, mine = listener
    (tmp_path / "b").mkdir()
    b, *_ = await new_listener(sm, tmp_path / "b", client, owner)
    theirs = client.get("/api/v2/home", headers=bearer(b)).json()["recentlyAdded"]
    other = next(t for t in theirs if t["albumId"])  # the same files, so the same shared album
    h = bearer(tok)
    page = client.get(f"/api/v2/albums/{other['albumId']}", headers=h)
    assert page.status_code == 200
    assert {t["id"] for t in page.json()["tracks"]} <= {str(t) for t in mine}
    assert client.get(f"/api/v2/player/context/{other['id']}", headers=h).status_code == 404
    assert client.get(f"/api/v2/tracks?ids={other['id']}", headers=h).json() == []
    ctx = client.get(f"/api/v2/player/context/{mine[0]}", headers=h)
    assert ctx.status_code == 200
    assert ctx.json()["track"]["id"] == str(mine[0])


def test_idempotency_key_replays_the_first_response(client: TestClient, listener) -> None:  # type: ignore[no-untyped-def]
    tok, *_ = listener
    h = {**bearer(tok), "Idempotency-Key": str(uuid.uuid4())}
    one = client.post("/api/v2/playlists", json={"name": "once"}, headers=h)
    two = client.post("/api/v2/playlists", json={"name": "once"}, headers=h)
    assert (one.status_code, two.status_code) == (201, 201)
    assert two.json() == one.json()
    assert two.headers["idempotent-replayed"] == "true"
    names = [p["name"] for p in client.get("/api/v2/playlists", headers=bearer(tok)).json()]
    assert names.count("once") == 1
    assert client.post("/api/v2/playlists", json={"name": "other"}, headers=h).status_code == 422
