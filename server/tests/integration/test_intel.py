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
from musix.contexts.library.models import tracks
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
