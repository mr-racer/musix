"""Measures → the sound profile (spec §8). A pure function of `sound_analysis.measures`,
the Genius page data and nothing else: no GPU, no audio, milliseconds per track, so every
threshold here changes with a server deploy and a `sound:derive_backfill`.

It is the research prototype's word and scale logic, ported line for line so prod says
what the owner reviewed (`/mnt/data/tmp/sound-stage/`):
- `report3.describe` / `report3.run` → `view()`: placement numbers, width/echo words, lanes;
- `demo4/features5.py` → `features()`: the three scales with facets, calibrated instrument
  claims, tempo words, moments, traits. Where features5 read a stem or the mix, it reads
  the number ml-sound stored in `measures.extra` under the same name.

`features()` keeps the prototype's Russian strings, so its output can be compared with the
prototype's `feat5/<k>.json` as it is; `profile()` turns them into the stored keys."""

from __future__ import annotations

import base64
import itertools
import re
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from musix.contexts.sound import words as W

DERIVE_VER = 1


@dataclass(frozen=True)
class Genius:
    """What derive reads of the Genius song page (song_tags / song_credits / song_relations)."""

    tags: list[str] = field(default_factory=list)
    credits: dict[str, list[str]] = field(default_factory=dict)
    samples: list[str] = field(default_factory=list)


def _f16(s: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(s), "<f2").astype(np.float32)


def _f32(s: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(s), "<f4").astype(np.float32)


def clip01(x: float) -> float:
    return float(min(1.0, max(0.0, x)))


def lin(x: float, lo: float, hi: float) -> float:
    """Fixed linear map: lo -> 0, hi -> 1 (bounds are constants, never fitted to the library)."""
    return clip01((x - lo) / (hi - lo))


# ── report3: placement numbers and the scene words ───────────────────────────

STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"]
STEM_NAMES = {
    "vocals": "голос",
    "drums": "барабаны",
    "bass": "бас",
    "guitar": "гитара",
    "piano": "клавишные",
    "other": "синты и прочее",
}
TAIL_REF = {"vocals": (-34, -20), "drums": (-40, -26), "bass": (-70, -40)}
TAIL_DEF = (-38, -22)
# typical 85 % roll-off of a close, bright hit per drum voice (Hz): duller reads as farther away
ROLL_REF = {"snare": 9000, "hh": 13000, "cym": 12000, "toms": 5000, "vocals": 7000}


def _onset_depth(o: dict[str, Any] | None, part: str) -> tuple[float | None, float | None]:
    """0..1 from the attack measures; None when there were too few clean hits to trust."""
    if not o or o["n_hits"] < 6 or o["tail_db"] is None:
        return None, None
    tail = clip01(
        (o["tail_db"] + 32) / 20
    )  # -32 dB after 150 ms = dry, -12 dB = rings on in a room
    dull = 1 - clip01(((o["crest_db"] or 8) - 8) / 10)  # 18 dB crest = sharp, close; 8 dB = smeared
    ref = ROLL_REF.get(part)
    dark = clip01((ref - o["rolloff"]) / ref * 2) if ref else 0.0
    return 0.55 * tail + 0.25 * dull + 0.2 * dark, tail


def _merge_segs(segs: list[list[float]], gap: float = 1.0) -> list[list[float]]:
    out: list[list[float]] = []
    for a, b in sorted(segs):
        if out and a - out[-1][1] <= gap:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [[round(a, 1), round(b, 1)] for a, b in out]


def describe(an: dict[str, Any]) -> dict[str, Any]:
    """report3.describe without the sentences (the review page's prose): the numbers and the
    word choices the profile keeps."""
    st, parts = an["st"], an["parts"]
    stems = [s for s in STEMS if s in st and s != "drums"] + (
        ["drums"] if "drums" in st and not parts else []
    )
    voices = stems + list(parts)
    loud = {s: st[s]["loud_a_db"] for s in stems}
    loud.update({p: parts[p]["st"]["loud_a_db"] for p in parts})
    nb = [v for v in voices if v != "bass"]
    ref = max(loud[v] for v in nb) if nb else 0
    place = {}
    for v in voices:
        p = st[v] if v in st else parts[v]["st"]
        quiet = clip01((ref - p["loud_a_db"]) / 15)
        dry, wetr = TAIL_REF.get(v if v in st else "drums", TAIL_DEF)
        rev = clip01((p["tail_db"] - dry) / (wetr - dry))
        conf = clip01(p["release_frames"] / 200)
        rev = conf * rev + (1 - conf) * clip01((p["steady_amb"] - 0.03) / 0.25)
        od, tail = _onset_depth(p.get("onset"), v)
        if v == "vocals" and an["vwet"] is not None:
            depth = 0.65 * clip01((an["vwet"] - 0.1) / 0.8) + 0.35 * quiet
            echo_v = clip01((an["vwet"] - 0.1) / 0.8)
        elif v in parts:
            # a drum voice: the hit tells more than the stereo tail (claps ring in a mono reverb)
            depth = (
                (0.55 * od + 0.2 * rev + 0.25 * quiet)
                if od is not None
                else (0.45 * rev + 0.1 * clip01((p["steady_amb"] - 0.03) / 0.3) + 0.45 * quiet)
            )
            echo_v = max(rev, tail or 0)
        else:
            base = 0.45 * rev + 0.1 * clip01((p["steady_amb"] - 0.03) / 0.3) + 0.45 * quiet
            depth = 0.75 * base + 0.25 * od if od is not None else base
            echo_v = max(rev, 0.8 * (tail or 0))
        ms = p.get("ms") or {}
        side = clip01(((ms.get("high", 0) + ms.get("air", 0)) / 2 - 0.05) / 0.3)
        # the side signal widens pads, guitars, cymbals; a voice and a kick keep the v2 measure
        width = p["spread"] + 0.5 * p["steady_amb"]
        if v not in ("vocals", "kick", "bass"):
            width = max(width, 0.8 * side)
        width = min(1.0, width)
        prt = p.get("parts", [])
        prom = clip01(1 + (p["loud_a_db"] - ref) / 22) if v != "bass" else 0.5
        ext = min(
            1.0,
            max(
                abs(p["center"]) + 1.4 * p["spread"],
                2 * p["steady_amb"],
                side,
                max([abs(q["pan"]) * min(1.0, 0.5 + q["presence"]) for q in prt] or [0]),
            ),
        )
        place[v] = dict(
            pan=prt[0]["pan"] if prt else p["center"],
            depth=float(depth),
            width=width,
            parts=prt,
            rev=echo_v,
            prom=prom,
            ext=ext,
        )
    if nb:
        pans = [
            q["pan"]
            for v in nb
            if place[v]["prom"] >= 0.4
            for q in (place[v]["parts"] or [{"pan": place[v]["pan"]}])
        ]
        span = clip01((max(pans) - min(pans)) / 2) if pans else 0.0
        mms = an["mix_ms"]
        sidew = clip01(((mms["high"] + mms["air"]) / 2 - 0.05) / 0.3)
        emax = max(place[v]["ext"] * (0.35 + 0.65 * place[v]["prom"]) for v in nb)
        width10 = 10 * (0.4 * span + 0.35 * sidew + 0.25 * emax)
        dd = np.array([place[v]["depth"] for v in nb])
        depth10 = 10 * (
            0.5 * clip01((dd.max() - dd.min()) / 0.8) + 0.5 * clip01(float(dd.mean()) / 0.4)
        )
    else:
        width10 = depth10 = 0.0
    others = [place[v]["rev"] for v in nb if v != "vocals"]
    vrev = place["vocals"]["rev"] if "vocals" in place else (np.mean(others) if others else 0)
    echo = 0.6 * vrev + 0.4 * (float(np.mean(others)) if others else vrev)
    echo_w = (
        "почти без эха"
        if echo < 0.2
        else "немного эха"
        if echo < 0.4
        else "заметное эхо"
        if echo < 0.6
        else "много эха, как в зале"
    )
    space = 0.5 * width10 / 10 + 0.5 * depth10 / 10
    width_w = (
        "узкая, почти моно"
        if width10 < 2.5
        else "средняя"
        if width10 < 4.5
        else "широкая"
        if width10 < 7
        else "очень широкая, от колонки до колонки"
    )
    names, pn = an["names"], an["part_names"]
    out_stems = []
    for v in voices:
        p = place[v]
        nm = pn[v] if v in parts else (names.get(v) or STEM_NAMES[v])
        out_stems.append(
            dict(
                stem=v, name=nm, pan=p["pan"], depth=p["depth"], width=p["width"], parts=p["parts"]
            )
        )
    return dict(
        width10=round(width10, 1),
        depth10=round(depth10, 1),
        width_w=width_w,
        echo=round(float(echo), 2),
        echo_w=echo_w,
        space=round(space, 2),
        stems=out_stems,
    )


