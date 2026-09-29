"""Throwaway spike: similarity features per embedding space, v1-style scoring."""
import numpy as np
from . import data as D


class Space:
    def __init__(self, coll, name, debias_artist=False):
        self.name = name
        idx, M = D.vectors(coll, name.split("+")[0])
        lib = D.library(coll)
        if debias_artist or "+deb" in name:
            M = debias(M, [lib.at[t, "artist_key"] if t in lib.index else "?" for t in idx])
        self.idx, self.M = idx, M
        rng = np.random.default_rng(0)
        s = M[rng.choice(len(M), min(512, len(M)), replace=False)]
        c = (s @ s.T)[np.triu_indices(len(s), 1)]
        self.q = np.quantile(c, np.linspace(0, 1, 101))

    def pct(self, cos):
        return np.interp(cos, self.q, np.linspace(0, 1, 101))

    def vec(self, tids):
        rows = [self.idx[t] for t in tids if t in self.idx]
        return self.M[rows] if rows else None

    def weighted_max(self, X, wmap):
        """max_p ŵ_p · pct(cos(x, p)) for rows X; ŵ normalised to max 1."""
        items = [(t, w) for t, w in wmap.items() if t in self.idx and w > 0]
        if not items or X is None: return np.zeros(len(X) if X is not None else 0)
        P = self.M[[self.idx[t] for t, _ in items]]
        w = np.array([w for _, w in items]); w = w / w.max()
        return (self.pct(X @ P.T) * w[None, :]).max(1)

    def mean_sim(self, X, tids):
        P = self.vec(tids)
        if P is None or X is None: return np.full(len(X) if X is not None else 0, np.nan)
        return self.pct(X @ P.mean(0) / max(np.linalg.norm(P.mean(0)), 1e-8))

    def ctx_features(self, X, ctx):
        """The v1 building blocks for candidate rows X under one context."""
        aff_s = self.weighted_max(X, ctx["pos"])
        aff_l = self.weighted_max(X, ctx["long"])
        rep = self.weighted_max(X, ctx["neg"])
        aff = (1 - ctx["w_long"]) * aff_s + ctx["w_long"] * aff_l
        prev = self.vec([ctx["prev"]]) if ctx["prev"] else None
        sim_prev = self.pct(X @ prev[0]) if prev is not None else np.full(len(X), np.nan)
        return {"aff_s": aff_s, "aff_l": aff_l, "rep": rep, "aff": aff, "sim_prev": sim_prev}


def debias(M, artists):
    """Remove each artist's mean direction component (within-artist centring,
    shrunk for small artists) — the "same artist ≠ similar sound" correction."""
    M = M.copy()
    groups = {}
    for i, a in enumerate(artists): groups.setdefault(a, []).append(i)
    mu = M.mean(0)
    for a, rows in groups.items():
        if len(rows) < 2: continue
        k = len(rows) / (len(rows) + 3.0)   # shrinkage
        M[rows] -= k * (M[rows].mean(0) - mu)
    return M / np.maximum(np.linalg.norm(M, axis=1, keepdims=True), 1e-8)


def v1_score(fe, novelty, recent_pen):
    return 0.5 * fe["aff"] - 0.35 * fe["rep"] + 0.10 * novelty - 0.15 * recent_pen
