"""Is a Latin-script query Russian typed in Latin letters? ("ya tebya lyublyu")

Lyrics are searched in the script they were written in, so a transliterated line
matches nothing through BM25 — v1 left that to the dense leg alone. When a query reads
as transliterated Russian, the search adds a BM25 leg on its Cyrillic back-
transliteration. The test is deliberately conservative: an English line must never get
that leg (it adds Cyrillic noise to the fusion), so only unambiguous function words
count, and English ones outvote Russian ones."""

from __future__ import annotations

import re

from musix.contexts.search.normalize import _lat_to_cyr, fold

# Russian function words in common Latin spellings, minus those that are also English
# words (i, my, no, do, on, by, to, a, so, tam…)
RU = frozenset(
    [
        "ya",
        "ty",
        "ona",
        "oni",
        "vy",
        "ne",
        "na",
        "chto",
        "kak",
        "eto",
        "moy",
        "moi",
        "moya",
        "tvoy",
        "tvoi",
        "tvoya",
        "menya",
        "tebya",
        "mne",
        "tebe",
        "nam",
        "vam",
        "nas",
        "vas",
        "tak",
        "zhe",
        "vse",
        "vsyo",
        "da",
        "net",
        "bez",
        "ili",
        "esli",
        "kogda",
        "gde",
        "tut",
        "tolko",
        "uzhe",
        "eshche",
        "yeshche",
        "opyat",
        "budu",
        "budesh",
        "byl",
        "byla",
        "bylo",
        "mozhet",
        "nado",
        "nichego",
        "nikogda",
        "vsegda",
        "seychas",
        "teper",
        "potom",
        "zdes",
        "kto",
        "chego",
        "pro",
        "dlya",
        "ot",
        "iz",
        "ego",
        "eyo",
        "ee",
        "ikh",
        "sebya",
        "svoy",
        "svoi",
        "lyubov",
        "lyublyu",
        "serdtse",
        "dusha",
        "noch",
        "den",
        "nebo",
    ]
)
EN = frozenset(
    [
        "the",
        "you",
        "and",
        "to",
        "of",
        "in",
        "it",
        "is",
        "that",
        "for",
        "me",
        "your",
        "i'm",
        "im",
        "don't",
        "dont",
        "all",
        "love",
        "be",
        "we",
        "just",
        "like",
        "but",
        "what",
        "with",
        "this",
        "can",
        "know",
        "when",
        "are",
        "was",
        "my",
        "i",
        "no",
        "oh",
        "baby",
        "yeah",
        "got",
        "get",
        "so",
        "up",
        "down",
        "never",
        "ever",
        "want",
        "need",
        "feel",
        "make",
        "go",
        "come",
        "back",
        "time",
        "way",
        "one",
        "heart",
        "night",
    ]
)
_LATIN, _CYR = re.compile(r"[a-z]"), re.compile(r"[а-яё]")


def as_cyrillic(query: str) -> str | None:
    """The Cyrillic reading of a transliterated-Russian query, else None."""
    q = fold(query)
    if not _LATIN.search(q) or _CYR.search(q):
        return None
    toks = q.split()
    ru = sum(t in RU for t in toks)
    en = sum(t in EN for t in toks)
    return _lat_to_cyr(q) if ru >= 1 and ru > en else None