def view(an: dict[str, Any]) -> dict[str, Any]:
    """report3.run: the analysis plus describe(), with the lanes the review page drew."""
    L, names, pn = an["lanes"], an["names"], an["part_names"]
    lanes = [("vocals", names["vocals"], L["vocals"])]
    lanes += [
        ("kick", "бочка", L["kick"]),
        ("snare", pn.get("snare", "малый барабан"), L["snare"]),
        ("hh", "тарелки", L["hats"]),
    ]
    lanes += [("bass", names["bass"], L["bass_all"])]
    for s in ("guitar", "piano", "other"):
        fl = an["inst_lanes"].get(s) or {}
        if fl:
            for fam, segs in fl.items():
                lanes.append((s, fam, _merge_segs(segs, 2.6)))
        else:
            lanes.append((s, names[s], L.get(s, [])))
    return dict(
        dur=an["res"]["dur"],
        tempo=an["tempo"],
        sections=an["sections"],
        sec_source=an["sec_source"],
        lanes=[
            dict(stem=s, name=n, segs=[[round(a, 1), round(b, 1)] for a, b in segs])
            for s, n, segs in lanes
            if segs
        ],
        loud=an["loud"],
        vwet=an["vwet"],
        per_section=an["per_section"],
        names=dict(names),
        **describe(an),
    )


# ── features5: helpers ────────────────────────────────────────────────────────

DRUM_LANES = ("kick", "snare", "hh")
MELODIC = ("guitar", "piano", "other")
GENERIC = {"синты и прочее", "клавишные", "лид-партия", "бас", "вокал", "голос", "барабаны"}

# AudioSet classes that are not instruments or voices: a confident one inside a song is an
# unusual sound (bury a friend's dentist drill). 10 s windows only (3 s windows give garbage).
ODD_SOUNDS = [
    "Dental drill, dentist's drill",
    "Drill",
    "Power tool",
    "Breathing",
    "Whispering",
    "Gasp",
    "Laughter",
    "Baby cry, infant cry",
    "Siren",
    "Gunshot, gunfire",
    "Explosion",
    "Glass",
    "Shatter",
    "Clock",
    "Tick-tock",
    "Tick",
    "Typing",
    "Camera",
    "Door",
    "Knock",
    "Footsteps",
    "Water",
    "Rain",
    "Thunder",
    "Wind noise (microphone)",
    "Bird",
    "Dog",
    "Car",
    "Vehicle",
    "Telephone",
    "Ringtone",
    "Alarm",
    "Static",
    "White noise",
    "Pink noise",
    "Sine wave",
    "Chirp tone",
    "Beep, bleep",
    "Heart sounds, heartbeat",
    "Whoosh, swoosh, swish",
    "Zipper (clothing)",
    "Coin (dropping)",
    "Cash register",
    "Slam",
    "Squeak",
    "Creak",
    "Mechanisms",
    "Ratchet, pawl",
    "Chainsaw",
    "Hammer",
    "Crumpling, crinkling",
    "Television",
    "Radio",
    "Cough",
    "Sneeze",
    "Snoring",
    "Burping, eructation",
    "Crowd",
    "Applause",
    "Cheering",
    "Children shouting",
    "Screaming",
    "Arrow",
    "Boing",
    "Writing",
    "Frog",
    "Cricket",
    "Insect",
    "Horse",
    "Cat",
]
ODD_RU = {
    "Dental drill, dentist's drill": "бормашина",
    "Drill": "дрель",
    "Power tool": "электроинструмент",
    "Breathing": "дыхание",
    "Whispering": "шёпот",
    "Gasp": "вздох",
    "Laughter": "смех",
    "Siren": "сирена",
    "Gunshot, gunfire": "выстрелы",
    "Explosion": "взрыв",
    "Glass": "стекло",
    "Shatter": "звон бьющегося",
    "Clock": "часы",
    "Tick-tock": "тиканье",
    "Tick": "щелчки",
    "Typing": "печать на клавиатуре",
    "Camera": "затвор камеры",
    "Door": "дверь",
    "Knock": "стук",
    "Footsteps": "шаги",
    "Water": "вода",
    "Rain": "дождь",
    "Thunder": "гром",
    "Bird": "птицы",
    "Dog": "собака",
    "Car": "машина",
    "Vehicle": "транспорт",
    "Telephone": "телефон",
    "Ringtone": "рингтон",
    "Alarm": "сигнал",
    "Static": "радиошум",
    "White noise": "шум",
    "Pink noise": "шум",
    "Sine wave": "чистый тон",
    "Chirp tone": "свист тона",
    "Beep, bleep": "писк",
    "Heart sounds, heartbeat": "сердцебиение",
    "Whoosh, swoosh, swish": "свист пролёта",
    "Cash register": "касса",
    "Coin (dropping)": "монеты",
    "Slam": "хлопок двери",
    "Squeak": "скрип",
    "Creak": "скрип",
    "Mechanisms": "механизм",
    "Crowd": "толпа",
    "Applause": "аплодисменты",
    "Cheering": "крики толпы",
    "Screaming": "крик",
    "Cough": "кашель",
    "Television": "телевизор",
    "Radio": "радио",
}
MASS_RU = {
    "Groan": "стоны",
    "Sigh": "вздохи",
    "Gasp": "вздохи",
    "Breathing": "дыхание",
    "Whispering": "шёпот",
    "Throbbing": "пульсирующий гул",
    "Heart murmur": "звук сердцебиения",
    "Heart sounds, heartbeat": "звук сердцебиения",
    "Sine wave": "чистый тон",
    "Ringtone": "писк как у рингтона",
    "Fire alarm": "сирена",
    "Siren": "сирена",
    "Smoke detector, smoke alarm": "сирена",
    "Vehicle": "шум мотора",
    "Laughter": "смех",
    "Grunt": "кряхтение",
    "Zing": "свист",
    "Electronic tuner": "писк",
    "Battle cry": "крики",
    "Basketball bounce": "удары мяча",
    "Gunshot, gunfire": "выстрелы",
    "Explosion": "взрыв",
    "Glass": "стекло",
    "Clock": "часы",
    "Tick-tock": "тиканье",
}


