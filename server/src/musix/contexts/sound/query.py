"""Sound keys of a search request and how a song's profile answers them.

The spec is 2026-11-12-sound-search-profile-design. A request about sound («экспериментальная
песня Kanye West с гитарой») carries two kinds of ask that the profile can check:

* **hard keys** — a named instrument, live drums or a drum machine, no voice. They select:
  a track either has a guitar in its «Звук» window or it does not, so «с гитарой» never
  returns a track the player shows without one.
* **soft keys** — calm, energetic, unusual, technical, spacious… They only order, and
  always INSIDE the pool the request built: «самое спокойное у Linkin Park» is the calmest
  Linkin Park, even if the whole library would call it brisk.

Everything here is pure code over a `Profile` — no model is asked whether a song «has a
guitar». The model's part is the planner's `sound` field (validated there against the
user's own words); the lexicon below is the fallback that finds instruments when the
planner's JSON is broken, and the guard against names («Piano Man», «Guitar Wolf»).
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

from musix.contexts.search.normalize import _lat_to_cyr, fold
from musix.contexts.sound.derive import FEAT_NAMES

# ---------------------------------------------------------------- keys

HARD = (
    "guitar",
    "piano",
    "keys",
    "strings",
    "brass",
    "winds",
    "bass_808",
    "synth_bass",
    "bass_guitar",
    "live_drums",
    "drum_machine",
    "no_vocals",
)
SOFT = ("calm", "energetic", "odd", "tech", "spacious", "intimate", "wide", "bass_heavy")
KEYS = HARD + SOFT
MAX_KEYS = 4
# a soft key asked for in the negative is its opposite where one exists («не слишком
# медленное» = бодрое); the rest flip their score
OPPOSITE = {"calm": "energetic", "energetic": "calm", "spacious": "intimate"}
# two asks that cannot both hold: both are dropped rather than one guessed
CONFLICTS = (frozenset({"calm", "energetic"}), frozenset({"live_drums", "drum_machine"}))
# a skit or an interlude is short; every one in the top of `odd` was under 90 s (spec §1.1)
MIN_SONG_S = 90.0


@dataclass(frozen=True, slots=True)
class SoundKey:
    key: str
    word: str = ""
    neg: bool = False
    source: str = "llm"  # llm | lexicon

    @property
    def hard(self) -> bool:
        return self.key in HARD


def normalize(keys: Iterable[SoundKey]) -> tuple[SoundKey, ...]:
    """Negated soft keys turned into their opposite, duplicates and conflicts dropped,
    capped at MAX_KEYS. The order of first mention is kept."""
    out: list[SoundKey] = []
    seen: dict[str, SoundKey] = {}
    for k in keys:
        if k.key not in KEYS:
            continue
        if k.neg and k.key in OPPOSITE:
            k = SoundKey(OPPOSITE[k.key], k.word, False, k.source)
        if k.key in seen:
            continue
        seen[k.key] = k
        out.append(k)
    positive = {k.key for k in out if not k.neg}
    clash = {key for pair in CONFLICTS if pair <= positive for key in pair}
    return tuple(k for k in out if not (k.key in clash and not k.neg))[:MAX_KEYS]


def merge(llm: Iterable[SoundKey], lexicon: Iterable[SoundKey]) -> tuple[SoundKey, ...]:
    """The planner's keys and the lexicon's, as one set. On a key both found with a
    different `neg`, the lexicon wins: it reads «без X» literally. A word the lexicon has
    already read as one key is not another one too: «с духовыми» is `winds`, and the
    model's `brass` on the same word would demand trumpets of every track."""
    lex = {k.key: k for k in lexicon}
    read = set().union(*(_content(k.word) for k in lex.values()))
    out = []
    for k in llm:
        if k.key in lex:
            out.append(lex.pop(k.key))
        elif not _content(k.word) & read:
            out.append(k)
    return normalize([*out, *lex.values()])


def _content(word: str) -> set[str]:
    """The words of a phrase that carry its meaning: «без вокала» → {«вокала»}."""
    return {w for w in fold(word or "").split() if len(w) > 3}


# ---------------------------------------------------------------- lexicon

