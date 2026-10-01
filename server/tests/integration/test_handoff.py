"""Playback handoff (phase 8 §1) over real sockets: two or three devices of one account."""

from __future__ import annotations

import time
import uuid
from typing import TYPE_CHECKING, Any

from tests.integration.conftest import DEVICE, bearer, member

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def _devices(client: TestClient, owner: dict[str, str], n: int) -> list[dict[str, str]]:
    """One account signed in on `n` devices (each login is a device)."""
    email = f"h-{uuid.uuid4().hex[:8]}@example.com"
    first = member(client, owner, email)
    more = [
        client.post(
            "/api/v2/auth/login",
            json={"email": email, "password": "member-pass-123", "device": DEVICE},
        ).json()
        for _ in range(n - 1)
    ]
    return [first, *more]


def _until(ws: Any, kind: str, limit: int = 20) -> dict[str, Any]:
    for _ in range(limit):
        msg = ws.receive_json()
        if msg["type"] == kind:
            return dict(msg)
    raise AssertionError(f"no {kind}")


def _online(client: TestClient, tok: dict[str, str], devices: list[str]) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        on = {
            d["id"]
            for d in client.get("/api/v2/devices/active", headers=bearer(tok)).json()
            if d["canPlay"]
        }
        if set(devices) <= on:
            return
        time.sleep(0.05)
    raise AssertionError("devices never came online")


def _connect(ws: Any, tok: dict[str, str]) -> None:
    ws.send_json({"type": "auth", "token": tok["accessToken"]})
    _until(ws, "ready")
    ws.send_json({"type": "device.hello", "canPlay": True})


STATE = {
    "trackIds": [str(uuid.uuid4()), str(uuid.uuid4())],
    "index": 1,
    "positionMs": 61_000,
    "playing": True,
}


def test_transfer_hands_the_music_to_the_target_and_the_old_player_lets_go(
    client: TestClient, owner: dict[str, str]
) -> None:
    a, b = _devices(client, owner, 2)
    with client.websocket_connect("/api/v2/ws") as wa, client.websocket_connect("/api/v2/ws") as wb:
        _connect(wa, a)
        _connect(wb, b)
        _online(client, a, [a["deviceId"], b["deviceId"]])
        wa.send_json({"type": "playback.state", "state": STATE})  # A is the active player
        assert _until(wb, "playback.state")["positionMs"] == 61_000

        r = client.post(
            "/api/v2/playback/transfer", json={"toDevice": b["deviceId"]}, headers=bearer(a)
        )
        assert r.status_code == 202, r.text
        assert _until(wb, "playback.take")["by"] == a["deviceId"]
        assert _until(wa, "playback.release")["to"] == b["deviceId"]
        s = client.get("/api/v2/playback/session", headers=bearer(b)).json()
        assert (s["deviceId"], s["state"]["index"], s["state"]["positionMs"]) == (
            a["deviceId"],
            1,
            61_000,
        )


def test_a_command_reaches_only_the_device_it_is_for(
    client: TestClient, owner: dict[str, str]
) -> None:
    a, b, c = _devices(client, owner, 3)
    with (
        client.websocket_connect("/api/v2/ws") as wa,
        client.websocket_connect("/api/v2/ws") as wb,
        client.websocket_connect("/api/v2/ws") as wc,
    ):
        for ws, tok in ((wa, a), (wb, b), (wc, c)):
            _connect(ws, tok)
        _online(client, a, [a["deviceId"], b["deviceId"], c["deviceId"]])
        wa.send_json(
            {
                "type": "playback.command",
                "target": b["deviceId"],
                "command": "seek",
                "positionMs": 5000,
            }
        )
        got = _until(wb, "playback.command")
        assert (got["command"], got["positionMs"], got["by"]) == ("seek", 5000, a["deviceId"])
        wa.send_json({"type": "playback.state", "state": STATE})  # a broadcast C does get
        while (msg := wc.receive_json())["type"] not in ("playback.command", "playback.state"):
            pass
        assert msg["type"] == "playback.state"  # the command never came to C
