"""Deterministic "sound stage" prototype: pan + direct/diffuse per T-F bin.

Per STFT bin we smooth the 2x2 L/R covariance [[r00, r01], [r01*, r11]] over a
few neighbouring bins. Model: amplitude-panned primary source (rank 1) + diffuse
ambience with equal power in both channels (scaled identity). Then:
  - principal eigenvector angle  -> pan of the primary source (-1 L .. +1 R)
  - lambda_min                   -> ambient power (per channel)
  - D = (lmax - lmin) / (lmax + lmin) -> directness (1 dry/close, 0 diffuse/far)
This is the PCA primary-ambient extraction used by stereo->5.1 upmixers.
"""
import subprocess

import numpy as np
from scipy.ndimage import uniform_filter
from scipy.signal import stft

SR = 44100
NFFT = 4096
HOP = 2048
FMIN, FMAX = 40.0, 16000.0
BANDS = [
    (30, 150, "бас/бочка", (255, 120, 90)),
    (150, 500, "низ-середина", (255, 190, 80)),
    (500, 2000, "середина", (120, 220, 120)),
    (2000, 6000, "атака/presence", (90, 190, 255)),
    (6000, 16000, "воздух/тарелки", (200, 140, 255)),
]


def load(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).T.copy()


def analyse(x):
    f, t, Z = stft(x, fs=SR, nperseg=NFFT, noverlap=NFFT - HOP, boundary=None)
    keep = (f >= FMIN) & (f <= FMAX)
    f = f[keep]
    L = Z[0, keep, :].astype(np.complex64)
    R = Z[1, keep, :].astype(np.complex64)
    del Z
    r00 = np.abs(L) ** 2
    r11 = np.abs(R) ** 2
    r01 = L * np.conj(R)
    del L, R
    size = (3, 3)  # 3 bins x 3 frames (~140 ms)
    s00 = uniform_filter(r00, size)
    s11 = uniform_filter(r11, size)
    s01 = uniform_filter(r01.real, size) + 1j * uniform_filter(r01.imag, size)
    E = (r00 + r11).astype(np.float32)  # unsmoothed energy for weighting
    tr = s00 + s11 + 1e-12
    disc = np.sqrt((s00 - s11) ** 2 + 4 * np.abs(s01) ** 2)
    D = np.clip(disc / tr, 0, 1).astype(np.float32)
    theta = 0.5 * np.arctan2(2 * np.abs(s01), s00 - s11)  # 0 = L, pi/2 = R
    pan = (theta / (np.pi / 4) - 1).astype(np.float32)
    phase = np.angle(s01).astype(np.float32)  # |phase|>pi/2 -> anti-phase content
    return f, t, E, D, pan, phase
