# Folded text (fold: lower case, й→и, ё→е, punctuation → space). Longer phrases first:
# a matched span is blanked, so «бас-гитара» is not read again as «гитара».
_LEX: tuple[tuple[str, str], ...] = (
    (r"бас\s*гитар\w*|bass\s*guitar\w*|контрабас\w*|double\s*bass", "bass_guitar"),
    (r"синт\w*\s*бас\w*|synth\s*bass", "synth_bass"),
    (r"808(?:\s*бас\w*)?|восемьсот\s*восем\w*", "bass_808"),
    (r"жив\w*\s+(?:барабан\w*|ударн\w*)|live\s+drums?", "live_drums"),
    (r"драм\s*машин\w*|драмк\w*|drum\s*machines?", "drum_machine"),
    # any drums: only «без барабанов» means something (neither kind); «с барабанами» is
    # nearly the whole library
    (r"барабан\w*|ударн\w*|drums?", "drums_any"),
    (
        r"без\s+(?:слов|вокал\w*|голос\w*|пения)|инструментал\w*|instrumentals?"
        r"|(?:no|without)\s+(?:vocals?|voice|singing)",
        "no_vocals",
    ),
    (
        r"медн\w*\s+духов\w*|труб(?:а|ы|ой|у|е|ами|ах)?|тромбон\w*|trumpets?|trombones?|horns?",
        "brass",
    ),
    (
        r"сакс\w*|saxophone\w*|sax|флейт\w*|кларнет\w*|духов\w*|flutes?|clarinets?|woodwinds?",
        "winds",
    ),
    (
        r"скрип\w*|струнн\w*|виолончел\w*|оркестр\w*|violins?|cellos?|strings|orchestra\w*",
        "strings",
    ),
    (r"пианин\w*|фортепиан\w*|роял\w*|фоно|piano\w*", "piano"),
    (
        r"клавишн\w*|синтезатор\w*|орган(?:а|ом|е|ы)?|клавесин\w*|keyboards?|organ|synthesizers?",
        "keys",
    ),
    # the profile does not tell electric from acoustic: «с электрогитарой» still selects a
    # guitar (CLAP refines it), but «без электрогитары» must not exclude every guitar
    (r"(?:электро|акустич\w*\s+)гитар\w*|(?:electric|acoustic)\s+guitars?", "guitar_kind"),
    (r"гитар\w*|guitars?", "guitar"),
)
_POSITIVE_ONLY = {"guitar_kind": "guitar"}
_LEX_RE = tuple((re.compile(rf"\b(?:{p})\b"), key) for p, key in _LEX)
_NEG_BEFORE = re.compile(r"\b(?:без|without|no)\s*$")
_WITH_VOICE = re.compile(r"\b(?:с|со)\s+(?:вокал\w*|голос\w*|пением)\b|\bwith\s+vocals?\b")
_QUOTED = re.compile(r"«[^»]*»|\"[^\"]*\"|“[^”]*”")


def lexicon(message: str, *, names: Iterable[str | None] = ()) -> list[SoundKey]:
    """Hard keys the user's sentence names in plain words — the instruments, the drums,
    the voice. `names` are the song and the artist the planner pulled out: a word that sits
    inside one of them («Piano Man», «Guitar Wolf») is a name, not an ask."""
    text = _QUOTED.sub(" ", message or "")
    readings = [fold(text)]
    if readings[0] and not re.search(r"[а-я]", readings[0]):
        # «spokoinye pesni s gitaroi»: the search's as_cyrillic() wants a known Russian word
        # first and knows few; here only instrument stems are read off the result, and an
        # English sentence spelled in Cyrillic («пиано», «гуитар») matches none of them
        readings.append(_lat_to_cyr(readings[0]))
    taken = [fold(n) for n in names if n]
    found: dict[str, SoundKey] = {}
    for reading in readings:
        t = f" {reading} "
        for rx, key in _LEX_RE:
            for m in list(rx.finditer(t)):
                span = m.group(0).strip()
                if any(span in name for name in taken):
                    continue
                neg = key != "no_vocals" and bool(_NEG_BEFORE.search(t[: m.start()]))
                if key == "drums_any":
                    if neg:
                        for kind in ("live_drums", "drum_machine"):
                            found.setdefault(kind, SoundKey(kind, span, True, "lexicon"))
                    continue
                if key in _POSITIVE_ONLY:
                    if neg:
                        continue
                    key = _POSITIVE_ONLY[key]
                found.setdefault(key, SoundKey(key, span, neg, "lexicon"))
            t = rx.sub(lambda m: " " * len(m.group(0)), t)
        if _WITH_VOICE.search(reading) and "no_vocals" not in found:
            found["no_vocals"] = SoundKey("no_vocals", "с голосом", True, "lexicon")
    return list(found.values())


