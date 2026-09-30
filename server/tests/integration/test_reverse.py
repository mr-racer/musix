"""The rollback's reverse export (tools/migrate/reverse.py, phase 6 §5)."""

import datetime as dt
import sqlite3
import sys
import uuid
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from musix.settings import Settings
from tests.integration.conftest import bearer, member

pytestmark = pytest.mark.integration
TOOLS = Path(__file__).resolve().parents[3] / "tools" / "migrate"
FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


async def test_reverse_export_brings_v2_activity_back_into_v1_once(  # type: ignore[no-untyped-def]
    settings: Settings, client: TestClient, owner: dict[str, str], listener, tmp_path: Path
) -> None:
    sys.path.insert(0, str(TOOLS))
    since = dt.datetime.now(dt.UTC) - dt.timedelta(seconds=1)
    # v1's copy knows the account's tracks (its track_metadata), as a migrated library does
    v1 = sqlite3.connect(tmp_path / "metadata.db")
    try:
        _run(settings, client, owner, listener, v1, since)
    finally:
        v1.close()


def _run(settings, client, owner, listener, v1, since) -> None:  # type: ignore[no-untyped-def]
    from reverse import Reverse

    tok, acct, tracks = listener
    v1.executescript((FIXTURES / "v1_schema.sql").read_text())
    v1.execute(
        "insert into users (id, email, password_hash, role, created_at)"
        " values ('0', 'seed@x', 'h', 'owner', 0)"
    )
    for t in tracks:
        v1.execute(
            "insert into track_metadata (collection_name, track_id, title, artist, file_path)"
            " values (?, ?, 'T', 'A', '/music/t')",
            (f"acct_{acct.hex}", str(t)),
        )
    v1.commit()

    # after the switch: a friend joins; the listener listens, reacts, builds a playlist
    friend = member(client, owner, f"rev-{uuid.uuid4().hex[:6]}@example.com")
    listen = {
        "clientEventId": str(uuid.uuid4()),
        "sessionId": "s",
        "trackId": str(tracks[0]),
        "startedAt": dt.datetime.now(dt.UTC).isoformat(),
        "playedMs": 61000,
        "durationMs": 62000,
        "endReason": "completed",
    }
    assert (
        client.post(
            "/api/v2/events/listens:batch", headers=bearer(tok), json={"events": [listen]}
        ).json()["accepted"]
        == 1
    )
    sig = {"kind": "fire", "clientEventId": str(uuid.uuid4()), "sessionId": "s"}
    assert (
        client.post(
            f"/api/v2/tracks/{tracks[1]}/signals", headers=bearer(tok), json=sig
        ).status_code
        == 200
    )
    pl = client.post(
        "/api/v2/playlists", headers=bearer(tok), json={"name": "После переключения"}
    ).json()
    items = {"items": [{"trackId": str(tracks[2])}, {"trackId": str(tracks[0])}]}
    assert (
        client.post(
            f"/api/v2/playlists/{pl['id']}/items", headers=bearer(tok), json=items
        ).status_code
        == 201
    )

    with psycopg.connect(settings.procrastinate_conninfo) as pg:
        first = Reverse(pg, v1, since).run(dry_run=False)
        again = Reverse(pg, v1, since).run(dry_run=False)
    assert (first["listens"], first["signals"], first["playlists_new"]) == (1, 1, 1)
    assert first["accounts"] >= 1  # the friend (and the listener: both joined within the window)
    assert v1.execute(
        "select 1 from users where id = ?", (uuid.UUID(friend["accountId"]).hex,)
    ).fetchone()
    ev = v1.execute("select collection_name, track_id, played_sec from playback_events").fetchall()
    assert ev == [(f"acct_{acct.hex}", str(tracks[0]), 61.0)]
    order = v1.execute(
        "select track_id from playlist_tracks join playlists p on p.id = playlist_id"
        " where p.name = 'После переключения' order by position"
    ).fetchall()
    assert [r[0] for r in order] == [str(tracks[2]), str(tracks[0])]
    # a second run writes nothing new (the v2_reverse_log), and replaces the playlist in place
    assert [again.get(k, 0) for k in ("listens", "signals", "playlists_new")] == [0, 0, 0]
    assert v1.execute("select count(*) from playback_events").fetchone()[0] == 1
    assert (
        v1.execute("select count(*) from playlists where name = 'После переключения'").fetchone()[0]
        == 1
    )
