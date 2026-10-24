"""Second analysis pass, after the owner's review of 10 tracks.

What changed and why (his notes, 2026-10-17):
- "бас долбит с самого начала" — Demucs puts 808/sub-bass into the drums stem, so the bass
  lane now also takes sustained sub-bass found inside the drums (808), and drums are split by
  band into kick / snare / cymbals so "тарелочки вступают позже" shows up.
- "почему голос так далеко" — vocal depth now comes from a measured dry/reverb split
  (RoFormer de-reverb windows), not from the reverb tail, which over-weighted long reverbs.
- "сухо, но не мелкая комната — ширина и глубина есть" — echo and spaciousness are separate.
- "ширина больше, гитары широкие" — scene width follows the widest prominent instrument.
- "припев, смена бита, проигрыш" — marks are song sections (lyrics) and beat changes, on bars.
- "число ни о чём не говорит" — tempo is described in words.
"""

import numpy as np
from scipy.ndimage import maximum_filter1d, uniform_filter1d
from scipy.signal import find_peaks, stft

from . import scene, stage, structure

SR = stage.SR
FPS = 10


def clip01(v):
    return float(np.clip(v, 0, 1))


# ---------- drums: band split + 808 ----------

def drum_bands(drums):
    """Per-band energy envelopes (hop 512 = 11.6 ms) of the drums stem: low (kick/808), mid (snare/claps), high (cymbals)."""
    f, t, Z = stft(drums.mean(0), fs=SR, nperseg=2048, noverlap=2048 - 512, boundary=None)
    P = np.abs(Z) ** 2
    bands = dict(low=P[f < 120].sum(0), mid=P[(f >= 150) & (f < 4000)].sum(0), high=P[f >= 6000].sum(0))
    return t, bands


def band_lane(t, e, rel_db=-14, min_len=2.0, max_gap=4.0):
    """A drum voice plays where its band is within rel_db of its loud level AND keeps hitting
    (>= 1 onset per 2 s): background bleed has energy but no attacks."""
    fps = 1 / (t[1] - t[0])
    db = 10 * np.log10(uniform_filter1d(e, 40) + 1e-12)  # ~0.5 s
    ref = np.percentile(db, 97)
    loud = scene.hysteresis(db, ref + rel_db, ref + rel_db - 4)
    on_t, _ = onsets(t, e, pct=90)
    hits = np.zeros(len(t))
    hits[np.clip(np.searchsorted(t, on_t), 0, len(t) - 1)] = 1
    busy = uniform_filter1d(hits, int(3 * fps)) * 3 * fps >= 1.5
    return scene.segments(loud & busy, fps, min_len=min_len, max_gap=max_gap)


def lane_808(t, low):
    """Sub-bass that rings on (> 0.25 s within 9 dB of its onset peak) is a bass note, not a kick."""
    fps = 1 / (t[1] - t[0])
    db = 10 * np.log10(low + 1e-12)
    ref = np.percentile(db, 97)
    loud = db > ref - 18
    run = int(0.25 * fps)
    peak = maximum_filter1d(db, size=int(0.3 * fps), origin=int(0.15 * fps) - 1)
    held = loud & (db > peak - 9)
    # frames that are part of a held stretch longer than `run`
    sustained = np.zeros_like(held)
    start = None
    for i, h in enumerate(np.r_[held, False]):
        if h and start is None:
            start = i
        elif not h and start is not None:
            if i - start >= run:
                sustained[start:i] = True
            start = None
    share = uniform_filter1d(sustained.astype(float), int(2 * fps))
    # long 808 notes leave short gaps between them: the bass is still "there"
    return scene.segments(share > 0.15, fps, min_len=3.0, max_gap=6.0), float(sustained.mean())


def onsets(t, e, pct=97):
    """Clear attacks only: strong flux peaks that are also loud for this band."""
    fps = 1 / (t[1] - t[0])
    loge = np.log(e + 1e-9)
    flux = np.maximum(0, np.diff(loge, prepend=loge[0]))
    db = 10 * np.log10(e + 1e-12)
    pk, _ = find_peaks(flux, height=np.percentile(flux, pct), distance=int(0.1 * fps))
    pk = pk[db[pk] > np.percentile(db, 97) - 18]
    return t[pk], flux


