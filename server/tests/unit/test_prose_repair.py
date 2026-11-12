"""Safety and call-budget contracts for the persisted-text editor."""

import json

import pytest

from musix.knowledge.prose_repair import RepairBudget, edit_persisted, parse_reply, repair_once


@pytest.mark.parametrize(
    "reply", ["{}", '{"status":"repaired"}', "[]", "not JSON", '{"status":[]}']
)
def test_invalid_reply_keeps_the_original(reply: str) -> None:
    original = "Песня была записана дома."
    result = parse_reply(reply, original, source="The song was recorded at home.")
    assert result.status == "rejected"
    assert result.text == original


def test_a_grammar_repair_preserves_the_rest_of_the_text() -> None:
    original = "Группа Alex Reed записали песню дома в 2007 году."
    corrected = "Группа Alex Reed записала песню дома в 2007 году."
    result = parse_reply(
        json.dumps({"status": "repaired", "text": corrected}),
        original,
        source="Alex Reed recorded the song at home in 2007.",
        names=("Alex Reed",),
    )
    assert result.status == "repaired"
    assert result.text == corrected


@pytest.mark.parametrize(
    ("candidate", "reason"),
    [
        ("Алекс Рид записал песню дома в 2007 году.", "protected_name_changed"),
        ("Alex Reed записал песню дома в 2008 году.", "numbers_changed"),
        ("Alex Reed записал песню дoма в 2007 году.", "new_mixed_script"),
    ],
)
def test_a_repair_cannot_damage_protected_anchors(candidate: str, reason: str) -> None:
    original = "Alex Reed записала песню дома в 2007 году."
    result = parse_reply(
        json.dumps({"status": "repaired", "text": candidate}),
        original,
        source="Alex Reed recorded the song at home in 2007.",
        names=("Alex Reed",),
    )
    assert result.reason == reason
    assert result.text == original


async def test_a_bad_reply_does_not_trigger_a_second_call() -> None:
    calls = []

    async def ask(prompt: str, temperature: float) -> str:
        calls.append((prompt, temperature))
        return "invalid JSON"

    original = "Музыкант записал песню дома."
    result = await repair_once(ask, original, source="He recorded the song at home.")
    assert len(calls) == 1
    assert result.status == "rejected"
    assert result.text == original


async def test_missing_evidence_costs_no_call() -> None:
    async def ask(*args):
        pytest.fail("A missing source must not reach the model")

    result = await repair_once(ask, "Музыкант записал песню дома.", source="")
    assert result.status == "unresolved"
    assert result.reason == "missing_material"


async def test_an_unavailable_editor_keeps_the_draft_without_retry() -> None:
    calls = 0

    async def ask(*args):
        nonlocal calls
        calls += 1
        raise TimeoutError

    original = "Музыкант записал песню дома."
    result = await repair_once(ask, original, source="He recorded the song at home.")
    assert calls == 1
    assert result.status == "unavailable"
    assert result.text == original


async def test_shadow_mode_saves_the_candidate_but_keeps_the_displayed_text() -> None:
    original = "Группа записали песню дома."
    corrected = "Группа записала песню дома."

    async def ask(*args):
        return json.dumps({"status": "repaired", "text": corrected})

    text, audit = await edit_persisted(
        ask, original, source="The band recorded the song at home.", mode="shadow"
    )
    assert text == original
    assert audit["draft"] == original
    assert audit["candidate"] == corrected
    assert audit["status"] == "repaired"


async def test_a_shared_budget_prevents_another_editor_call_after_source_fallback() -> None:
    calls = 0

    async def ask(*args):
        nonlocal calls
        calls += 1
        return '{"status":"unresolved"}'

    budget = RepairBudget()
    for source in ("First source.", "Another source after fallback."):
        await repair_once(ask, "Музыкант записал песню дома.", source=source, budget=budget)
    assert calls == 1


async def test_disabled_editor_costs_no_call() -> None:
    async def ask(*args):
        pytest.fail("Disabled editing must not consume a model call")

    original = "Музыкант записал песню дома."
    assert await edit_persisted(ask, original, source="A source.", mode="off") == (original, {})


def test_a_date_correction_is_held_for_review_even_when_the_source_has_the_date() -> None:
    original = "Альбом вышел в 2011 году."
    fixed = "Альбом вышел в 2009 году."
    raw = json.dumps(
        {
            "issues": [{"span": "2011", "fix": "2009"}],
            "status": "repaired",
            "text": fixed,
        }
    )
    result = parse_reply(raw, original, source="The album was released in 2009.")
    assert result.text == original
    assert result.status == "rejected"
    assert result.reason == "numbers_changed"
    assert result.candidate == fixed
    rejected = parse_reply(raw, original, source="The album was released in 2010.")
    assert rejected.text == original
    assert rejected.reason == "numbers_changed"


async def test_a_rejected_candidate_is_preserved_for_review() -> None:
    original = "Альбом вышел в 2011 году."
    candidate = "Альбом вышел в 2009 году."

    async def ask(*args):
        return json.dumps({"status": "repaired", "text": candidate})

    text, audit = await edit_persisted(
        ask, original, source="The album was released in 2009.", mode="shadow"
    )
    assert text == original
    assert audit["candidate"] == candidate
    assert audit["status"] == "rejected"


def test_a_short_translation_is_not_mistaken_for_a_whole_text_rewrite() -> None:
    original = "Их drummer играл стоя."
    corrected = "Их барабанщик играл стоя."
    result = parse_reply(
        json.dumps({"status": "repaired", "text": corrected}),
        original,
        source="Their drummer played standing up.",
    )
    assert result.text == corrected
    assert result.status == "repaired"


def test_a_new_unmatched_quote_is_not_published() -> None:
    original = 'Песня записана для альбома "Silver".'
    result = parse_reply(
        json.dumps({"status": "repaired", "text": original + '"'}),
        original,
        source='The song was recorded for the album "Silver".',
    )
    assert result.text == original
    assert result.reason == "unbalanced_delimiter"


def test_a_hybrid_name_cannot_be_repaired_by_introducing_a_transliteration() -> None:
    original = "Tiffithе записал вокал в домашней студии."
    result = parse_reply(
        json.dumps({"status": "repaired", "text": "Тиффите записал вокал в домашней студии."}),
        original,
        source="Tiffith recorded the vocal. Later Tiffith released it.",
    )
    assert result.text == original
    assert result.reason == "new_transliteration"
