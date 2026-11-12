"""The new editorial pass replaces existing repair rounds on static surfaces."""

import json
from types import SimpleNamespace

import pytest

from musix.knowledge.facts_v2 import pipeline as fv2


async def test_fact_editing_spends_one_call_and_does_not_enter_legacy_repair_rounds() -> None:
    calls = []
    draft = "Песня была записана дома и содержит guitar."
    corrected = "Песня была записана дома и содержит гитару."
    source = "The song was recorded at home and contains a guitar."

    async def ask(prompt: str, temperature: float) -> str:
        calls.append(prompt)
        return json.dumps({"status": "repaired", "text": corrected})

    text, _, notes = await fv2._repair(
        ask,
        draft,
        src=source,
        cap=220,
        forbid="",
        lang_name="Russian",
        lang_code="ru",
        editor_mode="apply",
    )
    assert text == corrected
    assert notes["editor"]["draft"] == draft
    assert source in calls[0]
    assert len(calls) == 1


async def test_rejected_fact_edit_does_not_cause_another_attempt() -> None:
    calls = 0
    draft = "Песня была записана дома в 2004 году."

    async def ask(*args):
        nonlocal calls
        calls += 1
        return json.dumps({"status": "repaired", "text": draft.replace("2004", "2005")})

    text, _, notes = await fv2._repair(
        ask,
        draft,
        src="It was recorded at home in 2004.",
        cap=220,
        forbid="",
        lang_name="Russian",
        lang_code="ru",
        editor_mode="apply",
    )
    assert calls == 1
    assert text == draft
    assert notes["editor"]["reason"] == "numbers_changed"


async def test_optional_editor_failure_does_not_mark_a_successful_writer_unavailable() -> None:
    from musix.contexts.knowledge.jobs import asker
    from musix.errors import Unavailable
    from musix.knowledge.prose_repair import repair_once

    class UnavailableLlm:
        async def ask(self, *args, **kwargs):
            raise Unavailable("offline")

    down = []
    ask = asker(UnavailableLlm(), "facts_v2", down)
    result = await repair_once(ask, "Песня записана дома.", source="Recorded at home.")
    assert result.status == "unavailable"
    assert down == []
    with pytest.raises(Unavailable):
        await ask("The original writer prompt.")
    assert down == ["offline"]


async def test_shadow_audits_the_legacy_result_without_changing_its_repair_path() -> None:
    from musix.knowledge.prose_repair import REPAIR_SYSTEM

    draft = "Песня была записана в небольшой домашней студии в 2004 году."
    baseline = "Песня записана в домашней студии в 2004 году."
    proposal = "Песня записана дома в 2004 году."
    calls = []

    async def ask(prompt: str, temperature: float) -> str:
        calls.append(prompt)
        if prompt.startswith(REPAIR_SYSTEM):
            return json.dumps({"status": "repaired", "text": proposal})
        return json.dumps({"text": baseline})

    kwargs = {
        "src": "The song was recorded at home in 2004.",
        "cap": 50,
        "forbid": "",
        "lang_name": "Russian",
        "lang_code": "ru",
    }
    off, _, _ = await fv2._repair(ask, draft, **kwargs)
    assert off == baseline
    assert len(calls) == 1
    calls.clear()
    shadow, _, notes = await fv2._repair(ask, draft, editor_mode="shadow", **kwargs)
    assert shadow == baseline
    assert len(calls) == 2
    assert notes["editor"]["draft"] == baseline
    assert notes["editor"]["candidate"] == proposal


async def test_an_editor_cannot_reintroduce_the_song_title_forbidden_by_the_writer() -> None:
    draft = "Песня была записана дома в 2004 году."

    async def ask(*args):
        return json.dumps({"status": "repaired", "text": draft.replace("Песня", "Example Song")})

    text, _, notes = await fv2._repair(
        ask,
        draft,
        src="Example Song was recorded at home in 2004.",
        cap=220,
        forbid="Example Song",
        lang_name="Russian",
        lang_code="ru",
        editor_mode="apply",
    )
    assert text == draft
    assert notes["editor"]["reason"] == "new_quality_issue"


def test_player_line_contains_no_source_url_but_can_name_a_chart() -> None:
    from musix.knowledge import sonic_vibe

    assert not sonic_vibe._line_ok("Записана дома — https://example.com/source", "ru")
    assert sonic_vibe._line_ok("Песня возглавила Billboard Hot 100", "ru")


@pytest.mark.parametrize("lang", ["ru", "en"])
def test_a_bio_refusal_marker_is_not_displayed_as_a_biography(lang: str) -> None:
    from musix.knowledge.bio_text import clean_bio

    assert clean_bio("NO_DATA", lang) == ""
    assert clean_bio(" **NO_DATA** ", lang) == ""
    assert clean_bio("NO_DATA\n</think>\n\nNO_DATA", lang) == ""
    assert (
        clean_bio("Группа выпустила дебютный альбом.\n\n[NO_DATA]", lang)
        == "Группа выпустила дебютный альбом."
    )
    actual_bio = "No Data — дуэт, выпустивший альбом NO_DATA."
    assert clean_bio(actual_bio, lang) == actual_bio


@pytest.mark.parametrize("mode", ["song", "lyric_explain"])
async def test_interactive_surfaces_do_not_call_the_static_editor(monkeypatch, mode: str) -> None:
    from musix.assistant import track_chat
    from musix.assistant.models import TrackChatContext, TrackChatRequest

    calls = []
    draft = "В ответе намеренно оставлена тестовая ошибка."

    class AgentStub:
        async def run(self, message, **kwargs):
            calls.append(message)
            return SimpleNamespace(output=draft)

    async def forbidden_editor(*args, **kwargs):
        pytest.fail("Interactive output must not spend a static-editor call")

    monkeypatch.setattr("musix.knowledge.prose_repair.repair_once", forbidden_editor)
    monkeypatch.setattr(track_chat, "resolve_song_facts_list", lambda *args: [])
    monkeypatch.setattr(
        track_chat,
        "create_track_chat_agent",
        lambda *args, **kwargs: (AgentStub(), {"web_search_calls": 0}),
    )
    request = TrackChatRequest(
        track_context=TrackChatContext(title="Example", artist="Example Artist"),
        mode=mode,
        selected_line="One selected line",
        message="Объясни строку",
        lang="ru",
    )
    response = await track_chat.answer_track_chat(request)
    assert response.message == draft
    assert len(calls) == 1
