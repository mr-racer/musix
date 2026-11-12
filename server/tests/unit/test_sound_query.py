"""Sound keys of a search request (spec 2026-11-12-sound-search-profile-design §3–4)."""

from types import SimpleNamespace
from typing import Any

import pytest

from musix.contexts.sound import query as Q
from musix.contexts.sound.derive import FEAT_NAMES


def keys(found: list[Q.SoundKey]) -> set[tuple[str, bool]]:
    return {(k.key, k.neg) for k in found}


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("экспериментальная песня Kanye West с гитарой", {("guitar", False)}),
        ("чё-нить чилловое с гитаркой", {("guitar", False)}),
        ("что-нибудь с саксофоном", {("winds", False)}),
        ("спокойное с пианино и скрипками", {("piano", False), ("strings", False)}),
        ("Lana Del Rey с оркестром", {("strings", False)}),
        ("песни с 808", {("bass_808", False)}),
        ("музыка без слов", {("no_vocals", False)}),
        ("инструментальное с пианино", {("no_vocals", False), ("piano", False)}),
        ("Nickelback без гитары", {("guitar", True)}),
        ("хип-хоп без барабанов", {("live_drums", True), ("drum_machine", True)}),
        ("песни с барабанами", set()),
        ("что-нибудь без драм-машины, с живым звуком", {("drum_machine", True)}),
        ("трек с живыми барабанами", {("live_drums", False)}),
        ("песни Eminem с вокалом и пианино", {("no_vocals", True), ("piano", False)}),
        ("кто играет на бас-гитаре", {("bass_guitar", False)}),
        ("бодрое с медными духовыми", {("brass", False)}),
        ("calm songs with piano", {("piano", False)}),
        ("instrumental with strings", {("no_vocals", False), ("strings", False)}),
        ("spokoinye pesni s gitaroi", {("guitar", False)}),
        ("живые выступления Muse", set()),
        ("тяжёлое, как Royal Blood", set()),
        ("органичное звучание", set()),
        ("с электрогитарой", {("guitar", False)}),
        ("рок без электрогитары, что-то акустическое", set()),
    ],
)
def test_lexicon_reads_the_instruments(message: str, expected: set[tuple[str, bool]]) -> None:
    assert keys(Q.lexicon(message)) == expected


def test_a_name_is_not_an_ask() -> None:
    assert Q.lexicon("включи Piano Man", names=["Piano Man"]) == []
    assert Q.lexicon("что-нибудь от Guitar Wolf", names=["Guitar Wolf"]) == []
    assert Q.lexicon("включи «Гитара и рояль»") == []


def test_normalize_flips_conflicts_and_caps() -> None:
    k = Q.SoundKey
    assert keys(list(Q.normalize([k("calm", neg=True)]))) == {("energetic", False)}
    assert keys(list(Q.normalize([k("calm"), k("energetic"), k("guitar")]))) == {("guitar", False)}
    assert keys(list(Q.normalize([k("live_drums"), k("drum_machine")]))) == set()
    assert keys(list(Q.normalize([k("live_drums", neg=True), k("drum_machine", neg=True)]))) == {
        ("live_drums", True),
        ("drum_machine", True),
    }
    assert keys(list(Q.normalize([k("nonsense"), k("guitar"), k("guitar")]))) == {("guitar", False)}
    assert len(Q.normalize([k(x) for x in ("guitar", "piano", "strings", "brass", "odd")])) == 4


def test_merge_lets_the_lexicon_read_negation() -> None:
    llm = [Q.SoundKey("guitar", "гитары", neg=False), Q.SoundKey("odd", "странное")]
    lex = [Q.SoundKey("guitar", "без гитары", neg=True, source="lexicon")]
    assert keys(list(Q.merge(llm, lex))) == {("guitar", True), ("odd", False)}


def profile(**kw: Any) -> Q.Profile:
    feat = dict.fromkeys(FEAT_NAMES, 0.0) | kw.pop("feat", {})
    row = SimpleNamespace(
        track_id=kw.pop("track_id", "t"),
        media_file_id="m",
        duration_ms=kw.pop("duration_ms", 200_000),
        year=2010,
        instruments=kw.pop("instruments", []),
        traits=kw.pop("traits", []),
        drums=kw.pop("drums", None),
        vocals=kw.pop("vocals", "voice"),
        vocal_share=kw.pop("vocal_share", 0.6),
        pace=kw.pop("pace", "medium"),
        feel=kw.pop("feel", None),
        odd=kw.pop("odd", 20),
        tech=kw.pop("tech", 40),
        space=kw.pop("space", 50),
        echo=kw.pop("echo", "little"),
        width=kw.pop("width", "medium"),
        feat=[feat[n] for n in FEAT_NAMES],
    )
    assert not kw, kw
    return Q.Profile.from_row(row)


