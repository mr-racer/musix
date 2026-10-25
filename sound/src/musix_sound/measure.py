"""The CPU phase for one track: everything that needs the stems, turned into one JSON-able
`measures` document plus the live-stage frames. The stems are gone after the batch, so
whatever the server's derive step reads from the audio must be here (spec §6.4, §8).

`an` is the v3 analysis (proto/analyse.py) as it was. `extra` holds the audio reads of
demo 4's features5.py, each next to the name of the prototype function it replaces:
derive runs that function's logic on these numbers instead of on the files."""

from __future__ import annotations

import base64
import gzip
import json
import os
import subprocess
from typing import Any

import numpy as np

from musix_sound.proto import analyse as A
from musix_sound.proto import stage

STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"]
MELODIC = ("guitar", "piano", "other")
STAGE_FPS = 10
# v2: the drums stand on the stage as their DrumSep parts (owner, Mad Visions: the hi-hat that
# plays from the start was nowhere to be seen inside one «барабаны» plate)
STAGE_STEMS = ["vocals", "kick", "snare", "hats", "toms", "bass", "guitar", "piano", "other"]
STAGE_SRC = {"kick": ["dr_kick"], "snare": ["dr_snare"], "hats": ["dr_hh", "dr_crash", "dr_ride"], "toms": ["dr_toms"]}
# v2: 808 tails moved from the kick into the bass, stage parts, voice tags on the melodic
# stems, bass harmonics, stage-on segments and part entries inside a stem
VERSION = 2  # sound_analysis.extractor_ver: bump when the measures change shape or meaning

# calib.py FAM: family -> (tag classes, where they count)
FAM = {
    "guitar": (
        ["Guitar", "Electric guitar", "Acoustic guitar", "Plucked string instrument", "Strum"],
        ["guitar", "mix"],
    ),
    "piano": (["Piano", "Electric piano", "Keyboard (musical)"], ["piano", "mix"]),
    "organ": (["Organ", "Hammond organ", "Electronic organ"], ["other", "piano", "mix"]),
    "strings": (
        ["Orchestra", "String section", "Violin, fiddle", "Cello", "Bowed string instrument", "Pizzicato"],
        ["other", "mix"],
    ),
    "brass": (["Brass instrument", "Trumpet", "Trombone", "French horn"], ["other", "mix"]),
    "woodwind": (["Saxophone", "Flute", "Clarinet", "Wind instrument, woodwind instrument"], ["other", "mix"]),
    "synth": (["Synthesizer", "Electronic music", "Sampler"], ["other", "mix"]),
    "bass_guitar": (["Bass guitar"], ["bass", "mix"]),
}
# features5.WindowTags.name_at / moments: class groups looked up per window on the melodic stems
WIN_GROUPS = {
    "guitar": FAM["guitar"][0],
    "piano": ["Piano", "Electric piano"],
    "kb": ["Keyboard (musical)", "Organ", "Hammond organ", "Electronic organ"],
    "synth": ["Synthesizer"],
    "strings": FAM["strings"][0],
    "brass": FAM["brass"][0],
    "keys": ["Piano", "Electric piano", "Keyboard (musical)", "Organ", "Hammond organ", "Electronic organ"],
    # Bound 2's soul sample sat in the "other" stem as «синты»: a voice there is a vocal sample
    "voice": ["Singing", "Male singing", "Female singing", "Rapping", "Speech", "Choir", "Humming",
              "Male speech, man speaking", "Female speech, woman speaking", "Synthetic singing"],
}
# features5.nonmusic_mass: voices, rooms and generic noise are not unusual sounds in a song
VOICE_ROOM = {
    "Speech",
    "Male speech, man speaking",
    "Female speech, woman speaking",
    "Child speech, kid speaking",
    "Conversation",
    "Narration, monologue",
    "Babbling",
    "Singing",
    "Choir",
    "Yodeling",
    "Chant",
    "Mantra",
    "Male singing",
    "Female singing",
    "Child singing",
    "Synthetic singing",
    "Rapping",
    "Humming",
    "Speech synthesizer",
    "Shout",
    "Bellow",
    "Whoop",
    "Yell",
    "Children shouting",
    "Screaming",
    "Whistling",
    "Clapping",
    "Finger snapping",
    "Hands",
    "Cheering",
    "Applause",
    "Crowd",
    "Hubbub, speech noise, speech babble",
    "Silence",
    "Inside, small room",
    "Inside, large room or hall",
    "Inside, public space",
    "Outside, urban or manmade",
    "Outside, rural or natural",
    "Reverberation",
    "Echo",
    "Noise",
    "Environmental noise",
    "Static",
    "Mains hum",
    "Distortion",
    "Sidetone",
    "Cacophony",
    "White noise",
    "Pink noise",
    "Sound effect",
    "Pulse",
    "Hum",
}
CLASS_KEEP_P = 0.25  # per-class summaries of the 527 mix tags: the lowest bar derive applies is 0.25