def _lane_mask(segs: list[list[float]], dur: float, fps: int = 2) -> np.ndarray:
    m = np.zeros(int(dur * fps) + 1, bool)
    for a, b in segs:
        m[int(a * fps) : int(b * fps) + 1] = True
    return m


def mmss(t: float) -> str:
    return f"{int(t // 60)}:{int(t % 60):02d}"


def _clean(
    segs: list[list[float]], gap: float = 4.0, min_len: float = 4.0
) -> list[tuple[float, float]]:
    """Merge lane pieces closer than `gap`, drop pieces shorter than `min_len`."""
    out: list[list[float]] = []
    for a, b in sorted(segs):
        if out and a - out[-1][1] < gap:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out if b - a >= min_len]


def _inner_section_loud(o: dict[str, Any]) -> list[tuple[dict[str, Any], float]]:
    """(section, median loudness dB) for sections of 6+ s, without intro/outro and the first
    and last section (a quiet intro going into verse 1 is not a "turn")."""
    loud = np.array(o["loud"], float)
    out = []
    for s in o["sections"][1:-1]:
        if s["kind"] in ("intro", "outro") or s["end"] - s["start"] < 6:
            continue
        seg = loud[int(s["start"] * 2) : int(s["end"] * 2)]
        if len(seg):
            out.append((s, float(np.median(seg))))
    return out


def tempo_words(t: dict[str, Any]) -> str:
    """Speed in words from the felt pulse AND how busy the beat is: a slow pulse with 2+ drum
    hits a beat feels brisk (Power, 75 BPM pulse, 2.8 hits a beat, is «бодрый, напористый»,
    the owner 2026-10-18). Sheet-music bands: «быстрый» from 140."""
    felt, hpb, sync = t.get("felt") or 0, t.get("hits_per_beat") or 0, t.get("sync") or 0
    if not felt:
        return str(t.get("words") or "без чёткого ритма")
    if (t.get("words") or "").startswith("свободный"):
        return str(t["words"])
    pace = felt * (1.5 if hpb >= 2.0 else 1.0)
    speed = (
        "медленный"
        if pace < 70
        else "неспешный"
        if pace < 90
        else "средний"
        if pace < 110
        else "бодрый"
        if pace < 140
        else "быстрый"
    )
    # a second word only on clear evidence: the hit count behind «размеренный» misses rock hi-hats
    feel = "напористый" if pace >= 100 and hpb >= 1.8 else "качающий" if sync > 0.35 else ""
    return f"{speed}, {feel}" if feel else speed


# Claim thresholds fitted on gt.json (liner notes + songbpm + known recordings, 50 tracks,
# 2026-10-18; calib2.py): an instrument is named only where precision was >= 90 %.
CLAIM = {"guitar": 0.205, "strings": 0.065, "brass": 0.392, "piano": 0.255, "woodwind": 0.113}
DRUMS_LIVE, DRUMS_MACHINE = 0.069, -0.065  # between the two: just «барабаны»
FAM_STEM = {
    "guitar": "guitar",
    "piano": "piano",
    "organ": "other",
    "strings": "other",
    "brass": "other",
    "woodwind": "other",
    "synth": "other",
    "bass_guitar": "bass",
}


def _claim_score(ev: dict[str, Any], shares: dict[str, float], fam: str) -> float:
    """calib.score(mode='stem')."""
    gate = shares.get(FAM_STEM[fam], 1.0)
    return float(ev[fam][1] * (1.0 if gate >= 0.01 else 0.3))


def calibrated_names(o: dict[str, Any], ev: dict[str, Any], shares: dict[str, float]) -> list[str]:
    n = o["names"]
    sc = {f: _claim_score(ev, shares, f) for f in ("guitar", "brass", "piano", "woodwind")}
    sc["strings"] = max(_claim_score(ev, shares, "strings"), ev["strings"][3] * 0.6)
    n["guitar"] = "гитара" if sc["guitar"] >= CLAIM["guitar"] else None
    if n.get("piano") in ("пианино", "электропиано", "клавишные"):
        n["piano"] = n["piano"] if sc["piano"] >= CLAIM["piano"] else None
    # woodwind alone is never claimed (synth leads tag as woodwind); with brass it is «духовые»
    colours = ["струнные"] if sc["strings"] >= CLAIM["strings"] else []
    if sc["brass"] >= CLAIM["brass"]:
        colours.append("духовые" if sc["woodwind"] >= CLAIM["woodwind"] else "медные духовые")
    n["other"] = " и ".join(colours) if colours else ("синты и прочее" if n.get("other") else None)
    d = (ev["drums_live"][0] + ev["drums_live"][1]) / 2
    n["drums"] = (
        "живые барабаны" if d >= DRUMS_LIVE else "драм-машина" if d <= DRUMS_MACHINE else "барабаны"
    )
    o["claim_scores"] = {f: round(v, 3) for f, v in sc.items()} | {"drums_live": round(d, 3)}
    return [f for f in ("strings", "brass") if sc[f] >= CLAIM[f]]


class WindowTags:
    """Per-stem tag groups on 10 s windows (hop 2.5 s): what a stem sounds like at a moment."""

    def __init__(self, extra: dict[str, Any]) -> None:
        self.starts = np.asarray(extra["win_starts"], float)
        self.z = {s: {g: _f16(v) for g, v in gs.items()} for s, gs in extra["win"].items()}

    def ev(self, stem: str, group: str, t0: float, t1: float) -> float:
        """Strongest probability of the group on `stem` over the windows starting in [t0, t1]."""
        w = np.where((self.starts >= t0) & (self.starts <= t1))[0]
        if not len(w) or stem not in self.z or group not in self.z[stem]:
            return 0.0
        return float(self.z[stem][group][w].max())

    def name_at(self, stem: str, t: float, n: dict[str, Any], vocal_samples: bool) -> str | None:
        """The part that comes in on `stem` at `t`, from the windows around it. The song-level
        name is not enough: Power's "other" stem is «струнные» for the song, yet keys and synths
        at 3:19 (owner). With vocal samples a guitar-stem entry is not named (Power 2:40 was
        Greg Lake's voice) and strings must be very clear."""
        t0, t1 = t - 5.0, t + 2.5
        g = self.ev(stem, "guitar", t0, t1)
        pi = self.ev(stem, "piano", t0, t1)
        kb = self.ev(stem, "kb", t0, t1)
        sy = self.ev(stem, "synth", t0, t1)
        st = self.ev(stem, "strings", t0, t1)
        br = self.ev(stem, "brass", t0, t1)
        cands = []
        if stem == "guitar" and not vocal_samples and n.get("guitar") and g >= 0.35:
            cands.append((g, "гитара"))
        if "струнные" in (n.get("other") or "") and st >= (0.5 if vocal_samples else 0.25):
            cands.append((st, "струнные"))
        if "духовые" in (n.get("other") or "") and br >= 0.35:
            cands.append((br, "духовые"))
        if pi >= 0.25:
            cands.append((pi, "пианино"))
        elif sy >= 0.2 or kb >= 0.25:
            cands.append((max(sy, kb), "синты" if sy >= kb * 0.8 else "клавишные"))
        return max(cands)[1] if cands else None


