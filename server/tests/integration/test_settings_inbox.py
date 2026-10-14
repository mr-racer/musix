"""The settings page and the library's inbox (design/reference/settings, 2026-10-14): one
status per uploaded song, the account card, a password change, the data export, incognito."""

import datetime as dt
import hashlib
import io
import uuid
import zipfile
from pathlib import Path

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from musix.contexts.library import ingest
from musix.contexts.library.models import media_files, songs, tracks
from musix.settings import Settings
from tests.integration.conftest import DEVICE, bearer, member
from tests.integration.test_listening import event

pytestmark = pytest.mark.integration
AUDIO = Path(__file__).resolve().parents[1] / "fixtures" / "audio"


def _stage(client: TestClient, tok: dict[str, str], up: str) -> dict[str, object]:
    r = client.get("/api/v2/uploads", params={"ids": up}, headers=bearer(tok))
    assert r.status_code == 200, r.text
    return dict(r.json()[0])


async def test_an_upload_walks_one_stage_at_a_time(
    sm,
    settings: Settings,
    client: TestClient,
    owner: dict[str, str],  # type: ignore[no-untyped-def]
) -> None:
    tok = member(client, owner, f"inbox-{uuid.uuid4().hex[:8]}@example.com")
    data = (AUDIO / "tiny.mp3").read_bytes() + uuid.uuid4().bytes  # unique content
    body = {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "filename": "t.mp3"}
    up = client.post("/api/v2/uploads", headers=bearer(tok), json=body).json()["id"]
    assert _stage(client, tok, up)["stage"] == "send"
    client.patch(
        f"/api/v2/uploads/{up}", headers={**bearer(tok), "Upload-Offset": "0"}, content=data
    )
    assert _stage(client, tok, up)["stage"] == "sound"  # verifying: tags not read yet
    track = await ingest.finalize_upload(sm, Path(settings.media_dir), uuid.UUID(up))
    st = _stage(client, tok, up)
    assert (st["stage"], st["trackId"]) == ("sound", str(track))  # the sound is not processed
    async with sm() as s:
        mf, song = (
            await s.execute(
                sa.select(tracks.c.media_file_id, tracks.c.song_id).where(tracks.c.id == track)
            )
        ).one()
        await s.execute(
            sa.update(media_files)
            .where(media_files.c.id == mf)
            .values(state="media_done", intel_state="indexed")
        )
        await s.commit()
    assert _stage(client, tok, up)["stage"] == "facts"  # playable, facts on their way
    async with sm() as s:
        await s.execute(
            sa.update(songs).where(songs.c.id == song).values(knowledge_at=sa.func.now())
        )
        await s.commit()
    assert _stage(client, tok, up)["stage"] == "done"
    # the same content again: already here, nothing is sent and the track is named
    again = client.post("/api/v2/uploads", headers=bearer(tok), json=body).json()
    assert (again["exists"], again["trackId"], again["id"]) == (True, str(track), None)


def test_password_change_signs_out_the_other_devices(
    client: TestClient, owner: dict[str, str]
) -> None:
    email = f"pw-{uuid.uuid4().hex[:8]}@example.com"
    here = member(client, owner, email)
    there = client.post(
        "/api/v2/auth/login", json={"email": email, "password": "member-pass-123", "device": DEVICE}
    ).json()
    me = client.get("/api/v2/me", headers=bearer(here)).json()
    assert (me["email"], me["role"]) == (email, "member")
    bad = client.post(
        "/api/v2/auth/password",
        headers=bearer(here),
        json={"current": "nope", "new": "new-pass-456"},
    )
    assert bad.status_code == 403
    ok = client.post(
        "/api/v2/auth/password",
        headers=bearer(here),
        json={"current": "member-pass-123", "new": "new-pass-456"},
    )
    assert ok.status_code == 204
    devices = client.get("/api/v2/devices", headers=bearer(here)).json()
    assert [d["id"] for d in devices] == [here["deviceId"]]
    gone = client.post("/api/v2/auth/refresh", json={"refreshToken": there["refreshToken"]})
    assert gone.status_code == 401
    assert (
        client.post(
            "/api/v2/auth/login",
            json={"email": email, "password": "new-pass-456", "device": DEVICE},
        ).status_code
        == 200
    )


async def test_incognito_listens_stay_out_and_the_export_has_the_rest(
    sm,
    client: TestClient,
    listener,  # type: ignore[no-untyped-def]
) -> None:
    tok, _, ids = listener
    h = bearer(tok)
    t0 = dt.datetime(2026, 10, 14, 12, tzinfo=dt.UTC)
    window = {"from": t0.isoformat(), "until": (t0 + dt.timedelta(hours=6)).isoformat()}
    assert (
        client.put(
            "/api/v2/settings", headers=h, json={"value": {"privacy": {"incognito": window}}}
        ).status_code
        == 200
    )
    inside = event(ids[0], startedAt=(t0 + dt.timedelta(hours=1)).isoformat())
    outside = event(ids[1], startedAt=(t0 - dt.timedelta(hours=1)).isoformat())
    r = client.post(
        "/api/v2/events/listens:batch", headers=h, json={"events": [inside, outside]}
    ).json()
    assert (r["accepted"], r["duplicates"]) == (1, 1)
    z = zipfile.ZipFile(io.BytesIO(client.get("/api/v2/me/export", headers=h).content))
    assert {"library.csv", "history.csv"} <= set(z.namelist())
    history = z.read("history.csv").decode("utf-8-sig").splitlines()
    assert len(history) == 2  # the header and the one listen outside the window
    assert len(z.read("library.csv").decode("utf-8-sig").splitlines()) == 1 + len(ids)