# Words that name a soft key outright, as folded stems. A soft key the model reads off a
# metaphor — «тягучее» → calm, «солнечное» → energetic, «тяжёлое» → bass_heavy — outweighed
# CLAP, which is what hears a mood (eval 2026-11-12, G1–G3, H5: 1–3 of the top 10 left).
_SOFT_STEMS: dict[str, tuple[str, ...]] = {
    k: tuple(fold(s) for s in v.split())
    for k, v in {
        "calm": "спокойн медлен тих мягк нежн неспешн расслабл чил умиротвор сонн "
        "calm slow chill mellow relax quiet soft",
        "energetic": "бодр пободр быстр энергичн драйв агрессивн резк зажигат "
        "fast energetic upbeat aggressive",
        "odd": "странн необычн эксперимент чудн психодел авангард "
        "weird strange experimental unusual avant",
        "tech": "сложн техничн навороч многослойн complex intricate",
        "spacious": "простор возду spacious airy",
        "intimate": "камерн интимн intimate",
        "wide": "широк объемн стерео wide stereo",
        "bass_heavy": "бас жирн bass",
    }.items()
}


def plain_word(key: str, word: str, neg: bool = False) -> bool:
    """Whether the model's `word` names `key` itself rather than hints at it.

    A hard key needs the lexicon to read that very word as it — with the same sign:
    «без электрогитары» is not «без гитары», «живым звуком» is not live drums, «бочка
    качала» is not a kind of drums (eval D4, D6, K3). The voice is the exception: «где
    почти не поют», «типа инструментала» are said too many ways for the lexicon. A soft
    key needs a word from ``_SOFT_STEMS``.
    """
    if key in HARD:
        if key == "no_vocals":
            return True
        probe = word
        if neg and not re.search(r"\b(?:без|without|no)\b", fold(word)):
            probe = f"без {word}"
        return any(k.key == key and k.neg == neg for k in lexicon(probe))
    stems = _SOFT_STEMS.get(key, ())
    words = fold(word).split() + fold(_lat_to_cyr(fold(word))).split()
    return any(w.startswith(stems) for w in words)


# ---------------------------------------------------------------- the profile

_FEAT = {name: i for i, name in enumerate(FEAT_NAMES)}


@dataclass(slots=True)
class Profile:
    """The columns of `sound_profiles` a search reads, with the track they belong to."""

    track_id: str
    media_file_id: str
    duration_s: float | None
    year: int | None
    instruments: frozenset[str]
    traits: frozenset[str]
    drums: str | None
    vocals: str | None
    vocal_share: float | None
    pace: str | None
    feel: str | None
    odd: int | None
    tech: int | None
    space: int | None
    echo: str | None
    width: str | None
    feat: dict[str, float] = field(default_factory=dict)

    @classmethod
    def from_row(cls, r: Any) -> Profile:
        feat = list(r.feat or [])
        if len(feat) != len(FEAT_NAMES):
            # a profile from another derive version: its columns would be read as the wrong
            # features, so it is treated as having none
            feat = []
        return cls(
            track_id=str(r.track_id),
            media_file_id=str(r.media_file_id),
            duration_s=(r.duration_ms / 1000.0) if r.duration_ms else None,
            year=r.year,
            instruments=frozenset(r.instruments or ()),
            traits=frozenset(r.traits or ()),
            drums=r.drums,
            vocals=r.vocals,
            vocal_share=r.vocal_share,
            pace=r.pace,
            feel=r.feel,
            odd=r.odd,
            tech=r.tech,
            space=r.space,
            echo=r.echo,
            width=r.width,
            feat={n: float(feat[i]) for n, i in _FEAT.items()} if feat else {},
        )

    def f(self, name: str) -> float:
        return self.feat.get(name, 0.0)

    @property
    def song_length(self) -> bool:
        return self.duration_s is None or self.duration_s >= MIN_SONG_S


