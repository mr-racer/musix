"""The energy envelope (spec §2 `sonic`): RMS in 4 bands at 10 Hz for the whole track,
so clients draw the spectrum wave in sync with the playhead from a few KB, instead of an
AnalyserNode on the web or Android's RECORD_AUDIO-gated Visualizer.

Format (clients decode it): zlib of uint8 frames × 4 bands, row-major, 10 frames/s;
each band's dB is mapped from [track max − 60 dB, track max] onto 0..255.

The spectrum (design refresh spec §6.2) is the same thing in 16 log-spaced bands,
40 Hz – 12 kHz, decoded at 24 kHz: the player draws a frequency curve above the seek line
from it. Log-spaced bands sum to a flat line on pink noise, so music fills the whole curve
without a tilt. The 4-band envelope stays for the apps already installed."""

from __future__ import annotations

import asyncio
import itertools
import zlib

import numpy as np

SR, HOP, N_FFT = 12_000, 1_200, 2_048  # 10 frames per second exactly
BANDS_HZ = ((20, 250), (250, 1_000), (1_000, 4_000), (4_000, 6_000))
RANGE_DB = 60.0
SPEC_SR, SPEC_HOP, SPEC_FFT = 24_000, 2_400, 4_096  # 10 frames per second exactly
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
    """(frames, 16) uint8: the spectrum, from audio decoded at SPEC_SR."""
    return _bands(y, SPEC_SR, SPEC_HOP, SPEC_FFT, SPEC_BANDS_HZ)


def pack(env: np.ndarray) -> bytes:
    return zlib.compress(env.tobytes(), level=9)


def unpack(blob: bytes, bands: int = len(BANDS_HZ)) -> np.ndarray:
    return np.frombuffer(zlib.decompress(blob), np.uint8).reshape(-1, bands)
