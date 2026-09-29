"""Throwaway spike: E1 (skip-vs-complete ranking, GAUC) and E2 (retrieval of the
next self-chosen completed track) for engine variants on the prod snapshot."""
import os, sys, pickle, json, numpy as np, pandas as pd
from . import data as D, replay as C, space as S

SPLIT = pd.Timestamp("2026-09-10")
SPACES = ["clap"]


def cached_ctx(coll):
    p = D.cache_dir() / f"ctx_{coll[:9]}.pkl"
    if os.path.exists(p): return pickle.load(open(p, "rb"))
    out = C.build(coll); pickle.dump(out, open(p, "wb")); return out


def gauc(ev, score, mask=None):
    """Session-grouped AUC of `score`: completed (full) above skipped."""
    df = pd.DataFrame({"g": ev["lsess"], "y": np.where(ev["full"], 1, np.where(ev["skip"], 0, -1)), "s": score})
    if mask is not None: df = df[mask]
    df = df[(df.y >= 0) & df.s.notna()]
    num = den = 0.0
    for _, g in df.groupby("g"):
        p, n = g.s[g.y == 1].values, g.s[g.y == 0].values
        if len(p) == 0 or len(n) == 0: continue
        cmp = (p[:, None] > n[None, :]).sum() + 0.5 * (p[:, None] == n[None, :]).sum()
        num += cmp; den += len(p) * len(n)
    return num / den if den else np.nan, int(den)


def sim_columns(coll, ev, ctxs, spaces):
    cols = {}
    for sp in spaces:
        space = S.Space(coll, sp)
        out = {k: np.full(len(ev), np.nan) for k in ["aff_s", "aff_l", "rep", "aff", "sim_prev"]}
        for i, (tr, cx) in enumerate(zip(ev["track"], ctxs)):
            X = space.vec([tr])
            if X is None: continue
            fe = space.ctx_features(X, cx)
            for k in out: out[k][i] = fe[k][0]
        for k, v in out.items(): cols[f"{sp}.{k}"] = v
    return pd.DataFrame(cols)
