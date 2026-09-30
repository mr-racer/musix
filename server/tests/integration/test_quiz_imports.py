"""The quiz serves every mode and never writes a listen; a Yandex import stores content once."""

import shutil
import uuid

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from tests.integration.conftest import AUDIO, bearer

pytestmark = pytest.mark.integration


def test_every_quiz_mode_is_served(client: TestClient, listener) -> None:  # type: ignore[no-untyped-def]
    """v1's rule for registries: an explicit import list, and a test that lists every key."""
    from musix.quiz.modes import MODES

    tok, _, _ = listener
    got = client.get("/api/v2/quiz/modes", headers=bearer(tok)).json()
    assert (
        {m["key"] for m in got}
        == set(MODES)
        == {"track_snippet", "producer", "blind_year", "lineage"}
    )


async def test_a_quiz_round_writes_no_listens_or_signals(sm, client: TestClient, listener) -> None:  # type: ignore[no-untyped-def]
    from musix.contexts.library.models import media_files, tracks

    tok, acct, (a, *_) = listener
    async with sm() as s:  # 24 more tracks: a mode needs 20 rounds' worth of material (I-5)
        src = (
            await s.execute(
                sa.select(tracks, media_files.c.path)
                .join(media_files, media_files.c.id == tracks.c.media_file_id)
                .where(tracks.c.id == a)
            )
        ).one()
        for i in range(24):
            mf = await s.scalar(
                sa.insert(media_files)
                .values(
                    sha256=uuid.uuid4().hex * 2,
                    storage="reference",
                    path=src.path,
                    size_bytes=1,
                    state="registered",
                )
                .returning(media_files.c.id)
            )
            tid = await s.scalar(
                sa.insert(tracks)
                .values(
                    account_id=acct,
                    media_file_id=mf,
                    title=f"Song {i}",
                    artist_display=f"Band {i % 6}",
                    duration_ms=180_000,
                    year=1980 + i,
                    genre="Rock",
                )
                .returning(tracks.c.id)
            )
            await s.execute(  # a past play: the modes ask about music the listener knows
                sa.text(
                    "INSERT INTO listen_events (client_event_id, account_id, session_id, track_id,"
                    " started_at, played_ms, duration_ms, end_reason, skipped_early, influence)"
                    " VALUES (:c, :a, 's', :t, now() - interval '1 day', 180000, 180000,"
                    " 'completed', false, true)"
                ),
                {"c": uuid.uuid4(), "a": acct, "t": tid},
            )
        await s.commit()
    count = sa.text(
        "SELECT (SELECT count(*) FROM listen_events WHERE account_id = :a)"
        " + (SELECT count(*) FROM taste_signals WHERE account_id = :a)"
    )
    async with sm() as s:
        before = await s.scalar(count, {"a": acct})
    h = bearer(tok)
    r = client.post("/api/v2/quiz/rounds", json={"mode": "blind_year"}, headers=h)
    assert r.status_code == 200, r.text
    rnd = r.json()
    assert all(
        "trackId" not in o and "track_id" not in o for o in rnd["options"]
    )  # the answer never travels
    audio = client.get(rnd["audioUrl"].removeprefix("http://127.0.0.1:18080"))
    assert audio.status_code == 200
    assert "filename" not in audio.headers.get("content-disposition", "")
    ans = client.post(
        f"/api/v2/quiz/rounds/{rnd['roundId']}/answer",
        json={"year": 1990},
        headers=h,
    )
    assert ans.status_code == 200
    assert (
        client.post(
            f"/api/v2/quiz/rounds/{rnd['roundId']}/answer", json={"year": 1991}, headers=h
        ).status_code
        == 409
    )
    async with sm() as s:
        assert await s.scalar(count, {"a": acct}) == before


async def test_a_yandex_track_whose_content_the_server_has_is_not_stored_twice(
    sm, tmp_path, listener
) -> None:  # type: ignore[no-untyped-def]
    from musix.contexts.imports.yandex import store
    from musix.contexts.library.models import media_files

    _, acct, _ = listener
    media = tmp_path / "media"
    first, second = tmp_path / "dl1.flac", tmp_path / "dl2.flac"
    shutil.copy(AUDIO / "tiny.flac", first)
    shutil.copy(AUDIO / "tiny.flac", second)
    a = await store(sm, media, acct, first)
    b = await store(sm, media, acct, second)
    assert a is not None
    assert a == b
    assert not second.exists()  # the duplicate download is dropped, not kept
    async with sm() as s:
        sha = await s.scalar(sa.select(media_files.c.sha256).where(media_files.c.id == a))
        assert await s.scalar(sa.select(sa.func.count()).where(media_files.c.sha256 == sha)) == 1
