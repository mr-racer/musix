"""Loudness (EBU R128) and renditions (spec §5.4), run by the `media` worker queue.

All tiers of a file live under <media>/m/<sha[:2]>/<sha>/ so nginx serves them by path:
  high.m4a (AAC-LC 320), economy.m4a (AAC-LC 128), lossless_compat.<ext>, and
  lossless.<ext>, a symlink to the original (the file itself is never copied).
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from pathlib import Path

# Codecs every client decodes natively; anything else gets a lossless_compat rendition.
NATIVE_LOSSLESS = {"flac", "mp3", "aac"}
DOLBY_DTS = {"ac3", "eac3", "dts", "truehd", "mlp"}
TARGET_LUFS = -14.0


@dataclass
class Loudness:
    lufs: float
    true_peak: float
    lra: float


async def run(*args: str, limit_s: float = 1800) -> str:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    out, err = await asyncio.wait_for(proc.communicate(), timeout=limit_s)
    if proc.returncode != 0:
        raise RuntimeError(f"{args[0]} failed: {err.decode(errors='replace')[-300:]}")
    return (out + err).decode(errors="replace")


async def loudness(src: Path) -> Loudness:
    log = await run(
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-nostats",
        "-i",
        str(src),
        "-map",
        "0:a:0",
        "-filter:a",
        "ebur128=peak=true",
        "-f",
        "null",
        "-",
    )
    summary = log[log.rfind("Summary:") :]

    def get(pat: str) -> float:
        m = re.search(pat, summary, re.S)
        if m is None:
            raise RuntimeError(f"ebur128 summary lacks {pat!r}")
        return float(m.group(1))

    return Loudness(
        lufs=get(r"I:\s+(-?[\d.]+) LUFS"),
        lra=get(r"LRA:\s+(-?[\d.]+) LU"),
        true_peak=get(r"True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS"),
    )


def gains(lufs: float | None, true_peak: float | None) -> float | None:
    """dB to apply for −14 LUFS. Attenuation freely; a boost only within the true-peak
    headroom (to −1 dBTP), so normalization never clips."""
    if lufs is None:
        return None
    g = TARGET_LUFS - lufs
    if g > 0 and true_peak is not None:
        g = min(g, max(0.0, -1.0 - true_peak))
    return round(g, 2)


def tier_dir(media_dir: Path, sha: str) -> Path:
    return media_dir / "m" / sha[:2] / sha


def _rate(sample_rate: int | None) -> str:
    return "48000" if sample_rate and sample_rate % 48000 == 0 else "44100"


async def encode_aac(src: Path, dst: Path, kbps: int, sample_rate: int | None) -> None:
    tmp = dst.with_suffix(".tmp.m4a")
    await run(
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-i",
        str(src),
        "-map",
        "0:a:0",
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        f"{kbps}k",
        "-ac",
        "2",
        "-ar",
        _rate(sample_rate),
        "-movflags",
        "+faststart",
        str(tmp),
    )
    tmp.replace(dst)  # atomic: a half-written rendition is never visible


async def encode_flac(src: Path, dst: Path) -> None:
    tmp = dst.with_suffix(".tmp.flac")
    await run(
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-i",
        str(src),
        "-map",
        "0:a:0",
        "-vn",
        "-c:a",
        "flac",
        str(tmp),
    )
    tmp.replace(dst)


def compat_kind(codec: str | None) -> str | None:
    """Which lossless_compat rendition a codec needs: FLAC for ALAC (the web), AAC for
    Dolby/DTS (v1's 2026-09-28 decision); None when the original plays everywhere."""
    if codec in NATIVE_LOSSLESS or codec is None:
        return None
    if codec == "alac":
        return "flac"
    return "aac"
