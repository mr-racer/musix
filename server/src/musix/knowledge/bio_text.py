"""The bio agent's answer as a page shows it.

The bio_v2 agent (ported from v1) sometimes opens its final answer with its own English
working notes — «The bio facts are confirmed; no contradictions found. I will now write
the final Russian paragraph.» — then a blank line and the biography. 60-odd of v1's bios
carry such a preface; v2 cleans them where they are written and where they are read."""

from __future__ import annotations

import re

_CYRILLIC = re.compile(r"[А-Яа-яЁё]")
# the agent talking about its work, never a biography's own words
_NOTES = re.compile(
    r"\b(I will|I'll|I'm|let me|here is|here's|contradict\w*|initial bio|the bio|"
    r"search(es|ed)?|rewrit\w*|Russian|verif\w*|consistent|confirmed|draft|sentences?|"
    r"key facts|instructions?|finali[sz]\w*|exactly)\b",
    re.IGNORECASE,
)
_PARAGRAPHS = re.compile(r"\n\s*\n")
_RULE = re.compile(r"^\s*[-–—*_]{3,}\s*$")  # a markdown rule between the notes and the bio


def _cyrillic_share(p: str) -> float:
    letters = [ch for ch in p if ch.isalpha()]
    return sum(1 for ch in letters if _CYRILLIC.match(ch)) / max(1, len(letters))


def clean_bio(text: str, lang: str) -> str:
    """For a Russian bio: drop leading paragraphs that are the agent's notes — (almost) no
    Cyrillic, the vocabulary of its work, or a markdown rule — while a later one is Russian,
    and the bold markers. An English paragraph of actual biography stays (content beats
    language), a Latin name inside a Russian paragraph stays; other languages pass as is."""
    if lang != "ru":
        return text
    paras = _PARAGRAPHS.split(text.strip())

    def note(p: str) -> bool:
        return bool(_RULE.match(p)) or (_cyrillic_share(p) < 0.2 and bool(_NOTES.search(p)))

    i = 0
    while i < len(paras) - 1 and note(paras[i]):
        if not any(_cyrillic_share(q) >= 0.2 for q in paras[i + 1 :]):
            break
        i += 1
    out = "\n\n".join(p.lstrip("-–— \n") if j == 0 else p for j, p in enumerate(paras[i:]))
    return out.replace("**", "")  # the page shows plain text: bold markers are noise
