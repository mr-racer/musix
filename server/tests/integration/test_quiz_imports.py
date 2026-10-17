"""The quiz serves every mode and never writes a listen; a Yandex import stores content once."""

import shutil
import uuid
from pathlib import Path

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
        == {"track_snippet", "producer", "blind_year", "lineage", "artist_snippet"}
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
    a, _ = await store(sm, media, acct, first)
    b, _ = await store(sm, media, acct, second)
    assert a is not None
    assert a == b
    assert not second.exists()  # the duplicate download is dropped, not kept
    async with sm() as s:
        sha = await s.scalar(sa.select(media_files.c.sha256).where(media_files.c.id == a))
        assert await s.scalar(sa.select(sa.func.count()).where(media_files.c.sha256 == sha)) == 1


def _tagged(dst: Path, title: str, artist: str) -> Path:
    """tiny.flac with its own tags: its own content, as each Yandex download is."""
    from mutagen.flac import FLAC

    shutil.copy(AUDIO / "tiny.flac", dst)
    f = FLAC(dst)
    f["title"], f["artist"] = title, artist
    f.save()
    return dst


async def test_a_yandex_import_tops_up_and_mirrors_the_playlist(
    sm, tmp_path, listener, monkeypatch
) -> None:  # type: ignore[no-untyped-def]
    """Whole source = a top-up: new and network-failed tracks are fetched, refused ones are
    not, and a track the network drops again is retried in the same run until it comes (one
    press brings everything); a v1 import with no file id is recognised by its song; the
    MusiX playlist follows the Yandex order, and a track removed from it is not put back."""
    from types import SimpleNamespace

    from musix.contexts.imports import yandex
    from musix.contexts.imports.models import yandex_imports
    from musix.contexts.library.models import tracks
    from musix.contexts.playlists.models import playlist_items, playlists
    from musix.yandex import downloader
    from musix.yandex import playlists as ym

    _, acct, _ = listener
    song = lambda n: SimpleNamespace(  # noqa: E731
        id=n, title=f"Song {n}", artists=[SimpleNamespace(name="Band")]
    )
    src = [song(n) for n in (1, 2, 3, 4)]
    fetched: list[int] = []

    async def client(*_a):  # type: ignore[no-untyped-def]
        return object()

    def download(t, tmp, throttle=None):  # type: ignore[no-untyped-def]
        fetched.append(t.id)
        if t.id == 4 and fetched.count(4) <= 2:  # both tries of the first pass
            return {"ok": False, "reason": "download failed: Timed out"}
        tmp.mkdir(parents=True, exist_ok=True)
        return {"ok": True, "path": str(_tagged(tmp / f"{t.id}.flac", t.title, "Band"))}

    monkeypatch.setattr(yandex, "_client", client)
    monkeypatch.setattr(ym, "resolve_source", lambda c, s: ("Мне нравится", list(src)))
    monkeypatch.setattr(downloader, "download_track", download)
    for name in ("RETRY_IN", "STREAK_PAUSE"):
        monkeypatch.setattr(yandex, name, 0.0)
    monkeypatch.setattr(yandex, "PASSES", (0.0, 0.0, 0.0))
    # «1» came in through v1 (no file id); «3» Yandex refused; «4» timed out last time
    await yandex.store(
        sm, tmp_path / "media", acct, _tagged(tmp_path / "v1.flac", "Song 1", "Band")
    )
    async with sm() as s:
        await s.execute(
            sa.insert(yandex_imports).values(
                [
                    {"account_id": acct, "yandex_track_id": "1", "status": "downloaded"},
                    {
                        "account_id": acct,
                        "yandex_track_id": "3",
                        "status": "unavailable",
                        "reason": "track not available in catalog/region",
                    },
                    {
                        "account_id": acct,
                        "yandex_track_id": "4",
                        "status": "failed",
                        "reason": "download failed: Timed out",
                    },
                ]
            )
        )
        await s.commit()

    async def run():  # type: ignore[no-untyped-def]
        return await yandex.run_import(sm, None, tmp_path / "media", acct, "yandex:t", ["likes"])  # type: ignore[arg-type]

    async def order() -> list[str]:
        async with sm() as s:
            return list(
                await s.scalars(
                    sa.select(tracks.c.title)
                    .join(playlist_items, playlist_items.c.track_id == tracks.c.id)
                    .where(
                        playlist_items.c.playlist_id == pid, playlist_items.c.deleted_at.is_(None)
                    )
                    .order_by(playlist_items.c.position)
                )
            )

    got = await run()
    assert fetched == [2, 4, 4, 4]  # «1» is here, «3» refused; «4» came in the second pass
    assert got["downloaded"] == 2
    assert got["skipped"] == []
    assert len(got["playlists"]) == 1
    pid = uuid.UUID(got["playlists"][0]["playlist_id"])
    async with sm() as s:
        pl = (await s.execute(sa.select(playlists).where(playlists.c.id == pid))).one()
    assert (pl.name, pl.origin) == ("Мне нравится из Яндекс Музыки", "yandex")
    assert await order() == ["Song 1", "Song 2", "Song 4"]

    async with sm() as s:  # the listener takes «2» out of the playlist
        await s.execute(
            sa.update(playlist_items)
            .where(playlist_items.c.playlist_id == pid)
            .where(
                playlist_items.c.track_id
                == sa.select(tracks.c.id)
                .where(tracks.c.account_id == acct, tracks.c.title == "Song 2")
                .scalar_subquery()
            )
            .values(deleted_at=sa.func.now())
        )
        await s.commit()
    src.insert(0, song(5))  # a new like on top
    got = await run()
    assert fetched == [2, 4, 4, 4, 5]  # only the new one
    assert uuid.UUID(got["playlists"][0]["playlist_id"]) == pid
    assert await order() == ["Song 5", "Song 1", "Song 4"]  # Yandex order; «2» stays out

    got = await run()  # nothing new: nothing fetched, nothing added
    assert fetched == [2, 4, 4, 4, 5]
    assert got["playlists"][0]["added"] == 0
    async with sm() as s:
        rows = dict(
            (
                await s.execute(
                    sa.select(yandex_imports.c.yandex_track_id, yandex_imports.c.status).where(
                        yandex_imports.c.account_id == acct
                    )
                )
            ).all()
        )
    assert rows == {
        "1": "downloaded",
        "2": "downloaded",
        "3": "unavailable",
        "4": "downloaded",
        "5": "downloaded",
    }
    async with sm() as s:  # the shared database: the rollback export counts new playlists
        await s.execute(sa.delete(playlist_items).where(playlist_items.c.playlist_id == pid))
        await s.execute(sa.delete(playlists).where(playlists.c.id == pid))
        await s.commit()
