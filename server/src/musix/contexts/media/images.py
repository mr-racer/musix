"""Cover images at ingest (spec §5.5): WebP variants, a palette with the player accent,
and a blurhash. Clients never compute colors from pixels again."""

from __future__ import annotations

import colorsys
import hashlib
import math
from pathlib import Path
from typing import Any

import numpy as np

SIZES = (96, 256, 512, 1024)
B83 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~"


def image_id(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def variants(data: bytes, out_dir: Path) -> tuple[int, int, dict[str, str]]:
    """WebP at 96/256/512/1024, never upscaled. The first step at or above the source holds
    the source's own resolution: a 500 px cutout is served at 500 px as "512", not capped
    at 256 (it used to stop below the source, so most 600–1000 px covers topped out at 512
    and a phone's full-width cover was soft). pyvips is imported here: the api never needs it."""
    import pyvips

    src = pyvips.Image.new_from_buffer(data, "")
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, str] = {}
    for size in SIZES:
        thumb = pyvips.Image.thumbnail_buffer(data, size, height=size, size="down")
        p = out_dir / f"{size}.webp"
        thumb.webpsave(str(p), Q=82, strip=True)
        paths[str(size)] = p.name
        if size >= max(src.width, src.height):
            break
    return src.width, src.height, paths


def complete(have: dict[str, str] | None, width: int | None, height: int | None) -> bool:
    """Whether stored variants reach the source's resolution (the rule above)."""
    side = max(width or 0, height or 0)
    want = next((str(s) for s in SIZES if s >= side), str(SIZES[-1]))
    return want in (have or {})


def pixels(data: bytes, size: int) -> np.ndarray:
    import pyvips

    img = pyvips.Image.thumbnail_buffer(data, size, height=size, size="force")
    if img.bands == 1:
        img = img.colourspace("srgb")
    if img.bands == 4:
        img = img.flatten(background=[0, 0, 0])
    return np.asarray(img.numpy()[:, :, :3], dtype=np.uint8)


def _hsl(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    h, lum, s = colorsys.rgb_to_hls(*(c / 255 for c in rgb))
    return h * 360, s * 100, lum * 100


def palette(px32: np.ndarray, px64: np.ndarray) -> dict[str, Any]:
    """v1's player rule (PlayerSection `accentColor` + `useCoverColor`), ported exactly:
    over 32×32 pick the pixel maximizing sat·(1 − |lum−135|/135) with 50 < lum < 220,
    else the mean; clamp HSL s∈[45,85], l∈[52,72] dark / [38,52] light. Plus a k-means
    dominant color (k=5 over 64×64)."""
    flat = px32.reshape(-1, 3).astype(float)
    mx, mn = flat.max(1), flat.min(1)
    lum = (mx + mn) / 2
    sat = np.where(mx == 0, 0, (mx - mn) / 255)
    score = np.where((lum > 50) & (lum < 220), sat * (1 - np.abs(lum - 135) / 135), -1)
    best = flat[int(score.argmax())] if score.max() >= 0 else flat.mean(0)
    h, s, lt = _hsl(tuple(best))

    def accent(lo: float, hi: float) -> str:
        return f"hsl({h:.0f}, {min(85, max(45, s)):.0f}%, {min(hi, max(lo, lt)):.0f}%)"

    km = px64.reshape(-1, 3).astype(float)
    rng = np.random.default_rng(0)
    cent = km[rng.choice(len(km), 5, replace=False)]
    for _ in range(8):
        lab = ((km[:, None, :] - cent[None]) ** 2).sum(-1).argmin(1)
        cent = np.array([km[lab == k].mean(0) if (lab == k).any() else cent[k] for k in range(5)])
    dom = cent[np.bincount(lab, minlength=5).argmax()]
    return {
        "dominant": _hex(dom),
        "vibrant": _hex(best),
        "muted": _hex(flat.mean(0)),
        "accent": {"dark": accent(52, 72), "light": accent(38, 52)},
    }


def _hex(c: np.ndarray) -> str:
    r, g, b = (round(float(x)) for x in c)
    return f"#{r:02x}{g:02x}{b:02x}"


def _b83(v: int, n: int) -> str:
    return "".join(B83[(v // 83 ** (n - 1 - i)) % 83] for i in range(n))


def _lin(c: np.ndarray) -> np.ndarray:
    c = c / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(v: float) -> int:
    v = max(0.0, min(1.0, v))
    return (
        int(v * 12.92 * 255 + 0.5)
        if v <= 0.0031308
        else int((1.055 * v ** (1 / 2.4) - 0.055) * 255 + 0.5)
    )


def blurhash(px: np.ndarray, cx: int = 4, cy: int = 3) -> str:
    """The standard blurhash encoding (woltapp/blurhash), numpy, no native build."""
    h, w, _ = px.shape
    lin = _lin(px.astype(float))
    xs, ys = np.arange(w), np.arange(h)
    factors = []
    for j in range(cy):
        for i in range(cx):
            basis = np.outer(np.cos(math.pi * j * ys / h), np.cos(math.pi * i * xs / w))
            norm = 1 if i == j == 0 else 2
            factors.append(norm * (basis[:, :, None] * lin).sum((0, 1)) / (w * h))
    dc, ac = factors[0], factors[1:]
    out = _b83((cx - 1) + (cy - 1) * 9, 1)
    if ac:
        qmax = max(0, min(82, math.floor(max(float(np.abs(a).max()) for a in ac) * 166 - 0.5)))
        maxv = (qmax + 1) / 166
    else:
        qmax, maxv = 0, 1.0
    out += _b83(qmax, 1)
    out += _b83((_srgb(dc[0]) << 16) + (_srgb(dc[1]) << 8) + _srgb(dc[2]), 4)
    for a in ac:
        q = [
            max(0, min(18, math.floor(math.copysign(abs(v / maxv) ** 0.5, v) * 9 + 9.5))) for v in a
        ]
        out += _b83(q[0] * 19 * 19 + q[1] * 19 + q[2], 2)
    return out
