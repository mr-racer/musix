"""Album pools and the artist timeline (spec §9, §10): demo4/album5.py + album6.py as the owner
last reviewed them (2026-10-18), on sound_profiles rows instead of feat5 files.

- An album is pooled from every analysed recording on it (shared data, like facts), and only
  with ≥3 of them; an artist's timeline needs ≥2 pooled albums.
- Comparisons are in TIME: an album against the artist's album before it, never «его другие
  работы»; the size of a shift is «чуть» / – / «заметно» by the real distance.
- The character is what we can back: Genius style tags shared by the songs (said as sound, never
  listed), how loud the bass is, the wall of sound, the instruments heard on most songs.
- A trait "came" / "went" only when it flips hard: in 2/3+ of one album's songs and at most
  1/5 of the other's (2 of 4 songs without «драм-машина» once read as "808s dropped the drum
  machine"); type labels have a neutral fallback, so their absence is never a contrast.

Not ported: the prototype's play preview (it read the tagger windows of the stems on disk).
Traits are keys here, so «струнные и медные духовые» of one prototype trait are two keys and
read «струнные, медные духовые»."""

from __future__ import annotations

import collections
import itertools
from dataclasses import dataclass, field
from typing import Any

from musix.contexts.sound import words as W

MIN_TRACKS = 3
MIN_ALBUMS = 2
SCALES = ("tech", "space", "odd")
TYPE_LABELS = {"drum_machine", "drums_live", "drums", "bass_808", "synth_bass", "bass_guitar"}
GENERIC_TAGS = {
    "in english", "usa", "uk", "rap", "hip-hop", "pop", "r&b", "soundtrack", "independent",
    "rock", "chicago rap", "east coast rap", "new york rap", "midwest rap", "alternative",
    "canada", "england",
    # about the words, not the sound
    "conscious rap", "anthem", "concept album", "protest song", "love", "breakup",
}  # fmt: skip
STYLE_WORDS = ("experiment", "avant", "industrial", "abstract", "deconstruct", "glitch", "noise")
# Genius style tags said as sound, so a text never lists tags (the timeline read «стал звучать
# как Pop Rap, Electropop и Electro-Hop»); a tag without a sound reading is left out
TAG_RU = {
    "electro-hop": "электронный клубный хип-хоп", "electropop": "электропоп",
    "synth-pop": "синти-поп, много синтов", "pop rap": "поп-рэп",
    "rap rock": "рэп с роковой подачей", "experimental": "экспериментальный",
    "experimental rap": "экспериментальный рэп", "industrial": "индустриальный",
    "industrial hip-hop": "индустриальный хип-хоп", "art pop": "арт-поп",
    "electronic": "электроника", "contemporary r&b": "современный ритм-н-блюз",
    "hip house": "хип-хаус, клубный ритм", "chipmunk soul": "ускоренные соул-семплы",
    "soul rap": "соул-рэп", "neo soul": "нео-соул", "downtempo": "даунтемпо",
    "chillhop": "расслабленный хип-хоп", "trap": "трэп", "orchestral": "оркестровый",
    "baroque pop": "барочный поп со струнными", "deconstructed club": "рваный клубный звук",
    "dance-pop": "танцевальный поп", "jazz rap": "джаз-рэп", "boom bap": "бум-бэп",
}  # fmt: skip
# (bar, up, down) of a shift between two albums; None = not said (the owner found it murky)
SHIFT: dict[str, tuple[float, str, str | None]] = {
    "tech": (6, "сложнее: больше слоёв и обработки", "проще: меньше слоёв и обработки"),
    "space": (8, "шире, больше эха", "ближе к уху, суше"),
    "odd": (8, "страннее: больше необычных звуков и решений", None),
    "fill": (0.03, "плотнее, как стена", None),
    "pace": (10, "быстрее", "медленнее"),
    "bass": (0.12, "басовитее: бас громче и главнее", "тише бас"),
}


@dataclass
class Member:
    """One analysed recording of an album: its sound_profiles row plus its song's Genius tags."""

    title: str
    tech: int
    space: int | None
    odd: int
    facets: dict[str, dict[str, int]]
    traits: list[str]
    pace: str | None  # word key; feel when there is no pace («без чёткого ритма»)
    feel: str | None
    pace_bpm: float  # felt tempo ×1.5 at ≥2 drum hits a beat (features5's pace)
    fill: float | None
    bass: float | None  # the bass stem's share of the mix
    tags: list[str] = field(default_factory=list)


