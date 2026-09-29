"""Library registration: scan by reference, dedup across accounts, resumable uploads."""

import hashlib
import shutil
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from musix.contexts.library import artist_split, ingest
from musix.contexts.library.models import media_files, tracks, uploads
from musix.infra import db
from musix.settings import Settings
from tests.integration.conftest import bearer, member

pytestmark = pytest.mark.integration
AUDIO = Path(__file__).resolve().parents[1] / "fixtures" / "audio"


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        ("Jay-Z feat. Kanye West", ["Jay-Z", "Kanye West"]),
        ("Earth, Wind & Fire", ["Earth, Wind & Fire"]),
        ("Florence + the Machine", ["Florence + the Machine"]),
        ("AC/DC", ["AC/DC"]),
        ("Charli XCX", ["Charli XCX"]),
        ("A, B & C", ["A", "B", "C"]),
    ],
)
def test_artist_split_keeps_v1_rules(raw: str, want: list[str]) -> None:
    assert artist_split.split_artists(raw) == want


@pytest.fixture
async def sm(settings: Settings):  # type: ignore[no-untyped-def]
    engine = db.make_engine(settings)
    yield db.make_sessionmaker(engine)
    await engine.dispose()


async def test_scan_skips_unchanged_files(sm, tmp_path: Path, owner: dict[str, str]) -> None:  # type: ignore[no-untyped-def]
    for f in AUDIO.glob("tiny.*"):
        shutil.copy(f, tmp_path / f.name)
    acct = uuid.UUID(owner["accountId"])
    first = await ingest.scan_folder(sm, acct, tmp_path)
    assert first["ingested"] == 3
    again = await ingest.scan_folder(sm, acct, tmp_path)
    assert again == {"files": 3, "ingested": 0, "unchanged": 3, "failed": 0}


async def test_same_file_in_two_accounts_is_one_media_file(
    sm,
    tmp_path: Path,
    client: TestClient,  # type: ignore[no-untyped-def]
    owner: dict[str, str],
) -> None:
    f = tmp_path / "shared.flac"
    shutil.copy(AUDIO / "tiny.flac", f)
    other = member(client, owner, "shared@example.com")
    a, b = uuid.UUID(owner["accountId"]), uuid.UUID(other["accountId"])
    await ingest.ingest_file(sm, a, f)
    await ingest.ingest_file(sm, b, f)
    sha = ingest.sha256_file(f)
    async with sm() as s:
        mf = (await s.scalars(sa.select(media_files.c.id).where(media_files.c.sha256 == sha))).all()
        owners = (
            await s.scalars(sa.select(tracks.c.account_id).where(tracks.c.media_file_id == mf[0]))
        ).all()
    assert len(mf) == 1
    assert set(owners) == {a, b}


def test_upload_resumes_at_the_server_offset(client: TestClient, owner: dict[str, str]) -> None:
    data = (AUDIO / "tiny.mp3").read_bytes() + b"x"  # a unique sha: not already on the server
    body = {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "filename": "t.mp3"}
    up = client.post("/api/v2/uploads", headers=bearer(owner), json=body).json()
    h = {**bearer(owner), "Upload-Offset": "0"}
    assert (
        client.patch(f"/api/v2/uploads/{up['id']}", headers=h, content=data[:100]).json()["offset"]
        == 100
    )
    wrong = client.patch(f"/api/v2/uploads/{up['id']}", headers=h, content=data[100:])
    assert wrong.status_code == 409
    assert wrong.json()["offset"] == 100
    done = client.patch(
        f"/api/v2/uploads/{up['id']}",
        headers={**bearer(owner), "Upload-Offset": "100"},
        content=data[100:],
    ).json()
    assert done["state"] == "verifying"


async def test_bad_sha_fails_and_keeps_the_part(
    sm,
    settings: Settings,
    client: TestClient,  # type: ignore[no-untyped-def]
    owner: dict[str, str],
) -> None:
    data = (AUDIO / "tiny.m4a").read_bytes()
    body = {"sha256": "0" * 64, "size": len(data), "filename": "t.m4a"}
    up = client.post("/api/v2/uploads", headers=bearer(owner), json=body).json()
    client.patch(
        f"/api/v2/uploads/{up['id']}", headers={**bearer(owner), "Upload-Offset": "0"}, content=data
    )
    assert await ingest.finalize_upload(sm, Path(settings.media_dir), uuid.UUID(up["id"])) is None
    async with sm() as s:
        state = await s.scalar(
            sa.select(uploads.c.state).where(uploads.c.id == uuid.UUID(up["id"]))
        )
    assert state == "failed"
    assert (Path(settings.media_dir) / "uploads" / f"{up['id']}.part").exists()