def test_hard_keys_answer_from_the_window() -> None:
    gtr = profile(instruments=["guitar"])
    assert Q.passes(gtr, Q.SoundKey("guitar"))
    assert not Q.passes(gtr, Q.SoundKey("guitar", neg=True))
    assert Q.passes(profile(traits=["strings.in_places"]), Q.SoundKey("strings"))
    assert Q.passes(profile(instruments=["brass"]), Q.SoundKey("winds"))
    assert Q.passes(profile(traits=["few_vocals"]), Q.SoundKey("no_vocals"))
    assert Q.passes(profile(vocals="none"), Q.SoundKey("no_vocals"))
    both = [Q.SoundKey("live_drums", neg=True), Q.SoundKey("drum_machine", neg=True)]
    assert Q.passes_all(profile(drums=None), both)
    assert not Q.passes_all(profile(drums="machine"), both)
    # no profile, nothing to confirm a guitar — or its absence — by
    assert not Q.passes_all(None, [Q.SoundKey("guitar")])
    assert not Q.passes_all(None, [Q.SoundKey("guitar", neg=True)])
    assert Q.passes_all(None, [])


def test_a_skit_is_not_unusual() -> None:
    skit = profile(track_id="skit", odd=92, duration_ms=57_000, feel="no_pulse")
    song = profile(track_id="song", odd=64, instruments=["guitar"])
    plain = profile(track_id="plain", odd=10)
    ranks = Q.rankings({p.track_id: p for p in (skit, song, plain)}, [Q.SoundKey("odd")])
    assert ranks == [["song", "plain"]]


def test_calm_orders_by_pulse_and_drive() -> None:
    slow = profile(track_id="slow", feat={"pace": 0.2, "hits_per_beat": 0.2, "fill": 0.2})
    drive = profile(
        track_id="drive", feel="driving", feat={"pace": 0.3, "hits_per_beat": 0.3, "fill": 0.3}
    )
    fast = profile(track_id="fast", feat={"pace": 0.9, "hits_per_beat": 0.6, "fill": 0.4})
    pool = {p.track_id: p for p in (fast, drive, slow)}
    assert Q.rankings(pool, [Q.SoundKey("calm")]) == [["slow", "drive", "fast"]]
    assert Q.rankings(pool, [Q.SoundKey("energetic")]) == [["fast", "drive", "slow"]]


def test_hard_keys_alone_order_by_their_claim() -> None:
    a = profile(track_id="a", instruments=["guitar"], feat={"claim.guitar": 0.3})
    b = profile(track_id="b", instruments=["guitar"], feat={"claim.guitar": 0.8})
    assert Q.rankings({"a": a, "b": b}, [Q.SoundKey("guitar")]) == [["b", "a"]]
    assert Q.rankings({"a": a}, [Q.SoundKey("guitar", neg=True)]) == []


def test_mono_and_old_profiles_are_neutral() -> None:
    mono = profile(track_id="mono", space=None, width=None)
    assert Q.rankings({"mono": mono}, [Q.SoundKey("spacious")]) == [[]]
    old = Q.Profile.from_row(SimpleNamespace(**{**vars(_row()), "feat": [0.5] * 3}))
    assert old.feat == {}


def _row() -> SimpleNamespace:
    p = profile()
    return SimpleNamespace(
        track_id="t",
        media_file_id="m",
        duration_ms=200_000,
        year=2010,
        instruments=list(p.instruments),
        traits=list(p.traits),
        drums=p.drums,
        vocals=p.vocals,
        vocal_share=p.vocal_share,
        pace=p.pace,
        feel=p.feel,
        odd=p.odd,
        tech=p.tech,
        space=p.space,
        echo=p.echo,
        width=p.width,
        feat=[0.0] * len(FEAT_NAMES),
    )


def test_phrase() -> None:
    ks = [Q.SoundKey("guitar"), Q.SoundKey("odd"), Q.SoundKey("piano", neg=True)]
    assert Q.phrase(ks) == "с гитарой, необычные, без пианино"
    assert Q.phrase(ks, "en") == "guitar, unusual, no piano"


def test_eval_set_lexicon_never_invents() -> None:
    """Every hard key the lexicon reads off an eval query is one the query expects (the
    traps of group H expect none); what it misses is the planner's to find."""
    from pathlib import Path

    import yaml

    path = Path(__file__).parents[1] / "assistant" / "sound_queries.yaml"
    cases = yaml.safe_load(path.read_text())["queries"]
    assert len(cases) == 61
    for case in cases:
        if case.get("intent") in ("lyrics_search", "general"):
            continue  # the planner applies no sound keys there (H2, H3)
        names = [case.get("song"), case.get("artist")]
        keys = Q.normalize(Q.lexicon(case["q"], names=names))
        found = {("-" if k.neg else "") + k.key for k in keys}
        assert found <= set(case.get("keys") or []), (case["id"], found)
