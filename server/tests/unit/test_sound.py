"""The sound engine's pure parts: derive against the research prototype's own output, and the
GPU lease policy (spec sound-engine §4, §8, §14)."""

import json
from pathlib import Path

import pytest

from musix.contexts.sound import derive as D
from musix.contexts.sound.lease import World, decide

FIX = Path(__file__).parent.parent / "fixtures" / "sound"


@pytest.mark.parametrize("name", ["power", "exits", "frozen"])
def test_derive_says_what_the_prototype_said(name: str) -> None:
    """Measures of three demo tracks (stored by ml-sound's measure() from the prototype's
    stems); `expected` is the prototype's feat5 output the owner reviewed."""
    fx = json.loads((FIX / f"{name}.json").read_text())
    f = D.features(fx["measures"], D.Genius(**fx["genius"]))
    exp = fx["expected"]
    assert {s: f["scales"][s]["value"] for s in ("space", "tech", "odd")} == exp["scales"]
    assert f["tempo"]["words"] == exp["tempo"]
    assert f["traits"] == exp["traits"]
    assert f["names"] == exp["names"]
    assert [[m["t"], D.moment_ru(m)] for m in f["moments"]] == exp["moments"]
    assert [[s["start"], s["label"]] for s in f["sections"]] == exp["sections"]

    row = D.profile(f, fx["measures"])
    assert len(row["feat"]) == len(D.FEAT_NAMES)
    assert all(0 <= x <= 1 for x in row["feat"])
    # the stored keys render back to the prototype's sentences
    assert [D.moment_text(m, row["sections"]) for m in row["moments"]] == [
        t for _, t in exp["moments"]
    ]
    json.dumps(row)  # the row is plain JSON


def test_power_keeps_the_owners_rulings() -> None:
    """Power (2026-10-18 marks): brisk and driving, not «неспешный»; its strings are a claim,
    its 1:15 / 2:40 voice samples are not named as instruments."""
    fx = json.loads((FIX / "power.json").read_text())
    row = D.derive(fx["measures"], D.Genius(**fx["genius"]))
    assert (row["pace"], row["feel"]) == ("brisk", "driving")
    assert "strings" in row["instruments"]
    assert row["drums"] == "machine"
    at_2_40 = next(m for m in row["moments"] if m["t"] == 160.0)
    assert at_2_40["kind"] == "part_in"
    assert "name" not in at_2_40


def test_stage_names_only_what_the_evidence_says() -> None:
    """The owner's per-stem review (2026-10-25): no claim and no clear tags — off the stage
    (Stronger's "guitar" stem); a voice in the "other" stem is a vocal sample (Bound 2); the
    "other" stem stays «синты» on weak synth tags; a claim plus clear synths names both."""
    msn = D.melodic_stage_name
    assert msn("guitar", {"guitar": None}, {"guitar": 0.22, "voice": 0.05, "keys": 0.01}) is None
    assert msn("guitar", {"guitar": "гитара"}, {"guitar": 0.6}) == "guitar"
    assert msn("other", {"other": "синты и прочее"}, {"voice": 0.4, "synth": 0.02}) == "vocal_sample"
    assert msn("other", {"other": "синты и прочее"}, {"synth": 0.05}) == "synths"
    assert msn("other", {"other": "струнные"}, {"synth": 0.09, "strings": 0.05}) == ["strings", "synths"]
    assert msn("piano", {"piano": None}, {"keys": 0.02}) is None
    assert msn("piano", {"piano": None}, {"keys": 0.45, "guitar": 0.1}) == "keys"


def test_bass_by_evidence() -> None:
    """808 tails moved from the kick name an 808; the tagger's «бас-гитара» over a drum machine
    is only «бас» (bad guy, Niggas in Paris); a pure sub is a synth bass (Rockstar)."""
    g = D.Genius(tags=[], credits={}, samples=[])
    an = {"names": {"bass": "бас-гитара"}}
    assert D.bass_name(an, {"b808": {"hits": 593, "ring": 170, "tail_db": 4.5}}, "драм-машина", g) == "808-бас"
    assert D.bass_name(an, {"b808": {"hits": 300, "ring": 0, "tail_db": None}, "bass_harm": -24.0}, "драм-машина", g) == "бас"
    assert D.bass_name(an, {"bass_harm": -63.5}, "драм-машина", g) == "синт-бас"
    assert D.bass_name(an, {"bass_harm": -20.0}, "живые барабаны", g) == "бас-гитара"


def _w(**kw: object) -> World:
    base: dict[str, object] = dict(
        holder="ml", ml_gpu="loaded", sound_up=True, sound_batch=None, batch_job=False,
        uploads=0, backfill=0, ingest_busy=False, gpu_waiting=0,
    )  # fmt: skip
    return World(**(base | kw))  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("world", "acts"),
    [
        (_w(), []),
        (_w(uploads=3), ["to_sound"]),
        (_w(uploads=3, ingest_busy=True), []),  # the upload's CPU work first
        (_w(uploads=3, sound_up=False), []),
        (_w(backfill=500, gpu_waiting=2), []),  # new songs' text vectors first
        (_w(backfill=500, gpu_waiting=2, ml_gpu=None), ["to_sound"]),  # ml off: they'd wait forever
        (_w(ml_gpu="lent"), ["acquire_ml"]),  # a swap back died halfway
        (_w(holder="sound", uploads=1, ml_gpu="lent"), ["start_batch"]),
        (_w(holder="sound", ml_gpu="loaded", uploads=1), ["release_ml", "start_batch"]),
        (_w(holder="sound", ml_gpu="lent", sound_batch="b1", batch_job=True), []),
        (_w(holder="sound", ml_gpu="lent", sound_batch="b1"), ["reattach"]),
        (_w(holder="sound", ml_gpu="lent", backfill=9, gpu_waiting=1), ["to_ml"]),
        (_w(holder="sound", ml_gpu="lent"), ["to_ml"]),
        (_w(holder="sound", ml_gpu="lent", uploads=2, sound_up=False), ["to_ml"]),
    ],
)
def test_lease_policy(world: World, acts: list[str]) -> None:
    assert decide(world) == acts