def bar_patterns(t, bands, downbeats):
    """One row per bar: onset strength of low/mid/high at 16 positions, plus drum energy (dB)."""
    rows, energy = [], []
    fluxes = {k: np.maximum(0, np.diff(np.log(v + 1e-9), prepend=0)) for k, v in bands.items()}
    tot = sum(bands.values())
    for a, b in zip(downbeats[:-1], downbeats[1:]):
        grid = a + (b - a) * (np.arange(16) + 0.5) / 16
        idx = np.clip(np.searchsorted(t, grid), 0, len(t) - 1)
        rows.append(np.concatenate([uniform_filter1d(fluxes[k], 5)[idx] for k in ("low", "mid", "high")]))
        m = (t >= a) & (t < b)
        energy.append(10 * np.log10(tot[m].mean() + 1e-12) if m.any() else -120)
    return np.array(rows), np.array(energy)


# ---------- tempo in words ----------

def tempo_words(beats, downbeats, t, bands, drums_on, drum_share=0.3):
    if len(beats) < 8:
        return dict(bpm=None, felt=None, words="без чёткого ритма")
    bpm = 60 / float(np.median(np.diff(beats)))
    felt = bpm
    kick_t, _ = onsets(t, bands["low"])
    snare_t, _ = onsets(t, bands["mid"])
    # half-time: the backbeat lands on beat 3 of 4 instead of 2 and 4
    if len(downbeats) > 4 and drums_on:
        prof = np.zeros(4)
        for a, b in zip(downbeats[:-1], downbeats[1:]):
            for k in range(4):
                c = a + (b - a) * k / 4
                prof[k] += np.sum(np.abs(snare_t - c) < 0.06)
        if prof[2] > 1.5 * max(prof[1], prof[3], 1):
            felt = bpm / 2
    if felt >= 140:
        felt = felt / 2  # people tap the slower pulse of a 150 BPM track (owner: Power, Sultans "мимо")
    dur = t[-1] - t[0]
    hits_per_beat = (len(kick_t) + len(snare_t)) / max(1.0, dur * felt / 60)
    eighths = np.sort(np.r_[beats, (beats[:-1] + beats[1:]) / 2])
    on_grid = np.array([np.min(np.abs(eighths - k)) < 0.05 for k in kick_t]) if len(kick_t) else np.array([True])
    sync = 1 - float(on_grid.mean())
    hits_per_beat = hits_per_beat * bpm / felt if felt < bpm else hits_per_beat
    speed = ("медленный" if felt < 70 else "неспешный" if felt < 90 else "средний" if felt < 110
             else "бодрый" if felt < 135 else "быстрый")
    if not drums_on:
        feel = "свободный, без ударных"
    elif felt >= 95 and hits_per_beat > 1.3 and drum_share > 0.35:
        feel = "напористый"
    elif sync > 0.35:
        feel = "качающий"
    elif hits_per_beat < 0.9:
        feel = "размеренный"
    else:
        feel = "ровный"
    return dict(bpm=round(bpm, 1), felt=round(felt, 1), sync=round(sync, 2), hits_per_beat=round(hits_per_beat, 2),
                words=f"{speed}, {feel}")


# ---------- vocals: RoFormer stem, per-section stage, far voices ----------

def vocal_frames(voc):
    f, t, E, D, pan, _ = stage.analyse(voc)
    rows = (f >= 120) & (f < 12000)
    return t, E[rows], D[rows], pan[rows]


def stage_slice(t, E, D, pan, a, b):
    m = (t >= a) & (t < b)
    if m.sum() < 5:
        return None
    tot = E[:, m].sum(0)
    act = tot > tot.max() * 10 ** -3.0
    if act.sum() < 5:
        return None
    w = (E * D)[:, m][:, act]
    p = pan[:, m][:, act]
    ws = w.sum() + 1e-12
    c = float((w * p).sum() / ws)
    spread = float(np.sqrt((w * (p - c) ** 2).sum() / ws))
    Pd, Pa = w.sum(0), (E * (1 - D))[:, m][:, act].sum(0)
    amb = float(np.median(Pa / (Pa + Pd + 1e-12)))
    loud = float(10 * np.log10(tot[act].mean() + 1e-12))
    return dict(center=c, spread=spread, amb=amb, loud=loud)


def wet_in(wet, a, b):
    v = [w["wet"] for w in wet if w["t0"] >= a - 1 and w["t1"] <= b + 1]
    return float(np.mean(v)) if v else None


# ---------- main ----------



