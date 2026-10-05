"""The energy envelope (spec §2 `sonic`): RMS in 4 bands at 10 Hz for the whole track,
so clients draw the spectrum wave in sync with the playhead from a few KB, instead of an
AnalyserNode on the web or Android's RECORD_AUDIO-gated Visualizer.

Format (clients decode it): zlib of uint8 frames × 4 bands, row-major, 10 frames/s;
each band's dB is mapped from [track max − 60 dB, track max] onto 0..255.

The spectrum (design refresh spec §6.2) is the same thing in 16 log-spaced bands,
40 Hz – 12 kHz, decoded at 24 kHz: the player draws a frequency curve above the seek line
from it. Log-spaced bands sum to a flat line on pink noise, so music fills the whole curve
without a tilt. The 4-band envelope stays for the apps already installed.

The spectrum's second format (2026-10-05): the owner found 10 frames a second over a 170 ms
window "slow and inexpressive", so it is 30 frames a second over an 85 ms window, and the
blob describes itself: `MXS2`, the frame rate, the band count, then zlib of the bands one
after another (band-major), each as its first value followed by the differences between
neighbouring frames modulo 256. Raw, 30 frames a second came to 88–117 KB a track (the
first format: 33–46 KB), too much for the disk the library lives on. Two things a drawn
curve does not need bring it back to 35–51 KB: a band rises at once but falls at most
~2.8 dB a frame (a peak hold: the deep random dips of a one-bin band are estimation noise,
not music), and levels are stored in 32 steps of ~1.9 dB. A blob without the magic is the
first format: readers treat it as missing and it is recomputed."""

from __future__ import annotations

import asyncio
import itertools
import zlib

import numpy as np

SR, HOP, N_FFT = 12_000, 1_200, 2_048  # 10 frames per second exactly
BANDS_HZ = ((20, 250), (250, 1_000), (1_000, 4_000), (4_000, 6_000))
RANGE_DB = 60.0
SPEC_SR, SPEC_HOP, SPEC_FFT = 24_000, 800, 2_048  # 30 frames per second exactly
SPEC_FPS = SPEC_SR // SPEC_HOP
SPEC_MAGIC = b"MXS2"
SPEC_FALL = 12  # of 255 a frame: the fastest a stored band falls (~85 dB a second)
SPEC_STEP_BITS = 3  # levels are multiples of 8
SPEC_BANDS = 16
_EDGES = np.geomspace(40.0, 12_000.0, SPEC_BANDS + 1)
SPEC_BANDS_HZ = tuple((float(lo), float(hi)) for lo, hi in itertools.pairwise(_EDGES))


async def decode(path: str, limit_s: float = 600, sr: int = SR) -> np.ndarray:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-i",
        path,
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        str(sr),
        "-f",
        "f32le",
        "-",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await asyncio.wait_for(proc.communicate(), timeout=limit_s)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {err.decode(errors='replace')[-300:]}")
    return np.frombuffer(out, dtype=np.float32)


def _bands(
    y: np.ndarray, sr: int, hop: int, n_fft: int, bands_hz: tuple[tuple[float, float], ...]
) -> np.ndarray:
    """(frames, len(bands_hz)) uint8."""
    if len(y) == 0:
        return np.zeros((0, len(bands_hz)), np.uint8)
    pad = np.pad(y, (n_fft // 2, n_fft // 2))
    n = 1 + (len(pad) - n_fft) // hop
    frames = np.lib.stride_tricks.as_strided(
        pad, shape=(n, n_fft), strides=(pad.strides[0] * hop, pad.strides[0])
    )
    window = np.hanning(n_fft).astype(np.float32)
    freqs = np.fft.rfftfreq(n_fft, 1 / sr)
    masks = [(freqs >= lo) & (freqs < hi) for lo, hi in bands_hz]
    bands = np.empty((n, len(bands_hz)), np.float64)
    for at in range(0, n, 512):  # in chunks: a 10-minute track at 24 kHz is not held whole
        power = np.abs(np.fft.rfft(frames[at : at + 512] * window, axis=1)) ** 2
        bands[at : at + 512] = np.stack([power[:, m].sum(axis=1) for m in masks], axis=1)
    db = 10 * np.log10(bands + 1e-12)
    top = db.max()
    out: np.ndarray = np.clip((db - (top - RANGE_DB)) / RANGE_DB * 255, 0, 255).astype(np.uint8)
    return out


def compute(y: np.ndarray) -> np.ndarray:
    """(frames, 4) uint8: the energy envelope."""
    return _bands(y, SR, HOP, N_FFT, BANDS_HZ)


def spectrum(y: np.ndarray) -> np.ndarray:
    """(frames, 16) uint8: the spectrum, from audio decoded at SPEC_SR. Peak-held and in
    coarse steps (the module docstring)."""
    out = _bands(y, SPEC_SR, SPEC_HOP, SPEC_FFT, SPEC_BANDS_HZ).astype(np.int16)
    for t in range(1, len(out)):
        np.maximum(out[t], out[t - 1] - SPEC_FALL, out=out[t])
    held: np.ndarray = (out.astype(np.uint8) >> SPEC_STEP_BITS) << SPEC_STEP_BITS
    return held


def pack(env: np.ndarray) -> bytes:
    return zlib.compress(env.tobytes(), level=9)


def unpack(blob: bytes, bands: int = len(BANDS_HZ)) -> np.ndarray:
    return np.frombuffer(zlib.decompress(blob), np.uint8).reshape(-1, bands)


def pack_spectrum(spec: np.ndarray) -> bytes:
    """(frames, bands) uint8 → the self-describing blob (the module docstring)."""
    bands = spec.shape[1]
    major = np.ascontiguousarray(spec.T)  # (bands, frames)
    delta = np.diff(major, axis=1, prepend=np.zeros((bands, 1), np.uint8))  # wraps modulo 256
    return SPEC_MAGIC + bytes([SPEC_FPS, bands]) + zlib.compress(delta.tobytes(), level=9)


def unpack_spectrum(blob: bytes) -> np.ndarray:
    """The blob → (frames, bands) uint8."""
    if blob[:4] != SPEC_MAGIC:
        raise ValueError("not a spectrum of the second format")
    delta = np.frombuffer(zlib.decompress(blob[6:]), np.uint8).reshape(blob[5], -1)
    out: np.ndarray = np.cumsum(delta, axis=1, dtype=np.uint8).T
    return out
