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


async def test_the_genius_page_gives_samples_credits_and_tags_and_a_rerun_replaces_them(
    sm, client: TestClient, listener
) -> None:  # type: ignore[no-untyped-def]
    from musix.contexts.knowledge import jobs
    from musix.contexts.knowledge.models import song_credits, song_relations, song_tags
    from musix.contexts.library.models import songs, tracks
    from musix.knowledge import genius as G

    tok, _, (a, *_) = listener
    page = {
        "songPage": {"song": 1},
        "entities": {
            "songs": {
                "1": {
                    "id": 1,
                    "songRelationships": [
                        {"relationshipType": "samples", "songs": [2, 3]},
                        {"relationshipType": "interpolates", "songs": [4]},
                        {"relationshipType": "sampled_in", "songs": [2]},
                    ],
                    "customPerformances": [
                        {"label": "Bass", "artists": [10]},
                        {"label": "Guitar", "artists": [10]},
                        {"label": "Vocal Samples", "artists": [11]},
                        {"label": "Video Director", "artists": [12]},
                        {"label": "Mixed At", "artists": [12]},
                    ],
                    "tags": [7, 8],
                    "primaryTag": 8,
                },
                "2": {"title": "21st Century Schizoid Man", "artistNames": "King Crimson"},
                "3": {"title": "It’s Your Thing", "artistNames": "Cold Grits"},
                "4": {"fullTitle": "99 Problems by JAY-Z"},
            },
            "artists": {
                "10": {"name": "Mike Dean"},
                "11": {"name": "Greg Lake"},
                "12": {"name": "X"},
            },
            "tags": {"7": {"id": 7, "name": "Experimental"}, "8": {"id": 8, "name": "Rap"}},
        },
    }
    parsed = G.song_data("https://genius.com/x", "<html></html>", page, [])
    assert [(lk["kind"], lk["artist"], lk["title"]) for lk in parsed["links"]] == [
        ("sample", "King Crimson", "21st Century Schizoid Man"),
        ("sample", "Cold Grits", "It's Your Thing"),
        ("interpolation", "JAY-Z", "99 Problems"),
    ]
    assert parsed["credits"] == [
        ("Bass", ["Mike Dean"]),
        ("Guitar", ["Mike Dean"]),
        ("Vocal Samples", ["Greg Lake"]),
    ]
    assert parsed["tags"] == [("Rap", True), ("Experimental", False)]

    async with sm() as s:
        song_id = await s.scalar(sa.select(tracks.c.song_id).where(tracks.c.id == a))
        slug = await s.scalar(sa.select(songs.c.slug).where(songs.c.id == song_id))
        # the facts already named one of them, unchecked and spelled their way: Genius
        # confirms it, no second row
        await s.execute(
            sa.insert(song_relations).values(
                song_id=song_id,
                kind="sample",
                target_text="King Crimson — 21st Century Schizoid-Man",
                source="facts",
            )
        )
        await jobs._store_genius_page(s, song_id, slug, parsed)
        await s.commit()
        rel = (
            await s.execute(
                sa.select(
                    song_relations.c.kind,
                    song_relations.c.target_text,
                    song_relations.c.source,
                    song_relations.c.verified,
                )
                .where(song_relations.c.song_id == song_id)
                .order_by(song_relations.c.id)
            )
        ).all()
        assert [tuple(r) for r in rel] == [
            ("sample", "King Crimson — 21st Century Schizoid-Man", "facts", True),
            ("sample", "Cold Grits — It's Your Thing", "genius", True),
            ("interpolation", "JAY-Z — 99 Problems", "genius", True),
        ]
        roles = (
            await s.execute(
                sa.select(song_credits.c.role, song_credits.c.name).where(
                    song_credits.c.song_id == song_id
                )
            )
        ).all()
        assert sorted(tuple(r) for r in roles) == [
            ("Bass", "Mike Dean"),
            ("Guitar", "Mike Dean"),
            ("Vocal Samples", "Greg Lake"),
        ]

        parsed["links"] = parsed["links"][:1]  # Genius dropped two links and a tag
        parsed["tags"] = [("Rap", True)]
        await jobs._store_genius_page(s, song_id, slug, parsed)
        await s.commit()
        assert (
            await s.scalar(
                sa.select(sa.func.count())
                .select_from(song_relations)
                .where(song_relations.c.song_id == song_id)
            )
            == 1
        )
        assert list(
            await s.scalars(sa.select(song_tags.c.tag).where(song_tags.c.song_id == song_id))
        ) == ["Rap"]
    k = client.get(f"/api/v2/tracks/{a}/knowledge", headers=bearer(tok)).json()
    assert [x["text"] for x in k["samples"]] == ["King Crimson — 21st Century Schizoid-Man"]
