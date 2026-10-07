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


async def test_idempotency_never_stores_auth_responses(sm, client: TestClient, listener) -> None:  # type: ignore[no-untyped-def]
    import sqlalchemy as sa

    from musix.api.idempotency import idempotency_keys

    tok, acct, _ = listener
    key = str(uuid.uuid4())
    r = client.post(
        "/api/v2/auth/refresh",
        json={"refreshToken": tok["refreshToken"]},
        headers={**bearer(tok), "Idempotency-Key": key},
    )
    assert r.status_code == 200
    async with sm() as s:  # raw tokens must never sit in the replay store
        n = await s.scalar(
            sa.select(sa.func.count()).where(
                idempotency_keys.c.account_id == acct, idempotency_keys.c.key == key
            )
        )
    assert n == 0


async def test_search_finds_only_the_accounts_own_tracks(
    sm, tmp_path: Path, client: TestClient, listener, owner
) -> None:  # type: ignore[no-untyped-def]
    tok, _, mine = listener
    (tmp_path / "b").mkdir()
    b, *_ = await new_listener(sm, tmp_path / "b", client, owner)  # the same titles, other tracks
    title = client.get(f"/api/v2/tracks?ids={mine[0]}", headers=bearer(tok)).json()[0]["title"]
    got = client.get(
        "/api/v2/search", params={"q": title, "sections": "catalog"}, headers=bearer(b)
    ).json()
    songs = [h["id"] for h in got["top"] if h["type"] == "song"]
    assert songs  # B finds its own copy of the song...
    assert not set(songs) & {str(t) for t in mine}  # ...never A's
    assert got["degraded"] == []


def test_stats_and_the_weekly_pulse_count_local_days(client: TestClient, listener) -> None:  # type: ignore[no-untyped-def]
    import datetime as dt

    tok, _, (a, *_) = listener
    h = bearer(tok)
    dur = next(
        t
        for t in client.get("/api/v2/home", headers=h).json()["recentlyAdded"]
        if t["id"] == str(a)
    )["durationMs"]
    now = dt.datetime.now(dt.UTC)
    evs = [
        {
            "clientEventId": str(uuid.uuid4()),
            "sessionId": "s",
            "trackId": str(a),
            "startedAt": (now - dt.timedelta(minutes=m)).isoformat(),
            "playedMs": dur,
            "durationMs": dur,
            "endReason": "completed",
        }
        for m in (2, 1)
    ]
    assert (
        client.post("/api/v2/events/listens:batch", json={"events": evs}, headers=h).status_code
        < 300
    )
    q = {"tzOffsetMinutes": 180}
    st = client.get("/api/v2/stats", params=q, headers=h).json()
    assert st["listening"]["topTrack"]["track"]["id"] == str(a)
    assert st["listening"]["topTrack"]["plays"] == 2
    assert [d["count"] for d in st["rhythm"]["days"]] == [2]
    assert st["rhythm"]["streakCurrent"] == st["rhythm"]["streakBest"] == 1
    assert [t["track"]["id"] for t in st["engagement"]["loved"]] == [str(a)]
    pulse = client.get("/api/v2/home", params=q, headers=h).json()["pulse"]
    assert pulse["playedMs"] == sum(pulse["dailyMs"]) == 2 * dur
    assert pulse["discoveries"] == 1
    # the web's home: the last seven local days, today last, and the streak of /stats
    assert len(pulse["last7Ms"]) == 7
    assert pulse["last7Ms"][-1] == pulse["last7PlayedMs"] == 2 * dur
    assert pulse["streakCurrent"] == 1
    assert client.get("/api/v2/stats/map", headers=h).json()["trackIds"] == []
