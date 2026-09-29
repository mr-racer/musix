import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "gen"))
from build import rgba  # noqa: E402


def test_oklch_known_values_convert_to_srgb() -> None:
    assert rgba("oklch(100% 0 0)")[:3] == (255, 255, 255)
    assert rgba("oklch(0% 0 0)")[:3] == (0, 0, 0)
    r, g, b, _ = rgba("oklch(62.8% 0.2577 29.23)")  # CSS Color 4's value for pure red
    assert (abs(r - 255), g, b) <= (1, 1, 1)
    assert rgba("oklch(60% 0.18 270 / 0.15)")[3] == 0.15