def _mono8k(path: str) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "8000", "-"],
        capture_output=True,
    ).stdout
    return np.frombuffer(raw, np.float32)


def stem_shares(work: str) -> dict[str, float]:
    """features5.stem_shares."""
    e = {}
    for s in STEMS:
        p = os.path.join(work, f"{s}.flac")
        if os.path.exists(p):
            x = _mono8k(p)
            e[s] = float((x**2).mean()) if len(x) else 0.0
    tot = sum(e.values()) or 1.0
    return {s: v / tot for s, v in e.items()}


def claim_evidence(tags: Any) -> dict[str, Any]:
    """calib.evidence without the shares (derive adds them)."""
    C = list(tags["classes"])
    ev: dict[str, Any] = {}
    for fam, (classes, where) in FAM.items():
        cols = []
        for st in where:
            P = tags[st].astype(np.float32)
            idx = [C.index(c) for c in classes if c in C]
            fam_p = P[:, idx].max(1)
            cols.append(float(np.percentile(fam_p, 75)))
            cols.append(float(np.percentile(fam_p, 95)))
        ev[fam] = cols
    D = tags["drums"].astype(np.float32)
    M = tags["mix"].astype(np.float32)
    kit = [C.index(c) for c in ("Drum kit", "Drum", "Snare drum", "Drum roll", "Cymbal") if c in C]
    mac = [C.index(c) for c in ("Drum machine", "Electronic music", "Sampler") if c in C]
    ev["drums_live"] = [
        float(np.percentile(D[:, kit].max(1), 75) - np.percentile(D[:, mac].max(1), 75)),
        float(np.percentile(M[:, kit].max(1), 75) - np.percentile(M[:, mac].max(1), 75)),
    ]
    return ev


def b64(a: np.ndarray, dtype: str) -> str:
    """Arrays travel as base64 of their exact values: a tag at 0.29997 must stay under a 0.3 bar."""
    return base64.b64encode(np.ascontiguousarray(a, dtype=dtype).tobytes()).decode()


def window_groups(tags: Any) -> dict[str, dict[str, str]]:
    """Per melodic stem (and the mix), per class group, the max probability per 10 s window
    (float16, as the tagger's output is stored): what features5.WindowTags,
    orchestral_peaks and the keys-entry moment read."""
    C = list(tags["classes"])
    out: dict[str, dict[str, str]] = {}
    for stem in ("mix", *MELODIC):
        if stem not in tags:
            continue
        P = tags[stem]
        out[stem] = {}
        for g, classes in WIN_GROUPS.items():
            idx = [C.index(c) for c in classes if c in C]
            if idx:
                out[stem][g] = b64(P[:, idx].max(1), "<f2")
    return out


def onset_counts(path: str, n: int, fps: int = 2) -> list[int] | None:
    """features5.attack_rate's onsets, binned into the 2 fps frames of its lane mask (`n` long)."""
    import librosa

    if not os.path.exists(path):
        return None
    y, sr = librosa.load(path, sr=22050, mono=True)
    on = librosa.onset.onset_detect(y=y, sr=sr, units="time", backtrack=False, delta=0.12)
    counts = np.zeros(n, int)
    if len(on):
        np.add.at(counts, np.clip((on * fps).astype(int), 0, n - 1), 1)
    return counts.tolist()


def spectral_fill(mix_path: str) -> float | None:
    """features5.spectral_fill."""
    import librosa

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", mix_path, "-f", "f32le", "-ac", "1", "-ar", "22050", "-"],
        capture_output=True,
    ).stdout
    y = np.frombuffer(raw, np.float32)
    if not len(y):
        return None
    S = librosa.feature.melspectrogram(y=y, sr=22050, n_fft=2048, hop_length=1024, n_mels=64, fmin=40, fmax=11000)
    db = librosa.power_to_db(S, ref=1.0)
    top = db.max(0)
    loud = top > top.max() - 30
    return float(np.median((db >= top - 20).mean(0)[loud]))


def stem_db(work: str, stem: str, fps: int = 2) -> str | None:
    """features5.stem_db (float32, base64)."""
    p = os.path.join(work, f"{stem}.flac")
    if not os.path.exists(p):
        return None
    x = _mono8k(p)
    n = 8000 // fps
    m = len(x) // n
    db = 10 * np.log10((x[: m * n].reshape(m, n) ** 2).mean(1) + 1e-10)
    return b64(db, "<f4")