def _has(p: Profile, names: set[str], in_places: Iterable[str] = ()) -> bool:
    return bool(p.instruments & names) or any(f"{n}.in_places" in p.traits for n in in_places)


_HARD_TEST: dict[str, Callable[[Profile], bool]] = {
    "guitar": lambda p: _has(p, {"guitar", "electric_guitar", "acoustic_guitar", "slide_guitar"}),
    "piano": lambda p: _has(p, {"piano", "electric_piano"}),
    "keys": lambda p: _has(p, {"piano", "electric_piano", "synthesizer", "organ", "harpsichord"}),
    "strings": lambda p: _has(p, {"strings"}, {"strings"}),
    "brass": lambda p: _has(p, {"brass"}, {"brass"}),
    "winds": lambda p: _has(p, {"winds", "woodwind", "sax", "brass"}, {"winds", "brass"}),
    "bass_808": lambda p: _has(p, {"bass_808"}),
    "synth_bass": lambda p: _has(p, {"synth_bass"}),
    "bass_guitar": lambda p: _has(p, {"bass_guitar", "double_bass"}),
    "live_drums": lambda p: p.drums == "live",
    "drum_machine": lambda p: p.drums == "machine",
    "no_vocals": lambda p: p.vocals == "none" or "few_vocals" in p.traits,
}
# how a hard key orders what it selected, when no soft key does
_HARD_ORDER: dict[str, Callable[[Profile], float]] = {
    "guitar": lambda p: p.f("claim.guitar"),
    "piano": lambda p: p.f("claim.piano"),
    "keys": lambda p: p.f("claim.piano") + p.f("share.piano"),
    "strings": lambda p: p.f("claim.strings"),
    "brass": lambda p: p.f("claim.brass"),
    "winds": lambda p: p.f("claim.brass") + p.f("share.other"),
    "bass_808": lambda p: p.f("share.bass"),
    "synth_bass": lambda p: p.f("share.bass"),
    "bass_guitar": lambda p: p.f("share.bass"),
    "live_drums": lambda p: p.f("drums_live"),
    "drum_machine": lambda p: -p.f("drums_live"),
    "no_vocals": lambda p: -(p.vocal_share or 0.0),
}


def passes(p: Profile, k: SoundKey) -> bool:
    """A hard key, answered by the profile; a negated one excludes."""
    has = _HARD_TEST[k.key](p)
    return not has if k.neg else has


def passes_all(p: Profile | None, hard: Iterable[SoundKey]) -> bool:
    """A track without a profile passes no hard key: there is nothing to confirm it by."""
    keys = list(hard)
    if not keys:
        return True
    return p is not None and all(passes(p, k) for k in keys)


def _pulse(p: Profile) -> float:
    return (p.f("pace") + p.f("hits_per_beat") + p.f("fill")) / 3


def _soft(p: Profile, key: str) -> float | None:
    if key == "calm":
        return (1 - _pulse(p) - (0.2 if p.feel == "driving" else 0.0)) if p.song_length else None
    if key == "energetic":
        return _pulse(p) + (0.2 if p.feel == "driving" else 0.0)
    if key == "odd":
        if p.odd is None or not p.song_length:
            return None
        if p.feel == "no_pulse" and p.vocals != "voice":
            return None
        return p.odd / 100
    if key == "tech":
        return p.tech / 100 if p.tech is not None and p.song_length else None
    if key == "spacious":
        if p.space is None:  # mono: no stereo picture to call spacious or not
            return None
        return p.space / 100 + (0.1 if p.echo in ("noticeable", "hall") else 0.0)
    if key == "intimate":
        return {"dry": 1.0, "little": 0.6}.get(p.echo or "", 0.0)
    if key == "wide":
        return (
            None
            if p.width is None
            else {"wide": 1.0, "very_wide": 1.0, "medium": 0.5}.get(p.width, 0.0)
        )
    if key == "bass_heavy":
        return p.f("share.bass")
    raise KeyError(key)


def score(p: Profile, k: SoundKey) -> float | None:
    """A soft key's score, higher is better; None keeps the track out of this ranking (no
    measure, or a skit asked to be «unusual»)."""
    s = _soft(p, k.key)
    if s is None or not k.neg:
        return s
    if k.key in ("calm", "energetic", "spacious"):  # normalize() has already flipped these
        return s
    return 1 - s


