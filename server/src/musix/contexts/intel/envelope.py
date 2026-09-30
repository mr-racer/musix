"""The energy envelope (spec §2 `sonic`): RMS in 4 bands at 10 Hz for the whole track,
so clients draw the spectrum wave in sync with the playhead from a few KB, instead of an
AnalyserNode on the web or Android's RECORD_AUDIO-gated Visualizer.

Format (clients decode it): zlib of uint8 frames × 4 bands, row-major, 10 frames/s;
each band's dB is mapped from [track max − 60 dB, track max] onto 0..255."""

from __future__ import annotations

import asyncio
import zlib

import numpy as np

SR, HOP, N_FFT = 12_000, 1_200, 2_048  # 10 frames per second exactly
BANDS_HZ = ((20, 250), (250, 1_000), (1_000, 4_000), (4_000, 6_000))
RANGE_DB = 60.0


async def decode(path: str, limit_s: float = 600) -> np.ndarray:
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
        str(SR),
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


def compute(y: np.ndarray) -> np.ndarray:
    """(frames, 4) uint8."""
    if len(y) == 0:
        return np.zeros((0, len(BANDS_HZ)), np.uint8)
    pad = np.pad(y, (N_FFT // 2, N_FFT // 2))
    n = 1 + (len(pad) - N_FFT) // HOP
    frames = np.lib.stride_tricks.as_strided(
        pad, shape=(n, N_FFT), strides=(pad.strides[0] * HOP, pad.strides[0])
    )
    power = np.abs(np.fft.rfft(frames * np.hanning(N_FFT).astype(np.float32), axis=1)) ** 2
    freqs = np.fft.rfftfreq(N_FFT, 1 / SR)
    bands = np.stack(
        [power[:, (freqs >= lo) & (freqs < hi)].sum(axis=1) for lo, hi in BANDS_HZ], axis=1
    )
    db = 10 * np.log10(bands + 1e-12)
    top = db.max()
    out: np.ndarray = np.clip((db - (top - RANGE_DB)) / RANGE_DB * 255, 0, 255).astype(np.uint8)
    return out


def pack(env: np.ndarray) -> bytes:
    return zlib.compress(env.tobytes(), level=9)


def unpack(blob: bytes) -> np.ndarray:
    return np.frombuffer(zlib.decompress(blob), np.uint8).reshape(-1, len(BANDS_HZ))
