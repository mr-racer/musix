"""/sync deltas, tombstones, the snapshot high-water mark, and the realtime push."""

import time
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from tests.integration.conftest import bearer

pytestmark = pytest.mark.integration
Store = dict[tuple[str, str], Any]


def pull(
    client: TestClient, tok: dict[str, str], cursor: str | None = None, limit: int = 1000
) -> tuple[list[dict[str, Any]], str]:
    """Follows hasMore to the end, as a client does."""
    changes: list[dict[str, Any]] = []
    while True:
        params: dict[str, Any] = {"limit": limit, **({"cursor": cursor} if cursor else {})}
        r = client.get("/api/v2/sync", params=params, headers=bearer(tok))
        assert r.status_code == 200, r.text
        page = r.json()
        changes += page["changes"]
        cursor = page["cursor"]
        if not page["hasMore"]:
            return changes, str(cursor)


def apply(store: Store, changes: list[dict[str, Any]]) -> Store:
    for ch in changes:
        key = (ch["entity"], ch["id"])
        if ch["op"] == "delete":
            store.pop(key, None)
        else:
            store[key] = ch["data"]
    return store


def ops(changes: list[dict[str, Any]]) -> set[tuple[str, str, str]]:
    return {(c["entity"], c["id"], c["op"]) for c in changes}


def test_delta_after_a_playlist_edit(client: TestClient, listener) -> None:  # type: ignore[no-untyped-def]
    tok, _, (a, *_) = listener
    h = bearer(tok)
    first, cursor = pull(client, tok)
    assert {c["entity"] for c in first} >= {"settings", "track", "album", "artist"}
    pl = client.post("/api/v2/playlists", json={"name": "draft"}, headers=h).json()
    item = client.post(
        f"/api/v2/playlists/{pl['id']}/items", json={"items": [{"trackId": str(a)}]}, headers=h
    ).json()[0]
    client.patch(f"/api/v2/playlists/{pl['id']}", json={"name": "final"}, headers=h)
    delta, cursor = pull(client, tok, cursor)
    assert ops(delta) == {
        ("playlist", pl["id"], "upsert"),
        ("playlistItem", item["itemId"], "upsert"),
    }
    assert next(c for c in delta if c["entity"] == "playlist")["data"]["name"] == "final"
    assert pull(client, tok, cursor)[0] == []


def test_tombstone_after_a_delete(client: TestClient, listener) -> None:  # type: ignore[no-untyped-def]
    tok, _, (a, *_) = listener
    h = bearer(tok)
    pl = client.post("/api/v2/playlists", json={"name": "gone"}, headers=h).json()
    item = client.post(
        f"/api/v2/playlists/{pl['id']}/items", json={"items": [{"trackId": str(a)}]}, headers=h
    ).json()[0]
    _, cursor = pull(client, tok)
    assert (
        client.delete(f"/api/v2/playlists/{pl['id']}/items/{item['itemId']}", headers=h).status_code
        == 204
    )
    assert client.delete(f"/api/v2/playlists/{pl['id']}", headers=h).status_code == 204
    delta, _ = pull(client, tok, cursor)
    assert ops(delta) == {
        ("playlistItem", item["itemId"], "delete"),
        ("playlist", pl["id"], "delete"),
    }
    assert all(c["data"] is None for c in delta)


def test_full_sync_during_writes_loses_nothing(client: TestClient, listener) -> None:  # type: ignore[no-untyped-def]
    tok, _, ids = listener
    h = bearer(tok)
    keep = client.post("/api/v2/playlists", json={"name": "before"}, headers=h).json()
    doomed = client.post(
        f"/api/v2/playlists/{keep['id']}/items",
        json={"items": [{"trackId": str(ids[0])}]},
        headers=h,
    ).json()[0]

    store: Store = {}
    r = client.get("/api/v2/sync", params={"limit": 2}, headers=h).json()
    apply(store, r["changes"])
    # writes land while the snapshot is still being paged
    late = client.post("/api/v2/playlists", json={"name": "during"}, headers=h).json()
    client.post(
        f"/api/v2/playlists/{late['id']}/items",
        json={"items": [{"trackId": str(t)} for t in ids]},
        headers=h,
    )
    client.delete(f"/api/v2/playlists/{keep['id']}/items/{doomed['itemId']}", headers=h)
    client.post(
        f"/api/v2/tracks/{ids[1]}/signals",
        json={"kind": "fire", "clientEventId": str(uuid.uuid4())},
        headers=h,
    )
    client.put("/api/v2/settings", json={"value": {"theme": "dark"}}, headers=h)
    rest, _ = pull(client, tok, r["cursor"], limit=2)
    apply(store, rest)

    fresh = apply({}, pull(client, tok)[0])
    assert store == fresh
    assert sum(k[0] == "track" for k in store) == len(ids)
    assert ("playlistItem", doomed["itemId"]) not in store
    assert store[("settings", tok["accountId"])]["value"] == {"theme": "dark"}


def test_ws_gets_sync_changed_after_a_signal(client: TestClient, listener) -> None:  # type: ignore[no-untyped-def]
    tok, _, (a, *_) = listener
    hub = client.app.state.hub  # type: ignore[attr-defined]
    deadline = time.monotonic() + 10
    while not hub.connected.is_set() and time.monotonic() < deadline:
        time.sleep(0.05)
    with client.websocket_connect("/api/v2/ws") as ws:
        ws.send_json({"type": "auth", "token": tok["accessToken"]})
        ready = ws.receive_json()
        assert ready["type"] == "ready"
        r = client.post(
            f"/api/v2/tracks/{a}/signals",
            json={"kind": "water", "clientEventId": str(uuid.uuid4())},
            headers=bearer(tok),
        )
        assert r.status_code == 200
        for _ in range(5):
            msg = ws.receive_json()
            if msg["type"] == "sync.changed":
                break
        assert msg["type"] == "sync.changed"
        assert msg["seq"] > ready["seq"]


def test_ws_rejects_a_socket_without_auth(client: TestClient) -> None:
    with client.websocket_connect("/api/v2/ws") as ws:
        ws.send_json({"type": "hello"})
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_json()
        assert e.value.code == 4401
