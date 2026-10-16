"""Ingest intelligence: content-keyed points, the online lyrics chain, the envelope."""

import subprocess
import uuid
from pathlib import Path

import httpx
import numpy as np
import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from musix.contexts.intel import envelope, pipeline
from musix.contexts.intel import lyrics as online
from musix.contexts.library.models import media_files, tracks
from musix.errors import Unavailable
from musix.infra import vectors
from musix.infra.ratelimit import Source
from musix.settings import Settings
from tests.integration.conftest import new_listener

pytestmark = pytest.mark.integration


async def test_a_second_account_only_adds_an_owner(
    sm,
    settings: Settings,
    tmp_path: Path,
    client: TestClient,
    owner,
    listener,  # type: ignore[no-untyped-def]
) -> None:
    _, acct_a, ids_a = listener
    async with sm() as s:
        mf = await s.scalar(sa.select(tracks.c.media_file_id).where(tracks.c.id == ids_a[0]))
        own = await pipeline.owners(s, mf)
    q = vectors.client(settings.qdrant_url)
    await vectors.ensure(q)
    text = np.random.default_rng(1).standard_normal(1024).tolist()
    await q.upsert(
        vectors.TRACKS,
        [vectors.models.PointStruct(id=str(mf), vector={"text": text}, payload={"owners": own})],
        wait=True,
    )

    (tmp_path / "b").mkdir()
    _, acct_b, _ = await new_listener(sm, tmp_path / "b", client, owner)  # the same files
    async with sm() as s:
        own_now = await pipeline.owners(s, mf)
    assert str(acct_a) in own_now
    assert str(acct_b) in own_now
    await pipeline.set_owners(q, mf, own_now)
    got = (await q.retrieve(vectors.TRACKS, [str(mf)], with_vectors=True, with_payload=True))[0]
    assert got.payload["owners"] == own_now  # membership moved...
    unit = np.asarray(text) / np.linalg.norm(text)  # cosine collections store unit vectors
    assert np.allclose(got.vector["text"], unit, atol=1e-6)  # ...the vectors did not
    await q.close()


async def test_the_lyrics_chain_falls_through_in_order(sm) -> None:  # type: ignore[no-untyped-def]
    calls: list[str] = []

    async def down(q: online.Query) -> online.Found | None:
        calls.append("down")
        raise httpx.ConnectError("no route")

    async def empty(q: online.Query) -> online.Found | None:
        calls.append("empty")
        return None

    async def hit(q: online.Query) -> online.Found | None:
        calls.append("hit")
        return online.Found("Line one\n\nLine two", "third", "[00:01.00]Line one")

    tag = uuid.uuid4().hex[:6]
    chain = tuple(
        (Source(f"{n}-{tag}", rate=100.0, burst=10), f)
        for n, f in (("down", down), ("empty", empty), ("hit", hit))
    )
    got = await online.find(sm, online.Query("Song", "Artist", None, 180.0), chain)
    assert calls == ["down", "empty", "hit"]
    assert got is not None
    assert (got.source, got.synced_lrc) == ("third", "[00:01.00]Line one")
    async with sm() as s:
        fails = await s.scalar(
            sa.text("select failures from source_health where source = :s"), {"s": f"down-{tag}"}
        )
    assert fails == 1  # the failing source counts toward its breaker
    # nobody answered: not «no lyrics» but «ask again later»; one «no» is an answer
    with pytest.raises(Unavailable):
        await online.find(sm, online.Query("Song", "Artist", None, 180.0), chain[:1])
    assert await online.find(sm, online.Query("Song", "Artist", None, 180.0), chain[:2]) is None