def mix_classes(labels: list[str], P: np.ndarray, starts: np.ndarray) -> dict[str, Any]:
    """The 527-class mix tags, reduced to what features5.nonmusic_mass and odd_sounds read:
    the per-window top-3 sum outside music and voices, its four strongest classes, and per
    class that ever reaches 0.25 its max, where it peaks and where it is 0.3+."""
    i0, i1 = labels.index("Music"), labels.index("Scary music")
    idx = [i for i, c in enumerate(labels) if not (i0 <= i <= i1) and c not in VOICE_ROOM]
    top3 = np.sort(P[:, idx], 1)[:, -3:].sum(1)
    best = [[labels[idx[j]], float(P[:, idx[j]].max())] for j in np.argsort(-P[:, idx].max(0))[:4]]
    classes = {}
    for j in np.where(P.max(0) >= CLASS_KEEP_P)[0]:
        col = P[:, j]
        classes[labels[j]] = dict(
            max=float(col.max()),
            argmax_t=float(starts[int(col.argmax())]),
            strong_t=[float(starts[i]) for i in np.where(col >= 0.3)[0]],
        )
    return dict(top3=b64(top3, "<f4"), best=best, classes=classes)


def _write_flac(path: str, x: np.ndarray) -> None:
    """Stereo float32 → FLAC in place (24 bit, as the separator writes them)."""
    tmp = path + ".tmp.flac"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(stage.SR), "-i", "-",
         "-c:a", "flac", "-sample_fmt", "s32", tmp],
        input=np.ascontiguousarray(x.T, np.float32).tobytes(), check=True,
    )
    os.replace(tmp, path)


def move_808(work: str) -> dict[str, Any] | None:
    """An 808 that sounds on the kick hits is a bass note the separator filed as drums (owner,
    2026-10-25, Stronger: «бас подшит драм-машине»; 91 % of its sub was in drums, 98 % of that
    in the DrumSep kick). A hit whose sub (< 130 Hz) still holds within 12 dB at 300 ms and is
    a clean tone rings like a note: its sub from 70 ms after the hit to the next one moves from
    the kick (and drums) into the bass. A live kick dies 30-100 dB by then and a bass guitar
    bleeding into it is a smeared tone, so Royal Blood, Jay-Z, Flashing Lights stay as they were.
    The stems are rewritten in place, so every later read (lanes, shares, the stage) agrees."""
    from scipy.signal import find_peaks, istft, stft

    paths = {s: os.path.join(work, f"{s}.flac") for s in ("dr_kick", "drums", "bass")}
    if not all(os.path.exists(p) for p in paths.values()):
        return None
    k = stage.load(paths["dr_kick"])
    n = k.shape[1]
    hop, nper = 256, 2048
    f, _, Z = stft(k, fs=stage.SR, nperseg=nper, noverlap=nper - hop, boundary=None)
    P = (np.abs(Z) ** 2).mean(0)
    sub = f < 130
    fps = stage.SR / hop
    e = 10 * np.log10(P[sub].sum(0) + 1e-12)
    pk, _ = find_peaks(e, height=np.percentile(e, 97) - 15, distance=int(0.12 * fps), prominence=6)
    M = np.zeros(P.shape, bool)
    ring = 0
    for j, i in enumerate(pk):
        nxt = pk[j + 1] if j + 1 < len(pk) else len(e)
        a, b = i + int(0.07 * fps), i + int(0.30 * fps)
        if b >= min(nxt, len(e)) or e[i] - e[b] >= 12:
            continue
        seg = P[sub][:, a:b].mean(1)
        if seg.max() / (np.median(seg) + 1e-12) < 15:
            continue
        ring += 1
        M[sub, a:nxt] = True
    out = dict(hits=int(len(pk)), ring=int(ring), tail_db=None)
    if not ring:
        return out
    _, y = istft(Z * M[None], fs=stage.SR, nperseg=nper, noverlap=nper - hop, boundary=None)
    y = stage.fit(y.astype(np.float32), n)
    bass = stage.fit(stage.load(paths["bass"]), n)
    drums = stage.fit(stage.load(paths["drums"]), n)
    out["tail_db"] = float(10 * np.log10((y**2).sum() / ((bass**2).sum() + 1e-12) + 1e-12))
    _write_flac(paths["bass"], bass + y)
    _write_flac(paths["drums"], drums - y)
    _write_flac(paths["dr_kick"], k - y)
    return out


