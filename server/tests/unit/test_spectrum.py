"""The 16-band spectrum the player draws above the seek line (design refresh spec §6.2)."""

import numpy as np

from musix.contexts.intel import envelope as E


def _tone(hz: float, seconds: float = 2.0) -> np.ndarray:
    t = np.arange(int(E.SPEC_SR * seconds), dtype=np.float32) / E.SPEC_SR
    return np.sin(2 * np.pi * hz * t).astype(np.float32)


def _band_of(hz: float) -> int:
    return next(i for i, (lo, hi) in enumerate(E.SPEC_BANDS_HZ) if lo <= hz < hi)


def test_shape_is_thirty_frames_a_second_in_sixteen_bands() -> None:
    spec = E.spectrum(_tone(440))
    assert spec.dtype == np.uint8
    assert spec.shape == (61, 16)  # 2 s at 30 fps, plus the padded edge frame


def test_the_blob_describes_itself_and_round_trips() -> None:
    from musix.contexts.library.router import SPECTRUM_MAGIC

    rng = np.random.default_rng(3)
    spec = rng.integers(0, 256, (300, 16), dtype=np.uint8)  # wraps both ways in the deltas
    blob = E.pack_spectrum(spec)
    assert blob[:4] == E.SPEC_MAGIC == SPECTRUM_MAGIC
    assert (blob[4], blob[5]) == (30, 16)
    assert np.array_equal(E.unpack_spectrum(blob), spec)


def test_a_tone_lights_its_own_band_lows_first() -> None:
    for hz in (60.0, 440.0, 3_000.0, 9_000.0):
        frame = E.spectrum(_tone(hz))[30]
        assert int(frame.argmax()) == _band_of(hz)
    assert _band_of(60.0) < _band_of(440.0) < _band_of(3_000.0) < _band_of(9_000.0)


def test_pink_noise_fills_the_curve_evenly() -> None:
    rng = np.random.default_rng(7)
    white = np.fft.rfft(rng.standard_normal(E.SPEC_SR * 4))
    freqs = np.fft.rfftfreq(E.SPEC_SR * 4, 1 / E.SPEC_SR)
    pink = np.fft.irfft(white / np.sqrt(np.maximum(freqs, 1.0))).astype(np.float32)
    mean = E.spectrum(pink)[5:-5].mean(axis=0)
    assert mean.max() - mean.min() < 40  # of 255: log-spaced bands need no tilt


def test_silence_and_the_old_envelope_still_work() -> None:
    assert E.spectrum(np.zeros(0, np.float32)).shape == (0, 16)
    old = E.compute(_tone(440)[:: E.SPEC_SR // E.SR])
    assert old.shape[1] == 4