async def test_lyrics_the_network_could_not_give_come_later(
    sm, settings: Settings, listener, monkeypatch
) -> None:  # type: ignore[no-untyped-def]
    """No source answered at ingest: the song still goes on to be ready, and the late job
    asks again until the lyrics come — then BM25 has them and the player is told."""
    from musix.contexts.library.models import lyrics
    from musix.infra.changelog import change_log

    _, acct, ids = listener
    async with sm() as s:
        mf = await s.scalar(sa.select(tracks.c.media_file_id).where(tracks.c.id == ids[0]))
        await s.execute(sa.delete(lyrics).where(lyrics.c.media_file_id == mf))
        await s.execute(
            sa.update(media_files).where(media_files.c.id == mf).values(intel_state="pending")
        )
        await s.commit()
    answers: list[online.Found | None] = []

    async def find(sm_, q):  # type: ignore[no-untyped-def]
        if not answers:
            raise Unavailable("lyrics: no source answered")
        return answers.pop()

    monkeypatch.setattr(online, "find", find)
    assert await pipeline.lyrics_step(sm, mf) is True  # late, but not in the way
    async with sm() as s:
        assert (
            await s.scalar(sa.select(media_files.c.intel_state).where(media_files.c.id == mf))
            == "lyrics"
        )
    q = vectors.client(settings.qdrant_url)
    await vectors.ensure(q)
    text = np.random.default_rng(2).standard_normal(1024).tolist()
    await q.upsert(
        vectors.TRACKS,
        [vectors.models.PointStruct(id=str(mf), vector={"text": text}, payload={})],
        wait=True,
    )
    with pytest.raises(Unavailable):  # still nobody: the retry asks again later
        await pipeline.late_lyrics_step(sm, q, mf)
    async with sm() as s:
        head = await s.scalar(
            sa.select(sa.func.max(change_log.c.seq)).where(change_log.c.account_id == acct)
        )
    answers.append(online.Found("Line one\n\nLine two", "lrclib"))
    assert await pipeline.late_lyrics_step(sm, q, mf) is True
    async with sm() as s:
        assert await s.scalar(sa.select(lyrics.c.text).where(lyrics.c.media_file_id == mf))
        moved = await s.scalar(
            sa.select(sa.func.max(change_log.c.seq)).where(change_log.c.account_id == acct)
        )
    assert moved > head  # the player's ETag moves: it fetches the lyrics
    got = (await q.retrieve(vectors.TRACKS, [str(mf)], with_vectors=True))[0]
    assert got.vector["bm25"]  # the lyrics are searchable
    await q.close()


def test_envelope_is_ten_hz_by_four_bands(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=100:duration=3", str(wav)],
        check=True,
    )
    import asyncio

    env = envelope.compute(asyncio.run(envelope.decode(str(wav))))
    assert env.shape == (31, 4)  # 3 s at 10 Hz, + the centred last frame
    assert env[5:25, 0].min() > env[5:25, 2].max()  # a 100 Hz tone lives in the lowest band
    assert np.array_equal(envelope.unpack(envelope.pack(env)), env)


class _CpuOnlyMl:
    """CLAP answers, the GPU host is off — until `gpu_on`."""

    def __init__(self) -> None:
        self.gpu_on = False
        self.rng = np.random.default_rng(7)

    async def clap_audio(self, path: str, *, priority: str = "bulk"):  # type: ignore[no-untyped-def]
        return self.rng.standard_normal(512), self.rng.standard_normal((3, 512))

    async def clap_text(self, texts: list[str], *, priority: str):  # type: ignore[no-untyped-def]
        return self.rng.standard_normal((len(texts), 512))

    async def embed_text(self, texts: list[str], *, is_query: bool, priority: str):  # type: ignore[no-untyped-def]
        if not self.gpu_on:
            raise Unavailable("ml dense: ConnectError", op="dense")
        return self.rng.standard_normal((len(texts), 1024))


async def test_a_song_gets_ready_without_the_gpu_and_its_lyrics_vector_comes_later(
    sm,
    settings: Settings,
    listener,  # type: ignore[no-untyped-def]
) -> None:
    _, _, ids = listener
    async with sm() as s:
        mf = await s.scalar(sa.select(tracks.c.media_file_id).where(tracks.c.id == ids[1]))
    q = vectors.client(settings.qdrant_url)
    ml = _CpuOnlyMl()
    await pipeline.embed_step(sm, ml, q, mf)  # type: ignore[arg-type]
    async with sm() as s:
        state = await s.scalar(sa.select(media_files.c.intel_state).where(media_files.c.id == mf))
    assert state == "indexed"  # ready for «Поток» and sound search with the GPU off
    got = (await q.retrieve(vectors.TRACKS, [str(mf)], with_vectors=True))[0]
    assert {"clap", "bm25"} <= set(got.vector)
    assert "text" not in got.vector

    with pytest.raises(Unavailable):  # the gpu job waits for the host (GPU_RETRY)
        await pipeline.text_step(sm, ml, q, mf)  # type: ignore[arg-type]
    ml.gpu_on = True
    await pipeline.text_step(sm, ml, q, mf)  # type: ignore[arg-type]
    got = (await q.retrieve(vectors.TRACKS, [str(mf)], with_vectors=True))[0]
    assert {"clap", "bm25", "text"} <= set(got.vector)  # added, nothing dropped
    await q.close()
