"""Invariant checks for applying untrusted model-supplied text patches."""

import pytest

from musix.knowledge.text_edits import apply_edits, mask_names, restore_name_edits


def test_a_local_grammar_fix_keeps_names_numbers_and_the_surrounding_text() -> None:
    text = "Eminem записала куплет в 2001 году, а Dr. Dre занимался продюсированием."
    result = apply_edits(
        text,
        [{"from": "записала", "to": "записал"}],
        source="Eminem recorded a verse in 2001. Dr. Dre produced it.",
        protected_names=("Eminem", "Dr. Dre"),
    )
    assert result.accepted
    assert result.text == text.replace("записала", "записал")


def test_an_ambiguous_match_is_not_globally_replaced() -> None:
    text = "Он записал куплет и записал припев."
    result = apply_edits(text, [{"from": "записал", "to": "исполнил"}], source=text)
    assert not result.accepted
    assert result.reason == "ambiguous_from"
    assert result.text == text


def test_overlapping_edits_are_rejected_without_a_partial_change() -> None:
    text = "Они записали длинный куплет в своей студии."
    result = apply_edits(
        text,
        [
            {"from": "записали длинный", "to": "сочинили короткий"},
            {"from": "длинный куплет", "to": "новый куплет"},
        ],
        source=text,
    )
    assert not result.accepted
    assert result.reason == "overlapping_edits"
    assert result.text == text


def test_edits_match_the_original_and_never_cascade_into_each_other() -> None:
    text = "Тихий звук остаётся в начале записи, а яркий свет заполняет сцену."
    result = apply_edits(
        text,
        [
            {"from": "звук", "to": "свет"},
            {"from": "свет", "to": "голос"},
        ],
        source=text,
    )
    assert result.accepted
    assert result.text == "Тихий свет остаётся в начале записи, а яркий голос заполняет сцену."


def test_a_model_cannot_translate_a_protected_name_or_change_a_date() -> None:
    text = "Eminem записал куплет в 2001 году вместе с Dr. Dre."
    for edit, reason in [
        ({"from": "Eminem", "to": "Эминем"}, "protected_name_changed"),
        ({"from": "2001", "to": "2002"}, "numbers_changed"),
    ]:
        result = apply_edits(text, [edit], source=text, protected_names=("Eminem",))
        assert not result.accepted
        assert result.reason == reason
        assert result.text == text


def test_a_rewritten_paragraph_or_a_new_hybrid_word_does_not_replace_the_draft() -> None:
    text = "Он записал куплет в маленькой домашней студии."
    rewritten = apply_edits(
        text, [{"from": text, "to": "Он стал известным музыкантом."}], source=text
    )
    assert not rewritten.accepted
    assert rewritten.reason == "whole_text_replacement"
    hybrid = apply_edits(text, [{"from": "записал", "to": "recordировал"}], source=text)
    assert not hybrid.accepted
    assert hybrid.reason == "new_mixed_script"


def test_a_source_spelling_can_replace_an_unprotected_transliteration() -> None:
    text = "На гитаре сыграл Кейси Лейн в небольшой домашней студии."
    result = apply_edits(
        text, [{"from": "Кейси Лейн", "to": "Casey Lane"}], source="Casey Lane played guitar."
    )
    assert result.accepted
    assert "Casey Lane" in result.text


def test_short_names_and_possessives_are_also_protected() -> None:
    text = "Tim Neil's older brother записал песню в небольшой домашней студии."
    result = apply_edits(
        text,
        [{"from": "Tim Neil's older brother", "to": "Тим, старший брат Нила"}],
        source="Neil's older brother, Tim, recorded a song.",
    )
    assert not result.accepted
    assert result.reason == "protected_name_changed"
    assert result.text == text


def test_name_mask_roundtrip_preserves_repeated_and_overlapping_spellings() -> None:
    draft = "Alex North записал песню; позже North выпустил её сам."
    source = "Alex North recorded a song. North released it later."
    masked = mask_names(draft, source)
    restored = masked.draft
    for slot, name in masked.slots.items():
        restored = restored.replace(slot, name)
    assert restored == draft
    assert "Alex North" not in masked.draft
    assert "Alex North" not in masked.source


def test_a_grammar_patch_can_move_an_immutable_name_without_transliterating_it() -> None:
    draft = "У Sam много татуировок, но одну он жалеет."
    source = "Sam regrets one tattoo."
    masked = mask_names(draft, source, ("Sam",))
    edits, error = restore_name_edits(
        [{"from": "одну он жалеет", "to": "об одной он жалеет"}], masked.slots
    )
    assert error is None
    result = apply_edits(draft, edits, source=source, protected_names=("Sam",))
    assert result.accepted
    assert result.text == "У Sam много татуировок, но об одной он жалеет."


def test_replacing_or_inventing_a_name_slot_is_rejected() -> None:
    slots = {"⟦N1⟧": "Sam", "⟦N2⟧": "Alex"}
    for edits, reason in [
        ([{"from": "⟦N1⟧", "to": "Сэм"}], "name_slot_changed"),
        ([{"from": "⟦N1⟧", "to": "⟦N2⟧"}], "name_slot_changed"),
        ([{"from": "голос", "to": "голос ⟦N3⟧"}], "unknown_name_slot"),
    ]:
        decoded, error = restore_name_edits(edits, slots)
        assert decoded is None
        assert error == reason


def test_existing_slot_syntax_is_not_mistaken_for_an_entity() -> None:
    with pytest.raises(ValueError, match="reserved name slot"):
        mask_names("В тексте уже есть ⟦N1⟧.", "source")


@pytest.mark.parametrize("name", ["Émile", "Björk", "João", "Łukasz", "Søren"])
def test_source_spellings_with_diacritics_are_protected(name: str) -> None:
    draft = f"{name} записал вокал в домашней студии."
    result = apply_edits(
        draft, [{"from": name, "to": "Музыкант"}], source=f"{name} recorded the vocal."
    )
    assert result.reason == "protected_name_changed"
    assert result.text == draft