ORCH_RU = {"strings": "струнные", "brass": "духовые"}


def orchestral_peaks(
    wt: WindowTags, lanes: dict[str, Any], claimed: list[str], thr: float = 0.15
) -> list[dict[str, Any]]:
    """When a claimed colour (strings, brass) comes in: the first 10 s window where its family
    reaches `thr` on the mix or the "other" stem, moved to the start of an "other" lane piece
    inside that window when there is one."""
    out = []
    for fam in claimed:
        cols = [wt.z[s][fam] for s in ("mix", "other") if s in wt.z and fam in wt.z[s]]
        if not cols:
            continue
        col = np.maximum(*cols) if len(cols) == 2 else cols[0]
        hit = np.where(col >= thr)[0]
        if not len(hit):
            continue
        t0 = float(wt.starts[int(hit[0])])
        inside = [a for a, b in lanes.get("other", []) if t0 <= a <= t0 + 10]
        out.append(
            dict(t=inside[0] if inside else t0 + 5, ru=ORCH_RU[fam], p=round(float(col.max()), 2))
        )
    return out[:2]


def side(pan: float) -> str:
    return "слева" if pan < -0.25 else "справа" if pan > 0.25 else "по центру"


def _attack_rate(counts: list[int] | None, mask: np.ndarray, fps: int = 2) -> float:
    """Clear attacks per second while the stem plays (features5.attack_rate on binned onsets)."""
    if counts is None or mask.sum() < 20:
        return 0.0
    c = np.asarray(counts)[: len(mask)]
    return float(c[mask[: len(c)]].sum() / (mask.sum() / fps))


# ── features5: the three scales ──────────────────────────────────────────────


def spaciousness(o: dict[str, Any], active: set[str]) -> tuple[int, dict[str, int]]:
    width = o["width10"] / 10.0
    pans = [
        s["pan"]
        for s in o["stems"]
        if s["stem"] in active and s["stem"] not in ("vocals", "bass", "kick")
    ]
    spread = lin((max(pans) - min(pans)) if len(pans) >= 2 else 0.0, 0.1, 1.0)
    space = clip01(0.5 * o["space"] + 0.5 * o["echo"])
    facets = {"width": width, "spread": spread, "echo": space}
    total = 0.4 * width + 0.2 * spread + 0.4 * space
    return round(100 * total), {k: round(100 * v) for k, v in facets.items()}


# Genius credit roles -> instrument family (only roles that put a sound on the record)
CREDIT_FAMILY = [
    (r"vocal samples", "семплы голоса"),
    (r"keyboard|piano|synth|organ", "клавишные"),
    (r"guitar", "гитара"),
    (r"^bass$|bass guitar", "бас"),
    (r"drum|percussion|handclap", "ударные"),
    (r"cello|violin|viola|string|orchestra|conductor", "струнные"),
    (r"brass|trumpet|trombone|horn", "медные"),
    (r"woodwind|flute|sax|clarinet", "деревянные"),
    (r"scratch|turntable", "скретчи"),
    (r"background vocals|additional vocals", "бэк-вокал"),
]


def credit_families(g: Genius) -> list[str]:
    fam: list[str] = []
    for role in g.credits:
        r = (role or "").lower()
        if r.startswith("video") or "engineer" in r or "producer" in r:
            continue
        for rx, name in CREDIT_FAMILY:
            if re.search(rx, r) and name not in fam:
                fam.append(name)
    return fam


def technicality(
    o: dict[str, Any], extra: dict[str, Any], lanes: dict[str, Any], dur: float, g: Genius
) -> tuple[int, dict[str, int], dict[str, Any], float]:
    fps = 2
    fill = extra.get("fill")
    masks = {s: _lane_mask(segs, dur, fps) for s, segs in lanes.items()}
    layer_lanes = [
        s for s in masks if s in ("vocals", "bass", "guitar", "piano", "other", *DRUM_LANES)
    ]
    count = np.zeros(int(dur * fps) + 1, int)
    for s in layer_lanes:
        count += masks[s]
    playing = count > 0
    mean_layers = float(count[playing].mean()) if np.any(playing) else 0.0
    distinct = len([s for s in layer_lanes if masks[s].sum() / fps >= 8])
    named = len({n for s, n in o["names"].items() if n not in GENERIC and s != "vocals"})
    # layers: stems that play at once tell only part of it; the density of the spectrum (owner
    # on Power: "плотность всего в звуке") and the credited line-up add what stems cannot count
    fams = credit_families(g)
    parts = [
        (0.35, lin(mean_layers, 2.5, 6.5)),
        (0.15, lin(distinct, 5, 9)),
        (0.1, lin(named, 0, 5)),
    ]
    if fill is not None:
        parts.append((0.2, lin(fill, 0.15, 0.38)))
    if fams:
        parts.append((0.2, lin(len(fams), 2, 7)))
    layers = sum(w * v for w, v in parts) / sum(w for w, _ in parts)
    samples = len(g.samples)

    # sound work: different treatment per part and movement between sections
    st = [s for s in o["stems"] if s["stem"] in masks and masks[s["stem"]].sum() / fps >= 8]
    wstd = float(np.std([s["width"] for s in st])) if len(st) > 2 else 0.0
    dstd = float(np.std([s["depth"] for s in st])) if len(st) > 2 else 0.0
    ps = o["per_section"]
    # `and wets`: 3+ sections with no wet reading at all gave np.std([]) = NaN, which Postgres
    # refuses in jsonb (one track looped through 28 batches); every other track keeps its number
    wets = [p["wet"] for p in ps if p.get("wet") is not None]
    wet_std = float(np.std(wets)) if len(ps) > 2 and wets else 0.0
    move = (
        float(np.std([p["center"] for p in ps]) + np.std([p["spread"] for p in ps]))
        if len(ps) > 2
        else 0.0
    )
    sound_work = (
        0.3 * lin(wstd, 0.1, 0.4)
        + 0.25 * lin(dstd, 0.08, 0.3)
        + 0.3 * lin(wet_std, 0.05, 0.45)
        + 0.15 * lin(move, 0.03, 0.4)
    )
    # building a track out of several samples is sound work too (Power: 4 samples)
    if samples:
        sound_work = 0.75 * sound_work + 0.25 * lin(samples, 0, 4)

    # performance: how busy the playing is, and the groove
    rates = {}
    for s in ("bass", *MELODIC):
        if s in masks:
            rates[s] = _attack_rate(extra["onsets2"].get(s), masks[s], fps)
    t = o["tempo"]
    drums_hps = (t.get("hits_per_beat") or 0) * (t.get("felt") or 0) / 60.0
    top_mel = max(rates.values()) if rates else 0.0
    perf = (
        0.4 * lin(drums_hps, 0.7, 3.5)
        + 0.4 * lin(top_mel, 0.5, 3.5)
        + 0.2 * lin(t.get("sync") or 0, 0.05, 0.35)
    )

    # development: part kinds, entries per minute on cleaned lanes, loudness contrast
    kinds = len({s["kind"] for s in o["sections"]})
    edges = sum(len(_clean(segs)) for s, segs in lanes.items() if s in layer_lanes)
    edges_pm = edges / max(1.0, dur / 60)
    sl = [v for _, v in _inner_section_loud(o)]
    loud_std = float(np.std(sl)) if len(sl) > 2 else 0.0
    develop = (
        0.3 * lin(kinds, 3, 7) + 0.35 * lin(edges_pm, 1.0, 5.0) + 0.35 * lin(loud_std, 1.0, 6.0)
    )

    facets = {"layers": layers, "sound_work": sound_work, "playing": perf, "development": develop}
    # songs are technical each in their own way: the two strongest sides weigh most
    vals = sorted(facets.values(), reverse=True)
    total = 0.7 * (vals[0] + vals[1]) / 2 + 0.3 * (vals[2] + vals[3]) / 2
    raw = dict(
        mean_layers=round(mean_layers, 2),
        distinct=distinct,
        named=named,
        wstd=round(wstd, 3),
        dstd=round(dstd, 3),
        wet_std=round(wet_std, 3),
        move=round(move, 3),
        drums_hps=round(drums_hps, 2),
        attack_rates={k: round(v, 2) for k, v in rates.items()},
        kinds=kinds,
        edges_pm=round(edges_pm, 2),
        loud_std=round(loud_std, 2),
        fill=round(fill, 3) if fill is not None else None,
        credits=fams,
        samples=samples,
    )
    return round(100 * total), {k: round(100 * v) for k, v in facets.items()}, raw, mean_layers


