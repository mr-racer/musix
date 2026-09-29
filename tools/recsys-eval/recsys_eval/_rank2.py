"""Throwaway spike: heuristics on the whole history with session-bootstrap CIs, and
a learned ranker (LightGBM) with rolling-origin time folds + feature ablations."""
import sys, os, pickle, numpy as np, pandas as pd, lightgbm as lgb
from . import data as D, space as S
from ._evalrank import cached_ctx, sim_columns

SPACES = ["clap"]
FOLDS = [pd.Timestamp(x) for x in ["2026-07-28", "2026-08-12", "2026-08-27", "2026-09-10", "2026-10-01"]]
B = ["t_plays", "t_full_rate", "t_skip_rate", "t_days_since", "t_fire", "t_water", "t_days_in_lib",
     "a_plays", "a_full_rate", "a_skip_rate", "a_days_since", "a_in_sess", "a_prev_same", "album_cont",
     "g_long_share", "g_sess_share", "g_run", "g_sess_skips", "g_sess_full",
     "s_pos", "s_skip_rate", "s_prev_skip", "s_prev2_skip", "hour", "dow", "dur"]
A = ["energy", "energy_dev", "ax_vocal_lead", "ax_spacious", "ax_experimental", "ax_brightness", "ax_acousticness"]
EK = ["aff_s", "aff_l", "rep", "aff", "sim_prev"]


def feats(coll):
    p = D.cache_dir() / f"feat2_{coll[:9]}.pkl"
    have = pickle.load(open(p, "rb")) if p.exists() else None
    ev, F, ctxs = cached_ctx(coll)
    Sm = have if have is not None else pd.DataFrame(index=F.index)
    todo = [s for s in SPACES if f"{s}.aff" not in Sm]
    if todo:
        Sm = pd.concat([Sm, sim_columns(coll, ev, ctxs, todo)], axis=1)
        pickle.dump(Sm, open(p, "wb"))
    return ev, pd.concat([F, Sm], axis=1)


def pairs_auc(g_ids, y, s):
    """Per-group AUC contributions (num, den) for bootstrap."""
    out = {}
    df = pd.DataFrame({"g": g_ids, "y": y, "s": s})
    df = df[(df.y >= 0) & df.s.notna()]
    for g, d in df.groupby("g"):
        p, n = d.s[d.y == 1].values, d.s[d.y == 0].values
        if len(p) and len(n):
            out[g] = ((p[:, None] > n[None, :]).sum() + 0.5 * (p[:, None] == n[None, :]).sum(), len(p) * len(n))
    return out


def auc_ci(contrib, n_boot=400, seed=0):
    keys = list(contrib); num = np.array([contrib[k][0] for k in keys]); den = np.array([contrib[k][1] for k in keys])
    if den.sum() == 0: return np.nan, np.nan, np.nan, 0
    rng = np.random.default_rng(seed); bs = []
    for _ in range(n_boot):
        ix = rng.integers(0, len(keys), len(keys)); bs.append(num[ix].sum() / den[ix].sum())
    return num.sum() / den.sum(), np.percentile(bs, 5), np.percentile(bs, 95), int(den.sum())
