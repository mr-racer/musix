"""Scene + timeline from Demucs stems.

Per stem (stereo is preserved by Demucs) we reuse the L/R covariance model from
stage.py: pan of the direct part, spread, decorrelated ("ambient") share.
Depth = reverb tail (ambient energy left after a note's direct part has faded)
+ quietness relative to the loudest stem + steady decorrelation.
Activity lanes = stem energy share of the mix (hysteresis, gap fill).
Beats = librosa beat tracker on the drums stem.
"""
import os

import numpy as np
from scipy.ndimage import gaussian_filter, maximum_filter1d, uniform_filter1d
from scipy.signal import stft

from . import stage

SR = stage.SR
STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"]
NAMES = {"vocals": "голос", "drums": "барабаны", "bass": "бас", "guitar": "гитара",
         "piano": "клавишные", "other": "синты и прочее"}
# per-stem "audible in the mix" share thresholds (on, off): guitar/piano bleed more
THR = {"vocals": (0.04, 0.02), "drums": (0.05, 0.025), "bass": (0.05, 0.025),
       "guitar": (0.08, 0.04), "piano": (0.10, 0.05), "other": (0.06, 0.03)}
BANDS = {"bass": (30, 400), "drums": (60, 14000)}
HOPA = int(0.1 * SR)  # activity frame = 100 ms


def frame_energy(x, hop=HOPA):
    n = x.shape[1] // hop
    return (x[:, : n * hop].reshape(2, n, hop) ** 2).sum((0, 2)) / hop


def segments(mask, fs, min_len=2.0, max_gap=1.5):
    """Boolean frames -> [[start_s, end_s], ...] with gap fill and min length."""
    segs, on, start = [], False, 0
    for i, m in enumerate(np.r_[mask, False]):
        if m and not on:
            on, start = True, i
        elif not m and on:
            on = False
            segs.append([start / fs, i / fs])
    merged = []
    for s in segs:
        if merged and s[0] - merged[-1][1] <= max_gap:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    return [[round(a, 1), round(b, 1)] for a, b in merged if b - a >= min_len]


def hysteresis(x, on, off):
    out = np.zeros(len(x), bool)
    state = False
    for i, v in enumerate(x):
        state = v > on if not state else v > off
        out[i] = state
    return out


def activity(stems, mix):
    em = uniform_filter1d(frame_energy(mix), 10)
    floor = em.max() * 10 ** (-45 / 10)
    lanes, shares = {}, {}
    for name, x in stems.items():
        es = uniform_filter1d(frame_energy(x), 10)
        share = np.clip(es / (em + 1e-12), 0, 1.5)
        share[em < floor] = 0
        on, off = THR[name]
        act = hysteresis(share, on, off)
        lanes[name] = segments(act, 10, max_gap=4.0 if name == "drums" else 1.5)
        shares[name] = share
    return lanes, shares, em


def a_weight(f):
    f2 = f ** 2
    ra = 12194 ** 2 * f2 ** 2 / ((f2 + 20.6 ** 2) * np.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))
    return (ra * 10 ** (2.0 / 20)) ** 2


def stage_stats(x, name):
    f, t, E, D, pan, phase = stage.analyse(x)
    Ea = (E * a_weight(f)[:, None]).sum(0)  # perceived loudness per frame
    lo, hi = BANDS.get(name, (120, 12000))
    rows = (f >= lo) & (f < hi)
    E, D, pan = E[rows], D[rows], pan[rows]
    tot = E.sum(0)
    act = tot > tot.max() * 10 ** (-35 / 10)
    Ed = E * D
    w, p = Ed[:, act], pan[:, act]
    ws = w.sum() + 1e-12
    center = float((w * p).sum() / ws)
    spread = float(np.sqrt((w * (p - center) ** 2).sum() / ws))
    left = float(w[p < -0.35].sum() / ws)
    right = float(w[p > 0.35].sum() / ws)
    lm, rm = p < -0.35, p > 0.35
    lmean = float((w[lm] * p[lm]).sum() / (w[lm].sum() + 1e-12)) if lm.any() else -0.6
    rmean = float((w[rm] * p[rm]).sum() / (w[rm].sum() + 1e-12)) if rm.any() else 0.6
    # envelopes of direct / ambient parts (hop 46 ms)
    Pd, Pa = Ed.sum(0), (E * (1 - D)).sum(0)
    M = maximum_filter1d(Pd, size=9, origin=4)  # recent max over ~0.4 s
    peak = Pd.max()
    sustain = (Pd >= 0.5 * M) & act
    release = (Pd <= M * 10 ** (-1.2)) & (M > peak * 10 ** (-3.0))
    steady_amb = float(np.median(Pa[sustain] / (Pa[sustain] + Pd[sustain] + 1e-12))) if sustain.any() else 0.0
    if release.sum() >= 10:
        tail_db = float(10 * np.log10(np.median(Pa[release] / (M[release] + 1e-12)) + 1e-9))
    else:  # sound never stops long enough to hear a tail: fall back to the steady share
        tail_db = float(10 * np.log10(steady_amb + 1e-6))
    loud_db = float(10 * np.log10(tot[act].mean() + 1e-12))
    loud_a_db = float(10 * np.log10(Ea[act].mean() + 1e-12))
    return dict(center=center, spread=spread, left=left, right=right, lmean=lmean, rmean=rmean,
                loud_a_db=loud_a_db,
                steady_amb=steady_amb, tail_db=tail_db, loud_db=loud_db,
                release_frames=int(release.sum()))


