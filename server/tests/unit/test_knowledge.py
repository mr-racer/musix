"""facts_v2's classifier contract (v1 tests/unit/test_ai_tasks.py::TestRefinedFacts,
the cases that guard the port): label parsing, routing, the pre-model gate, prompts."""

import json

from musix.knowledge.facts_v2 import pipeline as fv2
from musix.knowledge.facts_v2 import prompts as P


def test_facts_v2_classifier_parses_routes_and_gates_as_v1() -> None:
    def labels(items: object) -> dict[str, dict[str, list[str]]]:
        return fv2._parse_labels(items, fv2.SONG_LABELS)

    raw = json.dumps(
        {
            "items": [
                {"id": "M1", "labels": ["creation", "nope"]},
                {"id": "M2", "labels": ["other", "video"]},
            ]
        }
    )
    assert labels(fv2.parse_json(raw)) == {
        "M1": {"labels": ["creation"]},
        "M2": {"labels": ["video"]},
    }
    assert labels(fv2.parse_json("not json")) == {} == labels(fv2.parse_json('{"wrong": []}'))
    off = {
        "items": [{"id": "M1", "labels": ["about_artist", "personal"], "move": {"scope": "artist"}}]
    }
    assert labels(off) == {"M1": {"labels": ["about_artist"]}}  # off-scope swallows; no legacy move

    both = fv2.route(["creation", "sample"])  # a sample is orthogonal: link AND prose
    assert both["extract"] is True
    assert both["primary"] == "creation"
    assert fv2.route(["sample"])["primary"] is None
    a, b = fv2.route(["name_origin", "band_history"]), fv2.route(["band_history", "name_origin"])
    assert a["primary"] == b["primary"] == "name_origin"
    aside = fv2.route(["about_artist"])  # off-scope: set aside, never rewritten
    assert aside["primary"] is None
    assert aside["focus"] == []

    roster = (
        "1987-2002 Layne Staley Vocals, guitar 1987-2002 Jerry Cantrell Guitar "
        "1987- Mike Starr Bass"
    )
    assert fv2.gate({"fact": roster}) == "roster"
    assert (
        fv2.gate({"fact": "Recorded in a single night in a garage after their gear was stolen."})
        is None
    )

    for text in (
        P.SONG_CLASSIFY.format(title="T", artist="A", items="M1. x"),
        P.ARTIST_CLASSIFY.format(artist="A", items="M1. x"),
    ):
        assert '{"items":[{"id":"M1","labels":["..."]}]}' in text
        assert "{{" not in text


def test_the_planner_checks_every_field_the_model_returns() -> None:
    """v1 tests/unit/test_assistant_planner.py::TestValidate, the routing cases."""
    from musix.assistant.planner import Planner

    p = Planner(object())
    assert p.validate({"intent": "vibes"}, "что-нибудь") is None  # unknown intent: ask, don't guess
    plan = p.validate({"intent": "general", "web_queries": []}, "почему Eminem так зовут")
    assert plan is not None
    assert plan.intent == "general"
    assert plan.web_queries == ["почему Eminem так зовут"]  # falls back to the user's sentence
    assert plan.ce_query == "почему Eminem так зовут"
    dup = p.validate(
        {"intent": "playlist", "web_queries": ["kanye hits", "Kanye  Hits", "kanye best songs"]},
        "хиты канье",
    )
    assert dup is not None
    assert len(dup.web_queries) == 2
    work = p.validate(
        {"intent": "playlist", "work": "Grand Theft Auto V", "web_queries": ["soundtrack list"]},
        "музыка из гта 5",
    )
    assert work is not None
    assert all('"Grand Theft Auto V"' in q for q in work.web_queries)
    big = p.validate({"intent": "playlist", "count": 5000}, "собери плейлист")
    assert big is not None
    assert big.filters.count is None


def test_a_bio_loses_the_agents_english_preface_but_keeps_latin_names() -> None:
    from musix.knowledge.bio_text import clean_bio

    leaked = (
        "The bio facts are confirmed; no contradictions found. I will now write the final "
        "Russian paragraph.\n\nKanye West (род. 8 июня 1977) — американский рэпер.\n\n"
        "Второй абзац."
    )
    assert clean_bio(leaked, "ru") == (
        "Kanye West (род. 8 июня 1977) — американский рэпер.\n\nВторой абзац."
    )
    mixed = "Eminem, born Marshall Bruce Mathers III in St. Joseph, начал читать рэп в 14 лет."
    assert clean_bio(mixed, "ru") == mixed
    english = "Billie Eilish, born in Los Angeles in 2001, is a singer.\n\nЕё вокал многослоен."
    assert clean_bio(english, "ru") == english  # biography in English, not notes: kept
    assert clean_bio(leaked, "en") == leaked
    ruled = "Here is the refined Russian biography.\n\n---\n\n**P$C** — рэп-группа из Атланты."
    assert clean_bio(ruled, "ru") == "P$C — рэп-группа из Атланты."


def test_vibe_tag_names_accept_both_sonic_tag_shapes() -> None:
    from musix.contexts.knowledge.jobs import tag_names

    assert tag_names(["warm", "lo-fi"]) == ["warm", "lo-fi"]  # migrated from v1
    assert tag_names([{"tag": "warm", "score": 0.4}, {"tag": "", "score": 0.1}]) == ["warm"]
    assert tag_names(None) == [] and tag_names([]) == []


async def test_ai_jobs_wait_for_an_llm_that_is_off_but_not_for_one_that_refuses() -> None:
    """The owner turns the LLM off: its jobs must wait (every 10 min, no limit), while a
    request the LLM answered with a 4xx fails at once — it would be refused again."""
    from types import SimpleNamespace

    import httpx
    import pytest

    from musix.contexts.knowledge.tasks import LLM_RETRY
    from musix.errors import Unavailable
    from musix.infra.llm import Llm, LlmConfig, LlmRejected

    async def chat_with(handler):  # type: ignore[no-untyped-def]
        llm = Llm(None, None, transport=httpx.MockTransport(handler))  # type: ignore[arg-type]

        async def config() -> LlmConfig:
            return LlmConfig(base_url="http://llm/v1", model="m", api_key="k")

        llm.config = config  # type: ignore[method-assign]
        try:
            await llm.ask("hi", kind="t", cache=False)
        finally:
            await llm.close()

    def down(_r: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    errors = []
    for handler in (down, lambda r: httpx.Response(503), lambda r: httpx.Response(400)):
        with pytest.raises(Unavailable) as e:
            await chat_with(handler)
        errors.append(e.value)
    off, loading, refused = errors
    assert not isinstance(off, LlmRejected)
    assert not isinstance(loading, LlmRejected)
    assert isinstance(refused, LlmRejected)

    import datetime as dt

    job = SimpleNamespace(attempts=500)
    for err in (off, loading):
        decision = LLM_RETRY.get_retry_decision(exception=err, job=job)  # type: ignore[arg-type]
        assert decision is not None
        assert decision.retry_at is not None
        assert 590 < (decision.retry_at - dt.datetime.now(dt.UTC)).total_seconds() <= 600
    assert LLM_RETRY.get_retry_decision(exception=refused, job=job) is None  # type: ignore[arg-type]