def rankings(profiles: dict[str, Profile], keys: Iterable[SoundKey]) -> list[list[str]]:
    """One ranked list of track ids per soft key; with only hard keys, one list in the order
    their measure gives. Each list holds only the tracks it can score."""
    keys = list(keys)
    soft = [k for k in keys if not k.hard]
    out: list[list[str]] = []
    for k in soft:
        scored = [(s, tid) for tid, p in profiles.items() if (s := score(p, k)) is not None]
        out.append([tid for _, tid in sorted(scored, key=lambda x: -x[0])])
    if not soft:
        hard = [k for k in keys if k.hard and not k.neg]
        if hard:

            def order(p: Profile) -> float:
                return sum(_HARD_ORDER[k.key](p) for k in hard)

            out.append([tid for tid, _ in sorted(profiles.items(), key=lambda kv: -order(kv[1]))])
    return out


# ---------------------------------------------------------------- words for the caption

_WITH = {
    "guitar": ("с гитарой", "без гитары"),
    "piano": ("с пианино", "без пианино"),
    "keys": ("с клавишными", "без клавишных"),
    "strings": ("со струнными", "без струнных"),
    "brass": ("с медными духовыми", "без медных духовых"),
    "winds": ("с духовыми", "без духовых"),
    "bass_808": ("с 808-басом", "без 808-баса"),
    "synth_bass": ("с синт-басом", "без синт-баса"),
    "bass_guitar": ("с бас-гитарой", "без бас-гитары"),
    "live_drums": ("с живыми барабанами", "без живых барабанов"),
    "drum_machine": ("с драм-машиной", "без драм-машины"),
    "no_vocals": ("почти без голоса", "с голосом"),
    "calm": ("спокойные", "спокойные"),
    "energetic": ("бодрые", "бодрые"),
    "odd": ("необычные", "простые"),
    "tech": ("сложные", "незамысловатые"),
    "spacious": ("просторные", "просторные"),
    "intimate": ("камерные", "камерные"),
    "wide": ("широкие по звуку", "узкие по звуку"),
    "bass_heavy": ("с плотным басом", "с лёгким басом"),
}
_WITH_EN = {
    "guitar": "guitar",
    "piano": "piano",
    "keys": "keys",
    "strings": "strings",
    "brass": "brass",
    "winds": "winds",
    "bass_808": "808 bass",
    "synth_bass": "synth bass",
    "bass_guitar": "bass guitar",
    "live_drums": "live drums",
    "drum_machine": "a drum machine",
    "no_vocals": "few vocals",
    "calm": "calm",
    "energetic": "energetic",
    "odd": "unusual",
    "tech": "intricate",
    "spacious": "spacious",
    "intimate": "intimate",
    "wide": "wide",
    "bass_heavy": "bass-heavy",
}


def phrase(keys: Iterable[SoundKey], lang: str = "ru") -> str:
    """«с гитарой, необычные» — what was asked, in words; English as a plain list."""
    ks = list(keys)
    if (lang or "").lower().startswith("ru"):
        return ", ".join(_WITH[k.key][1 if k.neg else 0] for k in ks)
    return ", ".join(("no " if k.neg else "") + _WITH_EN[k.key] for k in ks)


# ---------------------------------------------------------------- reading the table


def profile_select(account_id: uuid.UUID) -> Any:
    """The SELECT of an account's tracks with their profiles (the caller adds the WHERE)."""
    import sqlalchemy as sa

    from musix.contexts.library.models import tracks
    from musix.contexts.sound.models import sound_profiles as sp

    return (
        sa.select(
            tracks.c.id.label("track_id"),
            tracks.c.media_file_id,
            tracks.c.duration_ms,
            tracks.c.year,
            sp.c.instruments,
            sp.c.traits,
            sp.c.drums,
            sp.c.vocals,
            sp.c.vocal_share,
            sp.c.pace,
            sp.c.feel,
            sp.c.odd,
            sp.c.tech,
            sp.c.space,
            sp.c.echo,
            sp.c.width,
            sp.c.feat,
        )
        .join(sp, sp.c.media_file_id == tracks.c.media_file_id)
        .where(tracks.c.account_id == account_id, tracks.c.deleted_at.is_(None))
    )
