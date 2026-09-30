"""The assistant: the catalog is the account's own; a turn streams, then is done."""

import asyncio
import json
import threading
import uuid

import httpx
import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from tests.integration.conftest import bearer, new_listener

pytestmark = pytest.mark.integration


async def test_the_catalog_and_facts_hold_only_the_accounts_own_tracks(
    sm, tmp_path, client: TestClient, listener, owner, settings
) -> None:  # type: ignore[no-untyped-def]
    from musix.assistant import data
    from musix.assistant.library_catalog import get_catalog, invalidate
    from musix.contexts.knowledge.models import facts
    from musix.contexts.library.models import songs, tracks

    _, a_acct, _ = listener
    (tmp_path / "b").mkdir()
    _, b_acct, (b, *_) = await new_listener(sm, tmp_path / "b", client, owner)
    async with sm() as s:
        await s.execute(sa.update(tracks).where(tracks.c.id == b).values(title="Only In B"))
        sid = await s.scalar(
            sa.insert(songs)
            .values(slug=f"b-only-{uuid.uuid4().hex[:6]}", title="Only In B")
            .returning(songs.c.id)
        )
        await s.execute(sa.update(tracks).where(tracks.c.id == b).values(song_id=sid))
        await s.execute(
            sa.insert(facts).values(
                subject_kind="song",
                subject_id=sid,
                lang="en",
                text="A fact about B's song only.",
                source="x",
            )
        )
        slug = await s.scalar(sa.select(songs.c.slug).where(songs.c.id == sid))
        await s.commit()
    data.configure(settings.procrastinate_conninfo)
    invalidate()
    titles = {s["title"] for s in get_catalog(str(a_acct)).songs}
    assert "Only In B" not in titles
    assert "Only In B" in {s["title"] for s in get_catalog(str(b_acct)).songs}
    assert data.raw_facts(str(a_acct), "song", slug) == []
    assert len(data.raw_facts(str(b_acct), "song", slug)) == 1
    assert data.get_track(str(a_acct), str(b)) is None
    data.close_all()


def _fake_llm_transport() -> httpx.MockTransport:
    reply = {
        "intent": "general",
        "web_queries": [],
        "answer": "Короткий ответ.",
        "used": [],
        "follow_ups": [],
    }

    def answer(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"choices": [{"message": {"content": json.dumps(reply, ensure_ascii=False)}}]}
        )

    return httpx.MockTransport(answer)


def test_a_turn_streams_its_stages_then_done_over_the_websocket(
    client: TestClient, listener, settings
) -> None:  # type: ignore[no-untyped-def]
    from musix.assistant.compat import ModelError
    from musix.assistant.retrieval.hub import DEFAULT_HUB
    from musix.contexts.assistant import service
    from musix.infra import db
    from musix.infra.llm import Llm

    class NoModels:  # every retrieval leg degrades, as on a box without the ml service
        def __getattr__(self, name: str) -> object:
            def fail(*a: object, **k: object) -> object:
                raise ModelError("no ml in tests")

            return fail

    DEFAULT_HUB._ml = NoModels()
    tok, _, (a, *_) = listener
    with client.websocket_connect("/api/v2/ws") as ws:
        ws.send_json({"type": "auth", "token": tok["accessToken"]})
        assert ws.receive_json()["type"] == "ready"
        r = client.post(
            "/api/v2/assistant/turns",
            json={"message": "расскажи про этот трек", "subjectTrackId": str(a), "allowWeb": False},
            headers=bearer(tok),
        )
        assert r.status_code == 202
        turn = r.json()["turnId"]

        def run() -> None:
            async def go() -> None:
                engine = db.make_engine(settings)
                sm = db.make_sessionmaker(engine)
                llm = Llm(
                    sm,
                    None,
                    "http://llm.test",
                    f"m-{uuid.uuid4().hex[:6]}",
                    transport=_fake_llm_transport(),
                )
                await service.run(
                    sm, llm, None, None, settings.procrastinate_conninfo, uuid.UUID(turn)
                )  # type: ignore[arg-type]
                await llm.close()
                await engine.dispose()

            asyncio.run(go())

        worker = threading.Thread(target=run)
        worker.start()
        kinds = []
        while True:
            msg = ws.receive_json()
            if msg.get("turnId") != turn:
                continue
            kinds.append(msg["type"])
            if msg["type"] == "assistant.done":
                break
        worker.join(30)
    assert kinds[0] == "assistant.stage"
    assert kinds.count("assistant.done") == 1
    got = client.get(f"/api/v2/assistant/turns/{turn}", headers=bearer(tok)).json()
    assert got["status"] == "done", got.get("error")
    assert got["result"]["intent"] == "general"