def odd_sounds(m527: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Unusual non-musical sounds: two windows at 0.3+ (~12 s of evidence) or one at 0.6+."""
    if not m527:
        return []
    hits = []
    for c in ODD_SOUNDS:
        h = m527["classes"].get(c)
        if h is None:
            continue
        strong = h["strong_t"]
        if len(strong) >= 2 or h["max"] >= 0.6:
            t = strong[0] if strong else h["argmax_t"]
            hits.append(dict(cls=c, ru=ODD_RU.get(c, c), t=float(t), p=round(float(h["max"]), 2)))
    return sorted(hits, key=lambda x: -x["p"])


STYLE_STRONG = ("experiment", "avant", "industrial", "abstract", "deconstruct", "glitch", "noise")


def style_tags(g: Genius) -> list[str]:
    """Genius style tags that mark a song as unusual for its genre. Art Rock / Art Pop are left
    out: Exits is tagged Art Rock and the owner confirmed its unusualness at 0."""
    return [t for t in g.tags if any(w in t.lower() for w in STYLE_STRONG)]


RARE_WORDS = ("духовые", "струнные", "орган", "аккордеон", "арфа", "ситар", "терменвокс", "волынка")


def unusualness(
    o: dict[str, Any],
    extra: dict[str, Any],
    mean_layers: float,
    lanes: dict[str, Any],
    dur: float,
    g: Genius,
) -> tuple[int, dict[str, int], dict[str, Any], list[dict[str, Any]]]:
    m527 = extra.get("mix527")
    odd = odd_sounds(m527)
    rare_inst = [n for n in o["names"].values() if n and any(w in n for w in RARE_WORDS)]
    mass, best = 0.0, []
    if m527:
        mass = float(np.percentile(_f32(m527["top3"]), 90))
        best = [(c, p) for c, p in m527["best"]]
    heard = [MASS_RU[c] for c, pr in best if pr >= 0.25 and c in MASS_RU]
    sounds = clip01(0.75 * lin(mass, 0.06, 0.25) + 0.15 * len(odd) + 0.1 * len(rare_inst))

    loud = np.array(o["loud"], float)
    body = loud[loud > -29]
    dyn = float(np.percentile(body, 95) - np.percentile(body, 10)) if len(body) > 20 else 10.0
    extremes = []
    if o["width10"] >= 9:
        extremes.append("very_wide")
    if o["width10"] <= 2:
        extremes.append("near_mono")
    if o["space"] <= 0.1 and o["echo"] <= 0.15:
        extremes.append("bone_dry")
    if o["space"] >= 0.92 and o["echo"] >= 0.7:
        extremes.append("drowned_in_echo")
    if mean_layers <= 2.2:
        extremes.append("sparse")
    if dyn >= 20:
        extremes.append("sharp_dynamics")
    if (o.get("vwet") or 0) >= 0.8:
        extremes.append("voice_in_echo")
    if (
        o["names"].get("bass") == "808-бас"
        and o["names"].get("drums") == "драм-машина"
        and mean_layers <= 3
    ):
        extremes.append("bare_808")
    extreme = clip01(0.34 * len(extremes))

    form: list[str] = []
    secs = o["sections"]
    if (
        o.get("sec_source") == "songformer"
        and secs
        and not any(s["kind"] == "chorus" for s in secs)
    ):
        form.append("no_chorus")
    sl = [v for _, v in _inner_section_loud(o)]
    jumps = [abs(b - a) for a, b in itertools.pairwise(sl)]
    if jumps and max(jumps) >= 12:
        form.append("sharp_turn")
    # a real tempo change: two neighbouring thirds, each steady (beat spacing varies < 6 %),
    # differ by 12 %+ (a half-vs-half 8 % test fired on beat-tracker drift)
    b = np.array(extra["beats"], float)
    if len(b) > 60:
        th = np.array_split(np.diff(b), 3)
        med = [float(np.median(x)) for x in th]
        steady = [float(np.std(x) / np.median(x)) < 0.06 for x in th]
        if any(
            steady[i]
            and steady[i + 1]
            and abs(med[i] - med[i + 1]) / min(med[i], med[i + 1]) >= 0.12
            for i in range(2)
        ):
            form.append("tempo_change")
    # a long calm start: the beat comes in only after a minute (Frozen: 1:11)
    drum_runs = sorted(
        seg for s in DRUM_LANES for seg in _clean(lanes.get(s, [])) if seg[1] - seg[0] >= 8
    )
    first_beat = drum_runs[0][0] if drum_runs else None
    if first_beat is not None and first_beat >= 60 and first_beat >= 0.15 * dur:
        form.append("late_beat")
    if len({s["kind"] for s in secs}) >= 7:
        form.append("many_parts")
    form_s = clip01(0.4 * len(form))

    facets = {"sounds": sounds, "mix_extremes": extreme, "form": form_s}
    # style: what listeners and editors call the song on Genius (audio detectors and CLAP
    # zero-shot only reach AUC ~0.7 against these tags); one tag 0.5, up to 0.8
    style = style_tags(g)
    if style:
        facets["style"] = min(0.8, 0.4 + 0.1 * len(style))
    # one strong oddity is enough: the strongest side dominates
    vals = sorted(facets.values(), reverse=True)
    total = 0.75 * vals[0] + 0.25 * sum(vals[1:]) / len(vals[1:])
    why = dict(
        odd=[dict(cls=h["cls"], t=h["t"]) for h in odd[:3]],
        heard=heard,
        rare=rare_inst,
        extremes=extremes,
        form=form,
        first_beat=first_beat,
        dyn_db=round(dyn, 1),
        nonmusic=round(mass, 3),
        style=style,
    )
    return round(100 * total), {k: round(100 * v) for k, v in facets.items()}, why, odd


# ── features5: moments «вслушайся», traits ───────────────────────────────────


def comes_in(name: str) -> str:
    """Russian verb agreement: «вступает гитара», «вступают струнные»."""
    plural = name.endswith(("ые", "ы", "и")) or " и " in name
    return "вступают" if plural else "вступает"


def moment_ru(m: dict[str, Any]) -> str:
    """The prototype's sentence for a moment (the read API renders the same from the keys)."""
    k = m["kind"]
    if k == "part_in":
        nm = m.get("name")
        return f"{m['side']} {comes_in(nm)} {nm}" if nm else f"{m['side']} вступает новая партия"
    if k == "keys_in":
        return f"{m['side']} вступают клавишные"
    if k == "beat_out":
        left = m.get("left") or []
        stay = (
            ""
            if not left
            else f", остаются {' и '.join(left)}"
            if len(left) > 1
            else f", остаётся {left[0]}"
        )
        return "бит пропадает" + stay
    if k == "beat_back":
        return "бит возвращается"
    if k == "bass_in":
        return "вступает бас"
    if k == "bass_back":
        return "бас возвращается"
    if k == "build":
        return f"нарастание к припеву ({mmss(m['to'])})"
    if k == "voice_echo":
        return f"{m['label']}: голос уходит в эхо"
    if k == "colour_in":
        return f"{comes_in(m['name'])} {m['name']}"
    if k == "odd_sound":
        return f"необычный звук: {m['name']}"
    raise ValueError(k)


def moments(
    o: dict[str, Any],
    lanes: dict[str, Any],
    dur: float,
    odd: list[dict[str, Any]],
    orch: list[dict[str, Any]],
    wt: WindowTags,
    drums_db: np.ndarray | None,
    vocal_samples: bool,
) -> list[dict[str, Any]]:
    """Only events with clear evidence in the sound, each once: a riff is one entry, not ten."""
    out: list[dict[str, Any]] = []
    stems = {s["stem"]: s for s in o["stems"]}

    # a rare part (plays under half the song) comes in: its first entry, again only after 45+ s away
    for s in MELODIC:
        segs = _clean(lanes.get(s, []))
        cover = sum(b - a for a, b in segs) / dur
        if not segs or cover >= 0.5:
            continue
        pan = stems.get(s, {}).get("pan", 0.0)
        last_end, n = -99.0, 0
        for a, b in segs:
            if a > 3 and a - last_end >= 45 and n < 2:
                nm = wt.name_at(s, a, o["names"], vocal_samples)
                out.append(dict(t=a, kind="part_in", stem=s, side=side(pan), name=nm, prio=1))
                n += 1
            last_end = b
    # keys that SW put on another stem (Exits 1:05): the keys tags rise from under 0.1 for 20 s
    # to 0.3+ on two windows in a row; once per song
    hosts = [s for s in MELODIC if s in wt.z and "keys" in wt.z[s]]
    if hosts:
        ev = np.max([wt.z[s]["keys"] for s in hosts], 0)
        for i in range(8, len(ev) - 1):
            if (
                ev[i] >= 0.3
                and ev[i + 1] >= 0.2
                and ev[i - 8 : i].max() < 0.1
                and wt.starts[i] > 10
            ):
                host = max(MELODIC, key=lambda s: float(wt.z[s]["keys"][i]) if s in hosts else 0)
                out.append(
                    dict(
                        t=float(wt.starts[i]) + 5.0,
                        kind="keys_in",
                        stem=host,
                        side=side(stems.get(host, {}).get("pan", 0.0)),
                        prio=1,
                    )
                )
                break
    # the beat drops out (after 15+ s of beat) for 6+ s and comes back: two at most
    drums = _clean([seg for s in DRUM_LANES for seg in lanes.get(s, [])], gap=2.0, min_len=2.0)
    drops = 0
    for (a1, b1), (a2, _) in itertools.pairwise(drums):
        # the drums stem itself must fall 15+ dB in the gap: DrumSep lanes flicker on busy
        # outros (Exits 5:30-5:44 kept the beat at -18 dB; its real drop at 3:56 is -54 dB)
        if drums_db is not None and drops < 2:
            gap = drums_db[int(b1 * 2) + 1 : int(a2 * 2)]
            before = drums_db[max(0, int((b1 - 15) * 2)) : int(b1 * 2)]
            if len(gap) and len(before) and np.median(gap) > np.median(before) - 15:
                continue
        if drops < 2 and a2 - b1 >= 6 and b1 - a1 >= 15 and b1 > 10 and a2 < dur - 10:
            left = [
                n
                for n, st in (("голос", "vocals"), ("бас", "bass"))
                if any(x <= b1 + 1 and y >= a2 - 1 for x, y in _clean(lanes.get(st, [])))
            ]
            out.append(dict(t=b1, kind="beat_out", left=left, prio=2))
            out.append(dict(t=a2, kind="beat_back", prio=1))
            drops += 1
    # the bass comes in late, or back after 10+ s away (after 15+ s of playing); two at most
    bsegs = _clean(lanes.get("bass", []))
    if bsegs and 6 < bsegs[0][0] < dur - 20:
        out.append(dict(t=bsegs[0][0], kind="bass_in", prio=1))
    back = 0
    for (a1, b1), (a2, _) in itertools.pairwise(bsegs):
        if back < 2 and a2 - b1 >= 10 and b1 - a1 >= 15 and a2 < dur - 15:
            out.append(dict(t=a2, kind="bass_back", prio=2))
            back += 1
    # build-up: loudness climbs 6+ dB over 4-12 s straight into a chorus
    loud = np.array(o["loud"], float)
    for s in o["sections"]:
        if s["kind"] != "chorus" or s["start"] < 8:
            continue
        i = int(s["start"] * 2)
        for span in (8, 16, 24):
            if i - span >= 0 and i < len(loud):
                seg = loud[i - span : i + 1]
                if seg[-3:].mean() - seg[:3].mean() >= 6 and np.all(
                    np.diff(np.convolve(seg, np.ones(3) / 3, "valid")) > -1.5
                ):
                    out.append(dict(t=s["start"] - span / 2, kind="build", to=s["start"], prio=1))
                    break
    # the voice goes into a big echo in a section where it was dry before
    ps = o["per_section"]
    for a, b in itertools.pairwise(ps):
        if (
            b.get("wet") is not None
            and a.get("wet") is not None
            and b["wet"] >= 0.6
            and a["wet"] <= 0.35
        ):
            sec = next((s for s in o["sections"] if s["label"] == b["label"]), None)
            if sec and sec["end"] - sec["start"] >= 8:
                out.append(dict(t=sec["start"], kind="voice_echo", label=b["label"], prio=2))
    # orchestral colours heard on the full mix in places (Frozen's strings have no stem)
    for h in orch:
        out.append(dict(t=h["t"], kind="colour_in", name=h["ru"], prio=1))
    for h in odd[:2]:
        out.append(dict(t=h["t"], kind="odd_sound", cls=h["cls"], name=h["ru"], prio=1))

    out.sort(key=lambda m: (m["t"], m["prio"]))
    kept: list[dict[str, Any]] = []
    for m in out:
        if kept and m["t"] - kept[-1]["t"] < 12:
            if m["prio"] < kept[-1]["prio"]:
                kept[-1] = m
            continue
        kept.append(m)
    for m in kept:
        sec = next((s for s in o["sections"] if s["start"] <= m["t"] < s["end"]), None)
        m["section"] = sec["label"] if sec else ""
        m["section_i"] = o["sections"].index(sec) if sec else None
        m["t"] = round(float(m["t"]), 1)
        m.pop("prio")
    return kept[:8]


def traits(
    o: dict[str, Any], lanes: dict[str, Any], dur: float, orch: list[dict[str, Any]]
) -> list[str]:
    t = []
    n = o["names"]
    if n.get("drums") in ("живые барабаны", "драм-машина"):
        t.append(n["drums"])
    if n.get("bass") and n["bass"] in ("808-бас", "синт-бас", "бас-гитара"):
        t.append(n["bass"])
    for s in MELODIC:
        nm = n.get(s)
        cover = sum(b - a for a, b in lanes.get(s, [])) / dur
        if nm and nm not in GENERIC and cover >= 0.15:
            t.append(nm)
    for h in orch:
        if h["ru"] not in " ".join(t) and "духовые" not in " ".join(t):
            t.append(f"{h['ru']} местами")
    vcover = sum(b - a for a, b in lanes.get("vocals", [])) / dur
    if vcover < 0.25:
        t.append("почти без голоса")
    t.append(o["echo_w"])
    return t[:5]


def features(measures: dict[str, Any], g: Genius) -> dict[str, Any]:
    """features5.run on the stored measures: the prototype's output, Russian strings and all."""
    o = view(measures["an"])
    extra = measures["extra"]
    dur = o["dur"]
    lanes = {ln["stem"]: ln["segs"] for ln in o["lanes"]}
    o["tempo"] = dict(o["tempo"], words_v3=o["tempo"].get("words"), words=tempo_words(o["tempo"]))
    # Frozen: SW left the bass stem empty (the synth sub went elsewhere) and the 808 rule named
    # "808-бас" from the drums stem: a near-silent bass stem means nothing is said of the bass
    shares = extra["shares"]
    if shares.get("bass", 1.0) < 0.01:
        o["names"]["bass"] = None
        lanes.pop("bass", None)
        o["lanes"] = [ln for ln in o["lanes"] if ln["stem"] != "bass"]
    claimed = calibrated_names(o, extra["claim_ev"], shares)
    # sample-based songs: a "new part" on the guitar/other stem is often a sample, and voice
    # samples come out as strings or synths (owner, Power): stricter naming, a 0.5 strings bar
    rap = any("rap" in t.lower() or "hip-hop" in t.lower() for t in g.tags)
    vocal_samples = "Vocal Samples" in g.credits or (bool(g.samples) and rap)
    wt = WindowTags(extra)
    orch = orchestral_peaks(wt, lanes, claimed, thr=0.5 if vocal_samples else 0.15)
    active = {s for s, segs in lanes.items() if sum(b - a for a, b in segs) >= 0.1 * dur}
    sp, sp_f = spaciousness(o, active)
    te, te_f, te_raw, mean_layers = technicality(o, extra, lanes, dur, g)
    un, un_f, un_why, odd = unusualness(o, extra, mean_layers, lanes, dur, g)
    ddb = _f32(extra["drums_db"]) if extra.get("drums_db") else None
    moms = moments(o, lanes, dur, odd, orch, wt, ddb, vocal_samples)
    return dict(
        dur=dur,
        tempo=o["tempo"],
        scales=dict(
            space=dict(value=sp, facets=sp_f),
            tech=dict(value=te, facets=te_f, raw=te_raw),
            odd=dict(value=un, facets=un_f, why=un_why),
        ),
        traits=traits(o, lanes, dur, orch),
        sections=o["sections"],
        moments=moms,
        names=o["names"],
        echo=o["echo"],
        echo_w=o["echo_w"],
        width_w=o["width_w"],
        width10=o["width10"],
        stems=o["stems"],
        lanes=lanes,
        lane_list=o["lanes"],
        claim_scores=o["claim_scores"],
        orch=orch,
        odd=odd,
        vocal_samples=vocal_samples,
        credits=credit_families(g),
        style=style_tags(g),
        samples=list(g.samples),
        shares=shares,
    )


# ── the stored profile (sound_profiles row): keys, not words ─────────────────

# the ranker's sound features (spec §7 `feat`): fixed order, absolute bounds, 0..1
FEAT_NAMES = (
    "space",
    "tech",
    "odd",
    "space.width",
    "space.spread",
    "space.echo",
    "tech.layers",
    "tech.sound_work",
    "tech.playing",
    "tech.development",
    "odd.sounds",
    "odd.mix_extremes",
    "odd.form",
    "odd.style",
    "pace",
    "hits_per_beat",
    "sync",
    "vocal_share",
    "mean_layers",
    "fill",
    "drums_live",
    "claim.guitar",
    "claim.piano",
    "claim.strings",
    "claim.brass",
    "share.vocals",
    "share.drums",
    "share.bass",
    "share.guitar",
    "share.piano",
    "share.other",
    "nonmusic",
    "dyn",
    "edges_pm",
)
SECTION_KEYS = (
    "intro",
    "verse",
    "prechorus",
    "chorus",
    "bridge",
    "break",
    "outro",
    "silence",
    "part",
)
MONO_CORR = 0.995  # L/R correlation of the mix above this: no stereo picture to measure


def _side_key(pan: float) -> str:
    return "left" if pan < -0.25 else "right" if pan > 0.25 else "center"


def _tempo_keys(words: str) -> tuple[str | None, str | None]:
    if words in W.FEEL.values():  # «без чёткого ритма», «свободный, без ударных»
        return None, W.key("feel", words)
    speed, _, feel = words.partition(", ")
    return W.key("pace", speed), (W.key("feel", feel) if feel else None)


def _sections(secs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for s in secs:
        n = int(s["label"].rsplit(" ", 1)[1]) if s["kind"] == "verse" else None
        last = s["kind"] == "chorus" and s["label"] == "последний припев"
        assert W.section_label(s["kind"], n, last) == s["label"], s
        out.append(dict(start=s["start"], end=s["end"], kind=s["kind"], n=n, last=last))
    return out


def _moment(m: dict[str, Any]) -> dict[str, Any]:
    """A moment with its words as keys; `moment_ru` of it renders the prototype's sentence."""
    out: dict[str, Any] = dict(t=m["t"], kind=m["kind"], section_i=m["section_i"])
    if "side" in m:
        out["side"] = W.key("sides", m["side"])
    if m.get("stem"):
        out["stem"] = m["stem"]
    if m["kind"] in ("part_in", "colour_in") and m.get("name"):
        out["name"] = W.name_keys(m["name"])[0]
    if m["kind"] == "odd_sound":
        out["cls"] = m["cls"]
    if m["kind"] == "beat_out":
        out["left"] = ["voice" if x == "голос" else "bass" for x in m["left"]]
    if m["kind"] == "build":
        out["to"] = m["to"]
    return out


def moment_text(m: dict[str, Any], sections: list[dict[str, Any]]) -> str:
    """A stored moment back to its sentence (the read API's ru label)."""
    ru = dict(m)
    if "side" in m:
        ru["side"] = W.SIDES[m["side"]]
    if "name" in m:
        ru["name"] = W.NAMES[m["name"]]
    if m["kind"] == "odd_sound":
        ru["name"] = ODD_RU.get(m["cls"], m["cls"])
    if m["kind"] == "beat_out":
        ru["left"] = ["голос" if x == "voice" else "бас" for x in m["left"]]
    if m["kind"] == "voice_echo":
        s = sections[m["section_i"]]
        ru["label"] = W.section_label(s["kind"], s["n"], s["last"])
    return moment_ru(ru)


def _traits(f: dict[str, Any]) -> list[str]:
    out = []
    for t in f["traits"]:
        if t in W.ECHO.values():
            out.append("echo." + W.key("echo", t))
        elif t in W.TRAITS.values():
            out.append(next(k for k, v in W.TRAITS.items() if v == t))
        elif t.endswith(W.SUFFIX_IN_PLACES):
            out += [k + ".in_places" for k in W.name_keys(t.removesuffix(W.SUFFIX_IN_PLACES))]
        else:
            out += W.name_keys(t)
    return out


def _stem_name(s: dict[str, Any], names: dict[str, Any]) -> str:
    """The stage label of a stem. The melodic stems take the calibrated claim (report3 named
    them before calibration: Frozen's "other" said «синты и прочее» next to claimed strings);
    a stem whose instrument was not confirmed is just «партия»."""
    if s["stem"] in MELODIC:
        return W.name_keys(names[s["stem"]])[0] if names.get(s["stem"]) else "part"
    return W.name_keys(s["name"])[0]


def profile(f: dict[str, Any], an: dict[str, Any]) -> dict[str, Any]:
    """The sound_profiles row (without the key and the timestamps)."""
    sc = f["scales"]
    names = f["names"]
    mono = an["mix_ms"]["corr"] >= MONO_CORR
    instruments: list[str] = []
    for s in ("bass", *MELODIC):
        nm = names.get(s)
        if nm and nm not in GENERIC:
            instruments += [k for k in W.name_keys(nm) if k not in instruments]
    for h in f["orch"]:
        instruments += [k for k in W.name_keys(h["ru"]) if k not in instruments]
    drums = {"живые барабаны": "live", "драм-машина": "machine"}.get(names.get("drums") or "")
    dur = f["dur"]
    vshare = sum(b - a for a, b in f["lanes"].get("vocals", [])) / dur if dur else 0.0
    vocals = "none" if vshare < 0.05 else W.name_keys(names.get("vocals") or "голос")[0]
    pace, feel = _tempo_keys(f["tempo"]["words"])
    t = f["tempo"]
    why, raw = sc["odd"]["why"], sc["tech"]["raw"]
    ce = f["claim_scores"]
    sh = f["shares"]
    vals = {
        "space": sc["space"]["value"] / 100,
        "tech": sc["tech"]["value"] / 100,
        "odd": sc["odd"]["value"] / 100,
        **{
            f"{k}.{x}": v / 100
            for k in ("space", "tech", "odd")
            for x, v in sc[k]["facets"].items()
        },
        "pace": lin(
            (t.get("felt") or 0) * (1.5 if (t.get("hits_per_beat") or 0) >= 2 else 1), 50, 160
        ),
        "hits_per_beat": lin(t.get("hits_per_beat") or 0, 0, 4),
        "sync": clip01(t.get("sync") or 0),
        "vocal_share": clip01(vshare),
        "mean_layers": lin(raw["mean_layers"], 0, 8),
        "fill": lin(raw["fill"] or 0, 0, 0.5),
        "drums_live": lin(ce["drums_live"], -0.5, 0.5),
        **{f"claim.{x}": clip01(ce[x]) for x in ("guitar", "piano", "strings", "brass")},
        **{f"share.{s}": clip01(sh.get(s, 0.0)) for s in STEMS},
        "nonmusic": lin(why["nonmusic"], 0, 0.4),
        "dyn": lin(why["dyn_db"], 0, 30),
        "edges_pm": lin(raw["edges_pm"], 0, 8),
    }
    return dict(
        derive_ver=DERIVE_VER,
        space=None if mono else sc["space"]["value"],
        tech=sc["tech"]["value"],
        odd=sc["odd"]["value"],
        facets={k: sc[k]["facets"] for k in ("space", "tech", "odd")}
        | ({"space": {}} if mono else {}),
        evidence=dict(
            odd=why,
            tech=raw,
            claims=ce,
            orch=f["orch"],
            vocal_samples=f["vocal_samples"],
            credits=f["credits"],
            style=f["style"],
            samples=f["samples"],
        ),
        instruments=instruments,
        drums=drums,
        vocals=vocals,
        vocal_share=round(vshare, 3),
        pace=pace,
        feel=feel,
        felt_bpm=t.get("felt"),
        echo=W.key("echo", f["echo_w"]),
        width=None if mono else W.key("width", f["width_w"]),
        stems=[
            dict(
                stem=s["stem"],
                name=_stem_name(s, names),
                side=_side_key(s["pan"]),
                pan=round(s["pan"], 2),
                width=round(s["width"], 2),
            )
            for s in f["stems"]
        ],
        traits=_traits(f),
        feat=[round(float(vals.get(n, 0.0)), 4) for n in FEAT_NAMES],
        sections=_sections(f["sections"]),
        moments=[_moment(m) for m in f["moments"]],
    )


def derive(measures: dict[str, Any], g: Genius) -> dict[str, Any]:
    return profile(features(measures, g), measures["an"])