def _levels(work: str, srcs: list[str], n: int, hop: int) -> tuple[np.ndarray, np.ndarray] | None:
    """Per-frame power of the left and right channel summed over the source stems."""
    el = er = None
    for s in srcs:
        p = os.path.join(work, f"{s}.flac")
        if not os.path.exists(p):
            continue
        x = stage.load(p)
        m = min(n, x.shape[1] // hop)
        fr = np.zeros((2, n, hop), np.float32)
        fr[:, :m] = x[:, : m * hop].reshape(2, m, hop)
        l, r = (fr[0] ** 2).mean(1), (fr[1] ** 2).mean(1)
        el, er = (l, r) if el is None else (el + l, er + r)
    return None if el is None else (el, er)


def stage_frames(work: str, dur: float) -> bytes:
    """The live stage: per 100 ms frame and STAGE_STEMS part, level (dB below the track's
    loudest part frame, 0..-60 → int8 0..-120 in half-dB) and pan (-1..1 → int8 -100..100).
    gzip(int8[frames][9][2]). Without DrumSep parts the drums stem stands in for the kick."""
    hop = stage.SR // STAGE_FPS
    n = int(dur * STAGE_FPS)
    out = np.zeros((n, len(STAGE_STEMS), 2), np.int8)
    lv = np.full((n, len(STAGE_STEMS)), -1e9)
    have_parts = os.path.exists(os.path.join(work, "dr_kick.flac"))
    for i, s in enumerate(STAGE_STEMS):
        if have_parts:
            srcs = STAGE_SRC.get(s, [s])
        else:
            srcs = ["drums"] if s == "kick" else [] if s in STAGE_SRC else [s]
        lr = _levels(work, srcs, n, hop) if srcs else None
        if lr is None:
            continue
        el, er = lr
        lv[:, i] = 10 * np.log10(el + er + 1e-12)
        out[:, i, 1] = np.round(100 * (np.sqrt(er) - np.sqrt(el)) / (np.sqrt(er) + np.sqrt(el) + 1e-9))
    rel = np.clip(lv - lv.max(), -60, 0)
    out[:, :, 0] = np.round(rel * 2).astype(np.int8)
    return gzip.compress(out.tobytes(), 6, mtime=0)  # the same track, the same bytes


def stage_on(frames: bytes) -> dict[str, list[list[float]]]:
    """Where the player puts each part on the stage (StageScene.life, the same numbers): over
    its gate (-38 dB under the loudest frame, or 24 dB under its own p90) for 6 s or more in the
    song, gaps under 1 s closed, blips under 0.3 s dropped. derive names a part from the tags of
    exactly these stretches, and a part it cannot name stays off the stage."""
    a = np.frombuffer(gzip.decompress(frames), np.int8).reshape(-1, len(STAGE_STEMS), 2)
    out: dict[str, list[list[float]]] = {}
    for i, s in enumerate(STAGE_STEMS):
        db = a[:, i, 0] / 2
        over = db[db > -38]
        if len(over) < STAGE_FPS * 6:
            continue
        gate = max(-38.0, float(np.percentile(over, 90)) - 24)
        segs: list[list[int]] = []
        for f in np.where(db > gate)[0]:
            if segs and f - segs[-1][1] < STAGE_FPS:
                segs[-1][1] = f + 1
            else:
                segs.append([int(f), int(f) + 1])
        out[s] = [[a0 / STAGE_FPS, b0 / STAGE_FPS] for a0, b0 in segs if b0 - a0 >= 3]
    return out


def bass_harm(work: str) -> float | None:
    """Overtones of the bass stem: median of 400-3000 Hz against 30-200 Hz (dB) where it plays.
    A pure sub under -58 dB was a synth bass or an 808 on all 6 known cases; above that a bass
    guitar and a synth bass cannot be told apart by this (2026-10-25)."""
    from scipy.signal import stft

    p = os.path.join(work, "bass.flac")
    if not os.path.exists(p):
        return None
    x = stage.load(p).mean(0)
    f, _, Z = stft(x, fs=stage.SR, nperseg=4096, noverlap=4096 - 512, boundary=None)
    P = np.abs(Z) ** 2
    lo, hi = P[(f >= 30) & (f < 200)].sum(0), P[(f >= 400) & (f < 3000)].sum(0)
    tot = P[(f >= 30) & (f < 5000)].sum(0)
    loud = tot > np.percentile(tot, 95) * 10 ** -2.5
    if loud.sum() < 50:
        return None
    return float(np.median(10 * np.log10(hi[loud] / (lo[loud] + 1e-12) + 1e-12)))


def part_entries(work: str, on: dict[str, list[list[float]]]) -> dict[str, list[float]]:
    """A new part coming in inside a stem that already plays (owner, Le Départ: a synth line at
    0:26 inside the «синты» that sound from 0:04; the plate's level did not move). Read as a
    lasting change of the stem's timbre: the log-mel shape of the next 6 s against the last 8 s,
    both inside the stem's stage stretches, the new state steady, at most 5 per stem, 20 s apart.
    These are candidates: on the 57 demo tracks 45 % fell on a section edge (random times 17-25 %),
    so derive keeps only those at a section edge."""
    import librosa

    out: dict[str, list[float]] = {}
    for s in MELODIC:
        segs = on.get(s)
        p = os.path.join(work, f"{s}.flac")
        if not segs or not os.path.exists(p):
            continue
        y, sr = librosa.load(p, sr=22050, mono=True)
        S = librosa.feature.melspectrogram(y=y, sr=sr, n_fft=2048, hop_length=11025, n_mels=32, fmin=60, fmax=11000)
        L = np.log10(S + 1e-9)
        L = L - L.max(0, keepdims=True)  # shape, not level
        L = np.maximum(L, -4) + 4
        L = L / (np.linalg.norm(L, axis=0, keepdims=True) + 1e-9)
        fps = 2
        T = L.shape[1]
        play = np.zeros(T, bool)
        for a, b in segs:
            play[int(a * fps): int(b * fps)] = True
        cand = []
        for t in range(16, T - 12):
            if not (play[t - 16:t].all() and play[t:t + 12].all()):
                continue
            pre, post = L[:, t - 16:t].mean(1), L[:, t:t + 12].mean(1)
            d = 1 - float(pre @ post / (np.linalg.norm(pre) * np.linalg.norm(post) + 1e-9))
            spread = float(np.mean([1 - L[:, j] @ post / (np.linalg.norm(post) + 1e-9) for j in range(t, t + 12)]))
            if d >= NOVELTY and d >= 1.5 * spread:
                cand.append((d, t / fps))
        picked: list[float] = []
        for d, t in sorted(cand, reverse=True):
            if all(abs(t - q) >= 20 for q in picked):
                picked.append(t)
            if len(picked) == 5:
                break
        if picked:
            out[s] = sorted(round(t, 1) for t in picked)
    return out


NOVELTY = 0.02  # cosine distance of the timbre shapes, loose on purpose: derive filters (2026-10-25)


def _jsonable(x: Any) -> Any:
    if isinstance(x, dict):
        return {str(k): _jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_jsonable(v) for v in x]
    if isinstance(x, np.ndarray):
        return _jsonable(x.tolist())
    if isinstance(x, np.generic):
        return x.item()
    return x


def measure(
    mix_path: str, work: str, lrc: str | None = None, tagall: str | None = None
) -> tuple[dict[str, Any], bytes]:
    """→ (measures, gzip stage frames). `work` holds the GPU stages' outputs for this track;
    `tagall` the 527-class mix tags (default `work`/tagall.npz)."""
    b808 = move_808(work)
    an = A.analyse(mix_path, work, lrc)
    for p in an["parts"].values():
        p.pop("env", None)  # per-hop drum envelopes: used inside analyse only
    dur = an["res"]["dur"]
    tz = np.load(os.path.join(work, "tags.npz"))
    tags = {n: tz[n] for n in tz.files}
    with open(os.path.join(work, "beats.json")) as f:
        beats = json.load(f)
    n2 = int(dur * 2) + 1
    extra: dict[str, Any] = dict(
        shares=stem_shares(work),
        claim_ev=claim_evidence(tags),
        win_starts=[float(v) for v in tags["starts"]],
        win=window_groups(tags),
        onsets2={s: onset_counts(os.path.join(work, f"{s}.flac"), n2) for s in ("bass", *MELODIC)},
        fill=spectral_fill(mix_path),
        drums_db=stem_db(work, "drums"),
        beats=beats["beats"],
        downbeats=beats["downbeats"],
        b808=b808,
        bass_harm=bass_harm(work),
        stage_stems=STAGE_STEMS,
    )
    tp = tagall or os.path.join(work, "tagall.npz")
    if os.path.exists(tp):
        z = np.load(tp)
        extra["mix527"] = mix_classes(list(z["labels"]), z["mix"].astype(np.float32), z["starts"])
    frames = stage_frames(work, dur)
    extra["stage_on"] = stage_on(frames)
    extra["part_entries"] = part_entries(work, extra["stage_on"])
    return dict(v=VERSION, an=_jsonable(an), extra=_jsonable(extra)), frames
