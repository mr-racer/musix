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
