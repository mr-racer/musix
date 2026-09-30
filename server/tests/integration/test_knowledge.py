"""The knowledge base: visibility by join, the shared token bucket, the LLM cache."""

import time
import uuid

import httpx
import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from tests.integration.conftest import bearer, new_listener

pytestmark = pytest.mark.integration


async def test_knowledge_is_visible_only_through_the_accounts_own_tracks(
    sm, tmp_path, client: TestClient, listener, owner
) -> None:  # type: ignore[no-untyped-def]
    from musix.contexts.knowledge.models import artist_bios, fact_refinements, facts
    from musix.contexts.library.models import artists, tracks

    tok, _, (a, *_) = listener
    async with sm() as s:
        song_id, artist_id = (
            await s.execute(
                sa.select(tracks.c.song_id, tracks.c.primary_artist_id).where(tracks.c.id == a)
            )
        ).one()
        fid = await s.scalar(
            sa.insert(facts)
            .values(
                subject_kind="song",
                subject_id=song_id,
                lang="en",
                text="Raw fact about the song, long enough.",
                source="genius.com",
            )
            .returning(facts.c.id)
        )
        await s.execute(
            sa.insert(fact_refinements).values(
                fact_id=fid, lang="ru", labels=["creation"], text="Уточнённый факт.", confirmed=True
            )
        )
        await s.execute(
            sa.insert(artist_bios).values(
                artist_id=artist_id, lang="ru", text="Био.", facets={}, sources={}
            )
        )
        orphan = await s.scalar(
            sa.insert(artists)
            .values(slug=f"nobody-{uuid.uuid4().hex[:6]}", name="Nobody")
            .returning(artists.c.id)
        )
        await s.execute(
            sa.insert(artist_bios).values(
                artist_id=orphan, lang="ru", text="Чужое био.", facets={}, sources={}
            )
        )
        await s.commit()
    h = bearer(tok)
    k = client.get(f"/api/v2/tracks/{a}/knowledge", params={"lang": "ru"}, headers=h).json()
    assert [f["text"] for f in k["songFacts"]] == ["Уточнённый факт."]
    assert k["refined"]
    en = client.get(f"/api/v2/tracks/{a}/knowledge", params={"lang": "en"}, headers=h).json()
    assert [f["text"] for f in en["songFacts"]] == [
        "Raw fact about the song, long enough."
    ]  # not refined in en: raw
    assert (
        client.get(f"/api/v2/player/context/{a}", headers=h).json()["knowledge"]["songFacts"][0][
            "text"
        ]
        == "Уточнённый факт."
    )
    assert client.get(f"/api/v2/artists/{artist_id}/bio", headers=h).status_code == 200
    assert (
        client.get(f"/api/v2/artists/{orphan}/bio", headers=h).status_code == 404
    )  # no track of that artist

    (tmp_path / "b").mkdir()
    other, _, _ = await new_listener(sm, tmp_path / "b", client, owner)
    assert client.get(f"/api/v2/tracks/{a}/knowledge", headers=bearer(other)).status_code == 404


async def test_the_token_bucket_spaces_calls_across_callers(sm) -> None:  # type: ignore[no-untyped-def]
    import asyncio

    from musix.infra.ratelimit import Source, acquire

    src = Source(f"test-{uuid.uuid4().hex[:6]}", rate=10.0, burst=1)
    t = time.monotonic()
    await asyncio.gather(*(acquire(sm, src) for _ in range(4)))  # 1 from the burst, 3 on credit
    assert 0.25 <= time.monotonic() - t < 1.0


async def test_an_llm_answer_is_cached_by_its_input_and_the_key_never_leaks(sm) -> None:  # type: ignore[no-untyped-def]
    from musix.errors import Unavailable
    from musix.infra.llm import Llm

    calls: list[httpx.Request] = []

    def answer(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        if b"fail" in req.content:
            return httpx.Response(500)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '<think>x</think>```json\n{"ok": 1}\n```'}}]},
        )

    llm = Llm(
        sm,
        None,
        "http://llm.test",
        f"m-{uuid.uuid4().hex[:6]}",
        "sk-secret",
        transport=httpx.MockTransport(answer),
    )
    assert await llm.ask_json("q", kind="t") == {"ok": 1}
    assert await llm.ask_json("q", kind="t") == {"ok": 1}
    assert len(calls) == 1
    assert calls[0].url == "http://llm.test/v1/chat/completions"
    assert await llm.ask_json("q", kind="t", temperature=0.9) == {"ok": 1}
    assert len(calls) == 2  # the params are part of the key
    assert "sk-secret" not in repr((await llm.config()).public_view())
    with pytest.raises(Unavailable) as e:
        await llm.ask("fail", kind="t")
    assert "sk-secret" not in str(e.value)
    await llm.close()