def member(title: str, p: Any, tags: list[str]) -> Member:
    """A sound_profiles row (mapping or Row) → Member."""
    from musix.contexts.sound.derive import FEAT_NAMES

    feat = dict(zip(FEAT_NAMES, p["feat"], strict=True))
    hits = feat["hits_per_beat"] * 4  # derive's lin(hits, 0, 4)
    return Member(
        title=title,
        tech=p["tech"],
        space=p["space"],
        odd=p["odd"],
        facets=p["facets"],
        traits=list(p["traits"]),
        pace=p["pace"],
        feel=p["feel"],
        pace_bpm=(p["felt_bpm"] or 0) * (1.5 if hits >= 2 else 1.0),
        fill=(p["evidence"].get("tech") or {}).get("fill"),
        bass=feat["share.bass"],
        tags=tags,
    )


def trait_ru(k: str) -> str:
    if k.startswith("echo."):
        return W.ECHO[k.removeprefix("echo.")]
    if k.endswith(".in_places"):
        return W.NAMES[k.removesuffix(".in_places")] + W.SUFFIX_IN_PLACES
    return W.TRAITS.get(k) or W.NAMES[k]


def tempo_ru(k: str) -> str:
    return W.PACE.get(k) or W.FEEL[k]


def tags_ru(tags: list[str]) -> list[str]:
    return list(dict.fromkeys(TAG_RU[t.lower()] for t in tags if t.lower() in TAG_RU))


