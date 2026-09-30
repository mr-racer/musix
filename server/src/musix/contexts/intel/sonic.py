"""Sonic axes and tags from a CLAP vector (v1 `clap_features` + `sonic_descriptor`).

The prompt wording is v1's, unchanged: the axes were tuned against listening tests and
the «Поток» energy preset is validated on them (stream spec §2.3, AUC 0.99). Antonym
pairs become differential axes (the difference of two cosines cancels the shared
"music-ness"); axes are stored RAW — normalisation, if any, happens at read time."""

from __future__ import annotations

import numpy as np

AXIS_PROMPTS: dict[str, str] = {
    "calm": "a calm, relaxing, peaceful and quiet song with soft, gentle, airy sound",
    "energetic": "an energetic, powerful track — either intense and driving or heavy "
    "and bass-driven with deep low-end and hard-hitting groovy drums",
    "vocal": "a vocal-led song where singing or rap is the main focus, with strong "
    "prominent lead vocals carrying the track",
    "instrumental": "an instrument-led track where music and instruments are the main "
    "focus, with little or no singing, vocals in the background or absent",
    "spacious": "a song with a spacious, wide, open sound — lush reverb, echo and delay "
    "effects, a deep sense of space and a broad immersive stereo image",
    "experimental": "experimental track with erratic shifting rhythm, abrupt beat changes, "
    "distorted gritty texture, chaotic and unpredictable",
    "stable": "conventional track with steady predictable beat, smooth transitions, "
    "clean polished texture, orderly and consistent",
    "bright": "a bright track with sparkling, crisp, airy high frequencies and lots of treble",
    "dark": "a dark track with dull, muffled, subdued tone and rolled-off, recessed "
    "high frequencies",
    "acoustic": "a track played on real live acoustic instruments: piano, acoustic guitar, "
    "strings, drums, brass and woodwinds",
    "synthetic": "an electronic track built from synthesizers, drum machines, samplers "
    "and digital programmed sounds",
}
AXIS_NAMES = ("energy", "vocal_lead", "spacious", "experimental", "brightness", "acousticness")
_I = {name: i for i, name in enumerate(AXIS_PROMPTS)}

# v1 DEFAULT_VOCAB: the adjective tags shown on a track
TAG_VOCAB: tuple[str, ...] = (
    *("explosive", "driving", "punchy", "mid-tempo", "languid", "ambient", "drone"),
    *("euphoric", "joyful", "hopeful", "neutral mood", "melancholy", "anxious", "dark"),
    *("minimal arrangement", "sparse", "lush", "wall-of-sound"),
    *("clean production", "warm", "raw", "lo-fi", "polished", "saturated", "crystalline"),
    *("acoustic guitar", "piano-led", "orchestral", "synth-heavy", "electronic", "guitar-driven"),
    *("instrumental", "sparse vocals", "lead vocals prominent", "harmony-rich"),
    *("4/4 steady", "swung", "syncopated", "free-time", "motorik"),
)
TOP_TAGS = 5


def _unit(m: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(m, axis=-1, keepdims=True)
    return m / np.where(n == 0, 1, n)


def axes(clap: np.ndarray, prompt_emb: np.ndarray) -> dict[str, float]:
    """One unit CLAP vector + the AXIS_PROMPTS embeddings (rows in AXIS_PROMPTS order)."""
    s = _unit(prompt_emb) @ _unit(clap)
    cols = (
        s[_I["energetic"]] - s[_I["calm"]],
        s[_I["vocal"]] - s[_I["instrumental"]],
        s[_I["spacious"]],
        s[_I["experimental"]] - s[_I["stable"]],
        s[_I["bright"]] - s[_I["dark"]],
        s[_I["acoustic"]] - s[_I["synthetic"]],
    )
    return {name: float(v) for name, v in zip(AXIS_NAMES, cols, strict=True)}


def tags(clap: np.ndarray, vocab_emb: np.ndarray) -> list[dict[str, float | str]]:
    sims = _unit(vocab_emb) @ _unit(clap)
    return [{"tag": TAG_VOCAB[i], "score": float(sims[i])} for i in np.argsort(-sims)[:TOP_TAGS]]
