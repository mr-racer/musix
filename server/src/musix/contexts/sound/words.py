"""Word keys of the sound profile and their Russian labels (spec §7: the profile stores keys,
the read API renders the phrase in the request's language, so a wording fix or English
needs no re-derive). The vocabulary is closed: it is every word the prototype can say.
`key()` raises on a word it does not know, so a new word in derive fails its test instead
of reaching the table as Russian."""

from __future__ import annotations

# instrument and voice names (analyse's tagger families, calibrated claims, generic names)
NAMES = {
    "voice": "голос",
    "vocal": "вокал",
    "male": "мужской вокал",
    "female": "женский вокал",
    "rap": "рэп",
    "rap_singing": "рэп и пение",
    "singing": "пение",
    "choir": "хор",
    "processed_voice": "голос с обработкой",
    "drums": "барабаны",
    "drums_live": "живые барабаны",
    "drum_machine": "драм-машина",
    "bass": "бас",
    "bass_808": "808-бас",
    "synth_bass": "синт-бас",
    "bass_guitar": "бас-гитара",
    "double_bass": "контрабас",
    "guitar": "гитара",
    "electric_guitar": "электрогитара",
    "acoustic_guitar": "акустическая гитара",
    "slide_guitar": "слайд-гитара",
    "banjo": "банджо",
    "mandolin": "мандолина",
    "ukulele": "укулеле",
    "sitar": "ситар",
    "lead": "лид-партия",
    "piano": "пианино",
    "electric_piano": "электропиано",
    "organ": "орган",
    "synthesizer": "синтезатор",
    "harpsichord": "клавесин",
    "keys": "клавишные",
    "synths": "синты",
    "synth_other": "синты и прочее",
    "strings": "струнные",
    "brass": "медные духовые",
    "winds": "духовые",
    "sax": "саксофон",
    "woodwind": "деревянные духовые",
    "samples": "семплы",
    "vocal_sample": "вокальный семпл",
    "bells": "колокольчики",
    "scratches": "скретчи",
    "accordion": "аккордеон",
    "harmonica": "губная гармошка",
    "bagpipes": "волынка",
    "harp": "арфа",
    "theremin": "терменвокс",
    "steelpan": "стилпэн",
    "part": "партия",
    "kick": "бочка",
    "snare": "малый барабан",
    "claps": "хлопки",
    "toms": "томы",
    "hihat": "хай-хэт",
    "cymbals": "тарелки",
}
SIDES = {"left": "слева", "right": "справа", "center": "по центру"}
ECHO = {
    "dry": "почти без эха",
    "little": "немного эха",
    "noticeable": "заметное эхо",
    "hall": "много эха, как в зале",
}
WIDTH = {
    "narrow": "узкая, почти моно",
    "medium": "средняя",
    "wide": "широкая",
    "very_wide": "очень широкая, от колонки до колонки",
}
PACE = {
    "slow": "медленный",
    "unhurried": "неспешный",
    "medium": "средний",
    "brisk": "бодрый",
    "fast": "быстрый",
}
FEEL = {
    "driving": "напористый",
    "swinging": "качающий",
    "free": "свободный, без ударных",
    "no_pulse": "без чёткого ритма",
}
SECTIONS = {
    "intro": "вступление",
    "verse": "куплет",
    "prechorus": "предприпев",
    "chorus": "припев",
    "bridge": "бридж",
    "break": "проигрыш",
    "outro": "концовка",
    "silence": "тишина",
    "part": "часть",
}
# trait keys that are not instrument names
TRAITS = {"few_vocals": "почти без голоса"}
SUFFIX_IN_PLACES = " местами"

_REV = {
    table: {ru: k for k, ru in d.items()}
    for table, d in (
        ("names", NAMES),
        ("sides", SIDES),
        ("echo", ECHO),
        ("width", WIDTH),
        ("pace", PACE),
        ("feel", FEEL),
    )
}


def key(table: str, ru: str) -> str:
    return _REV[table][ru]


def name_keys(ru: str | None) -> list[str]:
    """«струнные и медные духовые» → [strings, brass]; the tagger joins two families of the
    "other" stem with « и » or «, »."""
    if not ru:
        return []
    if ru in _REV["names"]:
        return [_REV["names"][ru]]
    parts = [p for chunk in ru.split(" и ") for p in chunk.split(", ")]
    return [_REV["names"][p] for p in parts]


def section_label(kind: str, n: int | None, last: bool) -> str:
    if kind == "verse" and n:
        return f"куплет {n}"
    if kind == "chorus" and last:
        return "последний припев"
    return SECTIONS.get(kind, kind)