def parts(x, name, win=10.0, hop=5.0):
    """Separate placements inside one stem (e.g. two guitars hard L/R).

    Whole-song pan histograms are smooth hills; parts show up as peaks in
    short windows, so we pick peaks per window and cluster them by pan.
    """
    from scipy.signal import find_peaks
    f, t, Z = stft(x, fs=SR, nperseg=4096, noverlap=2048, boundary=None)
    lo, hi = BANDS.get(name, (120, 12000))
    r = (f >= lo) & (f < hi)
    L, R = np.abs(Z[0, r]), np.abs(Z[1, r])
    del Z
    pan = np.arctan2(R, L) / (np.pi / 4) - 1
    E = L ** 2 + R ** 2
    tot = E.sum(0)
    act = tot > tot.max() * 10 ** -3.5
    edges = np.linspace(-1, 1, 41)
    cen = (edges[:-1] + edges[1:]) / 2
    found, nwin = [], 0
    for t0 in np.arange(0, max(t[-1] - win / 2, hop), hop):
        m = act & (t >= t0) & (t < t0 + win)
        if m.sum() < 0.3 * win / (2048 / SR):
            continue
        nwin += 1
        h, _ = np.histogram(pan[:, m].ravel(), edges, weights=E[:, m].ravel())
        hs = gaussian_filter(h, 0.7)
        hd = 10 * np.log10(hs / hs.max() + 1e-6)
        pk, _ = find_peaks(np.r_[-60, hd, -60], prominence=3, height=-10)
        for p in pk - 1:
            near = np.abs(cen - cen[p]) <= 0.1
            found.append((float(cen[p]), float(h[near].sum() / h.sum()), t0))
    clusters = []
    for p, w, t0 in sorted(found):
        if clusters and p - clusters[-1]["pans"][-1] <= 0.2:
            c = clusters[-1]
        else:
            c = dict(pans=[], ws=[], wins=set())
            clusters.append(c)
        c["pans"].append(p), c["ws"].append(w), c["wins"].add(t0)
    out = []
    for c in clusters:
        ws = np.array(c["ws"])
        out.append(dict(pan=round(float((np.array(c["pans"]) * ws).sum() / ws.sum()), 2),
                        presence=round(len(c["wins"]) / max(nwin, 1), 2), weight=float(ws.sum())))
    total = sum(o["weight"] for o in out) or 1
    for o in out:
        o["weight"] = round(o["weight"] / total, 3)
    out = [o for o in out if o["presence"] >= 0.12 or o["weight"] >= 0.1]
    return sorted(out, key=lambda o: -o["weight"])


def beats(drums, have_drums):
    import librosa
    y = drums.mean(0)
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=512)
    tempo, bt = librosa.beat.beat_track(onset_envelope=env, sr=SR, hop_length=512)
    times = librosa.frames_to_time(bt, sr=SR, hop_length=512)
    return float(np.atleast_1d(tempo)[0]), [round(float(v), 2) for v in times]


def load_stems(d):
    return {s: stage.load(os.path.join(d, f"{s}.flac")) for s in STEMS}


def analyse_track(mix_path, stem_dir):
    mix = stage.load(mix_path)
    stems = load_stems(stem_dir)
    dur = mix.shape[1] / SR
    lanes, shares, em = activity(stems, mix)
    present = {}
    for s in STEMS:
        act_time = sum(b - a for a, b in lanes[s])
        mean_share = float(shares[s][shares[s] > THR[s][1]].mean()) if (shares[s] > THR[s][1]).any() else 0
        present[s] = dict(seconds=round(act_time, 1), frac=round(act_time / dur, 3), share=round(mean_share, 3))
    st = {s: stage_stats(stems[s], s) for s in STEMS if present[s]["frac"] >= 0.05}
    for s in st:
        st[s]["parts"] = parts(stems[s], s)
    tempo, bt = beats(stems["drums"], present["drums"]["frac"] > 0.1)
    mix_st = stage_stats(mix, "mix")
    return dict(dur=round(dur, 1), lanes=lanes, present=present, stage=st, mix=mix_st, tempo=round(tempo, 1),
                beats=bt), shares, em