def pool(ms: list[Member]) -> dict[str, Any]:
    """album5.pool + album6.pool6: the scales' mean / min / max with their songs, trait shares,
    the common traits and tempo words, the wall of sound, pace, bass and the shared style tags."""
    n = len(ms)
    out: dict[str, Any] = dict(n=n, titles=[m.title for m in ms])
    for s in SCALES:
        vals = [(getattr(m, s), m.title) for m in ms if getattr(m, s) is not None]
        fs = [m.facets.get(s) or {} for m in ms if getattr(m, s) is not None]
        out[s] = (
            dict(
                mean=round(sum(v for v, _ in vals) / len(vals)),
                min=list(min(vals)),
                max=list(max(vals)),
                facets={
                    k: round(sum(f.get(k, 0) for f in fs) / len(fs))
                    for k in dict.fromkeys(k for f in fs for k in f)
                },
            )
            if vals
            else None
        )
    cnt = collections.Counter(t for m in ms for t in dict.fromkeys(m.traits))
    out["share"] = {t: round(c / n, 2) for t, c in cnt.items()}
    out["common"] = [t for t, c in cnt.most_common() if c >= max(2, round(0.6 * n))]
    words = collections.Counter(m.pace or m.feel for m in ms if m.pace or m.feel)
    out["tempo"] = [w for w, _ in words.most_common()]
    fills = [m.fill for m in ms if m.fill is not None]
    out["fill"] = round(sum(fills) / len(fills), 3) if fills else None
    out["pace"] = round(sum(m.pace_bpm for m in ms) / n)
    sh = [m.bass for m in ms if m.bass is not None]
    out["bass"] = round(sum(sh) / len(sh), 2) if sh else None
    tc = collections.Counter(t for m in ms for t in dict.fromkeys(m.tags))  # ties: song order
    out["style_tags"] = [
        t
        for t, c in tc.most_common()
        if c >= max(2, (n + 1) // 2) and t.lower() not in GENERIC_TAGS
    ][:6]
    out["style_odd"] = sum(
        1 for m in ms if any(w in t.lower() for t in m.tags for w in STYLE_WORDS)
    )
    return out


def _num(p: dict[str, Any], s: str) -> float | None:
    v = p[s]
    return float(v["mean"]) if isinstance(v, dict) else v


def degree(d: float, bar: float) -> str:
    """Three steps: «заметно проще» on BULLY was too strong for the owner («проще, но не очень
    простой») and «заметно шире» on 808s an overstatement; «заметно» is three bars and more."""
    return "заметно " if abs(d) >= 3 * bar else "" if abs(d) >= 2 * bar else "чуть "


def shifts(p: dict[str, Any], q: dict[str, Any]) -> list[str]:
    """What moved from album q to album p, in sound words."""
    out = []
    for s, (bar, up, down) in SHIFT.items():
        a, b = _num(p, s), _num(q, s)
        if a is None or b is None:
            continue
        d = a - b
        said = up if d > 0 else down
        if abs(d) >= bar and said:
            out.append(f"{degree(d, bar)}{said}")
    return out


def flips(p: dict[str, Any], q: dict[str, Any]) -> tuple[list[str], list[str]]:
    """(came, went) from album q to album p: traits that flipped hard, in Russian."""

    def hard(a: dict[str, float], b: dict[str, float]) -> list[str]:
        return [
            trait_ru(t)
            for t, v in a.items()
            if v >= 0.67 and b.get(t, 0) <= 0.2 and t not in TYPE_LABELS
        ]

    return hard(p["share"], q["share"]), hard(q["share"], p["share"])


def more_than_others(p: dict[str, Any], rest: list[dict[str, Any]]) -> list[str]:
    """album5.vs_others: traits clearly more common here than on the artist's other albums."""
    if not rest:
        return []
    out = []
    for t in dict.fromkeys([*p["share"], *(t for q in rest for t in q["share"])]):
        here = p["share"].get(t, 0)
        there = sum(q["share"].get(t, 0) for q in rest) / len(rest)
        if here - there >= 0.4 and t not in TYPE_LABELS:
            out.append(trait_ru(t))
    return out


def character(p: dict[str, Any]) -> list[str]:
    """What the album sounds like on its own, in plain words, each backed by a number or a tag."""
    out = []
    if tags_ru(p["style_tags"]):
        out.append("по меткам слушателей: " + ", ".join(tags_ru(p["style_tags"])))
    if p["style_odd"] >= max(2, (p["n"] + 1) // 2):
        out.append(
            f"{p['style_odd']} из {p['n']} песен слушатели помечают как экспериментальные / "
            "индустриальные"
        )
    if p["bass"] is not None and p["bass"] >= 0.5:
        out.append("бас главный: он занимает большую часть звука")
    if p["fill"] is not None and p["fill"] >= 0.3:
        out.append("звук плотный, как стена")
    common = [
        trait_ru(t) for t in p["common"] if t not in TYPE_LABELS and not t.startswith("echo.")
    ]
    if common:
        out.append("почти везде звучат: " + ", ".join(common))
    drums = [t for t in p["common"] if t in ("drum_machine", "drums_live")]
    if drums:
        out.append("барабаны: " + trait_ru(drums[0]))
    if p["tempo"]:
        out.append("темп чаще всего: " + tempo_ru(p["tempo"][0]))
    return out


Album = tuple[str, int | None, dict[str, Any]]  # (title, year, pool)


def album_facts(album: Album, prev: Album | None, more: list[str]) -> dict[str, Any]:
    title, year, p = album
    facts: dict[str, Any] = {
        "альбом": f"{title} ({year})",
        "песен_в_библиотеке": p["n"],
        "характер": character(p),
        "чаще_чем_на_других_альбомах": more,
    }
    if prev:
        came, went = flips(p, prev[2])
        facts["после_предыдущего"] = {
            "предыдущий": f"{prev[0]} ({prev[1]})",
            "изменения": (shifts(p, prev[2]) or ["по звуку почти без перемен"])
            + ([f"появились: {', '.join(came)}"] if came else [])
            + ([f"ушли: {', '.join(went)}"] if went else []),
        }
    return facts


def timeline_rows(items: list[Album]) -> list[str]:
    """One line per album after the first, the year with the new album («A (2005) → B (2007)»
    was retold as «in 2005 the sound…»)."""
    rows = []
    for (a1, y1, p1), (a2, y2, p2) in itertools.pairwise(items):
        moved = shifts(p2, p1)
        came, went = flips(p2, p1)
        txt = f"{a2} ({y2}), после {a1} ({y1}): " + (
            "; ".join(moved) if moved else "по звуку почти без перемен"
        )
        if came:
            txt += "; появилось: " + ", ".join(came)
        if went:
            txt += "; ушло: " + ", ".join(went)
        if tags_ru(p2["style_tags"]):
            txt += "; по меткам слушателей: " + ", ".join(tags_ru(p2["style_tags"])[:3])
        rows.append(txt + ".")
    return rows


def previous(albums: list[Album], i: int) -> Album | None:
    """The artist's album right before albums[i] by year (albums of unknown year never compare)."""
    y = albums[i][1]
    before = [a for a in albums if y is not None and a[1] is not None and a[1] < y]
    return max(before, key=lambda a: a[1] or 0) if before else None
