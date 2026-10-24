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
VERSION = 1  # sound_analysis.extractor_ver: bump when the measures change shape or meaning

# calib.py FAM: family -> (tag classes, where they count)
FAM = {
    "guitar": (["Guitar", "Electric guitar", "Acoustic guitar", "Plucked string instrument", "Strum"], ["guitar", "mix"]),
    "piano": (["Piano", "Electric piano", "Keyboard (musical)"], ["piano", "mix"]),
    "organ": (["Organ", "Hammond organ", "Electronic organ"], ["other", "piano", "mix"]),
    "strings": (["Orchestra", "String section", "Violin, fiddle", "Cello", "Bowed string instrument", "Pizzicato"], ["other", "mix"]),
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
}
# features5.nonmusic_mass: voices, rooms and generic noise are not unusual sounds in a song
VOICE_ROOM = {
    "Speech", "Male speech, man speaking", "Female speech, woman speaking", "Child speech, kid speaking", "Conversation",
    "Narration, monologue", "Babbling", "Singing", "Choir", "Yodeling", "Chant", "Mantra", "Male singing", "Female singing",
    "Child singing", "Synthetic singing", "Rapping", "Humming", "Speech synthesizer", "Shout", "Bellow", "Whoop", "Yell",
    "Children shouting", "Screaming", "Whistling", "Clapping", "Finger snapping", "Hands", "Cheering", "Applause", "Crowd",
    "Hubbub, speech noise, speech babble", "Silence", "Inside, small room", "Inside, large room or hall",
    "Inside, public space", "Outside, urban or manmade", "Outside, rural or natural", "Reverberation", "Echo", "Noise",
    "Environmental noise", "Static", "Mains hum", "Distortion", "Sidetone", "Cacophony", "White noise", "Pink noise",
    "Sound effect", "Pulse", "Hum",
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
    S = librosa.feature.melspectrogram(
        y=y, sr=22050, n_fft=2048, hop_length=1024, n_mels=64, fmin=40, fmax=11000
    )
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


def stage_frames(work: str, dur: float) -> bytes:
    """The live stage: per 100 ms frame and stem, level (dB below the track's loudest stem
    frame, 0..-60 → int8 0..-120 in half-dB) and pan (-1..1 → int8 -100..100).
    gzip(int8[frames][6][2])."""
    hop = stage.SR // STAGE_FPS
    n = int(dur * STAGE_FPS)
    out = np.zeros((n, len(STEMS), 2), np.int8)
    lv = np.full((n, len(STEMS)), -1e9)
    for i, s in enumerate(STEMS):
        p = os.path.join(work, f"{s}.flac")
        if not os.path.exists(p):
            continue
        x = stage.load(p)
        m = min(n, x.shape[1] // hop)
        fr = x[:, : m * hop].reshape(2, m, hop)
        el, er = (fr[0] ** 2).mean(1), (fr[1] ** 2).mean(1)
        lv[:m, i] = 10 * np.log10(el + er + 1e-12)
        out[:m, i, 1] = np.round(100 * (np.sqrt(er) - np.sqrt(el)) / (np.sqrt(er) + np.sqrt(el) + 1e-9))
    rel = np.clip(lv - lv.max(), -60, 0)
    out[:, :, 0] = np.round(rel * 2).astype(np.int8)
    return gzip.compress(out.tobytes(), 6)


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
    an = A.analyse(mix_path, work, lrc)
    for p in an["parts"].values():
        p.pop("env", None)  # per-hop drum envelopes: used inside analyse only
    dur = an["res"]["dur"]
    tz = np.load(os.path.join(work, "tags.npz"))
    tags = {n: tz[n] for n in tz.files}
    beats = json.load(open(os.path.join(work, "beats.json")))
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
    )
    tp = tagall or os.path.join(work, "tagall.npz")
    if os.path.exists(tp):
        z = np.load(tp)
        extra["mix527"] = mix_classes(list(z["labels"]), z["mix"].astype(np.float32), z["starts"])
    return dict(v=VERSION, an=_jsonable(an), extra=_jsonable(extra)), stage_frames(work, dur)