def _mask(segs, dur):
    m = np.zeros(int(dur * FPS) + 1, bool)
    for a, b in segs:
        m[int(a * FPS): int(b * FPS)] = True
    return m


PLURAL = {"тарелки", "синты", "клавишные", "струнные", "духовые"}


def build_markers(res, sections, downbeats, t, bands, voc_lane, lanes, hats, l808, dur, names=None):
    out = []

    def add(time, label, kind, snap=True, prio=1):
        tt = structure.snap(time, downbeats) if snap else round(float(time), 2)
        for m in out:
            if abs(m["t"] - tt) < 2.5:
                # one mark = the section (or the strongest event) plus at most one more event
                parts = m["label"].split(" · ")
                if label in parts:
                    return
                if prio < m["prio"]:
                    m["label"] = " · ".join([label] + parts[:1])
                    m["prio"] = prio
                elif len(parts) < 2:
                    m["label"] = " · ".join(parts + [label])
                return
        out.append(dict(t=tt, label=label, kind=kind, prio=prio))

    for s in sections:
        add(s["start"], s["label"], "section", prio=0)
    # beat changes on bars: pattern novelty, drops and returns
    if len(downbeats) > 10:
        pats, energy = bar_patterns(t, bands, downbeats)
        n = len(pats)
        z = pats / (np.linalg.norm(pats, axis=1, keepdims=True) + 1e-9)
        w = 4
        nov = np.zeros(n)
        for i in range(w, n - w):
            nov[i] = 1 - float(np.dot(z[i - w:i].mean(0), z[i:i + w].mean(0)) /
                               (np.linalg.norm(z[i - w:i].mean(0)) * np.linalg.norm(z[i:i + w].mean(0)) + 1e-9))
        ref = np.percentile(energy, 90)
        # a beat is "gone" only for 2+ bars in a row and "back" only after 2+ bars present (no flicker),
        # and beat events keep 8 bars apart
        e3 = np.array([np.median(energy[max(0, i - 1): i + 2]) for i in range(n)])
        absent = e3 < ref - 25
        last_evt = -99
        state = bool(absent[:4].mean() > 0.5)
        for i in range(2, n - 4):
            # the new state must hold for 4 bars, and nothing changes inside the 8-bar cooldown
            if absent[i] != state and (absent[i:i + 4] == absent[i]).all() and i - last_evt >= 8:
                state = bool(absent[i])
                add(downbeats[i], "бит пропадает" if state else "бит возвращается", "beat", prio=1)
                last_evt = i
            elif not state and i >= w and i < n - w and i - last_evt >= 8 \
                    and np.median(e3[i:i + w]) < np.median(e3[i - w:i]) - 6:
                add(downbeats[i], "бит стихает", "beat", prio=2)
                last_evt = i
        thr = max(0.15, np.percentile(nov[w:n - w], 95))
        pk, _ = find_peaks(nov, height=thr, distance=8)
        for i in pk[:5]:
            add(downbeats[i], "смена бита", "beat", prio=1)
    # voice without a beat (an a-cappella moment)
    dmask = _mask(res["lanes"]["drums"], dur)
    vmask = _mask(voc_lane, dur)
    for a, b in scene.segments(vmask & ~dmask, FPS, min_len=2.0, max_gap=0.5):
        if a > 1:
            add(a, "голос без бита", "voice", snap=False, prio=2)
    # instruments coming in after a pause
    last_entry = [-99.0]

    def entries(segs, name, gap=8.0):
        prev = None
        for a, b in segs:
            fresh = (prev is None and a > 4) or (prev is not None and a - prev >= gap)
            # a real entry lasts; and one "something comes in" per 16 s across all instruments
            if fresh and b - a >= 6 and a - last_entry[0] >= 16:
                add(a, f"вступают {name}" if name in PLURAL else f"вступает {name}", "inst", prio=3)
                last_entry[0] = a
            prev = b
    entries(hats, "тарелки")
    entries(l808, "808")
    # stem names are only trusted when the tagger was sure; otherwise say what we know
    names = names or {}
    for s in ("guitar", "piano", "other"):
        nm = names.get(s)
        entries(lanes.get(s, []), nm.replace(" и прочее", "") if nm else "новый звук")
    out.sort(key=lambda m: m["t"])
    # a progress bar holds about 14 marks: drop the least telling ones first
    while len(out) > 14:
        worst = max(out, key=lambda m: (m["prio"], m["t"]))
        if worst["prio"] == 0:
            break
        out.remove(worst)
    return out
