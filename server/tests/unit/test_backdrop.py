"""The backdrop's colour recipe (design/code/color-and-backdrop.md)."""

import numpy as np

from musix.contexts.media import images as img


def _luma(a: np.ndarray) -> np.ndarray:
    return a @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def test_highlights_are_tamed_and_darks_are_left_alone() -> None:
    white = np.ones((4, 4, 3), np.float32)
    dark = np.full((4, 4, 3), 0.12, np.float32)
    top = img.BG_KNEE + (1 - img.BG_KNEE) * img.BG_SLOPE
    assert np.allclose(_luma(img.tame(white)), top, atol=1e-3)  # 0.43, not 1.0
    assert np.allclose(img.tame(dark), dark, atol=1e-3)


def test_a_bright_colour_keeps_its_hue() -> None:
    sky = np.broadcast_to(np.array([0.55, 0.78, 0.95], np.float32), (2, 2, 3)).copy()
    out = img.tame(sky)
    assert _luma(out).max() < 0.45
    r, g, b = out[0, 0]
    assert b > g > r  # still a blue, only deeper
