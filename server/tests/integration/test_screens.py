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
    # the redesigned tab (2026-10-11): the top three, the facts and the ten achievements
    ex = st["extra"]
    assert [t["track"]["id"] for t in ex["tracks"]] == [str(a)] and ex["tracks"][0]["plays"] == 2
    assert ex["finishedPct"] == 100 and ex["avgDayMs"] == 2 * dur
    assert len(ex["achievements"]) == 10 and all(x["earnedOn"] is None for x in ex["achievements"])
    rep = next(x for x in ex["achievements"] if x["code"] == "repeat")
    assert rep["value"] == 2 and rep["target"] == 5
    summ = client.get("/api/v2/library/summary", headers=h).json()
    assert summ["dayPick"] is None and summ["albumLast"]  # played twice: no pick yet, a last listen


async def test_artist_page_knows_you_the_grammys_and_the_stream(
    sm, client: TestClient, listener
) -> None:  # type: ignore[no-untyped-def]
    import sqlalchemy as sa
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from musix.contexts.knowledge.models import artist_bios
    from musix.contexts.library.models import tracks

    tok, _, (a, *_) = listener
    h = bearer(tok)
    async with sm() as s:
        artist = await s.scalar(sa.select(tracks.c.primary_artist_id).where(tracks.c.id == a))
        row = {
            "artist_id": artist,
            "lang": "ru",
            "text": "Биография.",
            "facets": {"grammy_wins": 3, "grammy_nominations": 7},
            "sources": {},
        }
        await s.execute(  # the session's database is shared: another test may have a bio here
            pg_insert(artist_bios)
            .values(**row)
            .on_conflict_do_update(index_elements=["artist_id", "lang"], set_=row)
        )
        await s.commit()
    ev = {
        "clientEventId": str(uuid.uuid4()),
        "sessionId": "s",
        "trackId": str(a),
        "startedAt": "2026-09-30T10:00:00Z",
        "playedMs": 180_000,
        "endReason": "ended",
    }
    client.post("/api/v2/events/listens:batch", json={"events": [ev]}, headers=h)
    page = client.get(f"/api/v2/artists/{artist}/page", headers=h).json()
    you = page["you"]
    assert you["artists"] >= 1
    assert you["heardTracks"] <= page["trackCount"]
    g = page["grammy"]
    assert (g["wins"], g["nominations"]) == (3, 7)
    assert 1 <= g["position"] <= g["laureates"]
    assert all(int(v) >= 0 for v in page["heard"].values())
    stream = client.post("/api/v2/stream/artist", json={"artistId": str(artist)}, headers=h)
    assert stream.status_code == 200
    mine = {t["id"] for t in stream.json()["tracks"]}
    assert mine
    assert all(any(x["id"] == str(artist) for x in t["artists"]) for t in stream.json()["tracks"])
    quiz = client.post(
        "/api/v2/quiz/rounds", json={"mode": "artist_snippet", "artistId": str(artist)}, headers=h
    )
    assert quiz.status_code in (200, 409)  # four songs of the artist make a round; fewer → 409


async def test_editorial_image_kinds_pass_the_kind_check(sm) -> None:  # type: ignore[no-untyped-def]
    """The Apple Music images are rows of their own kinds; the first prod fetches failed on images'
    kind check (2026-10-17). (The host has no libvips, so store_image itself is not run here.)"""
    import sqlalchemy as sa

    from musix.contexts.library.models import images

    async with sm() as s:
        for k in ("artist_photo", "artist_wide", "artist_logo"):
            await s.execute(sa.insert(images).values(id=f"{k:0<64}"[:64], kind=k, variants={}))
        await s.rollback()
