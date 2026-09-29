"""Throwaway spike: ranker with ONLY candidate-varying features (a decision-point
constant cannot re-order candidates), label variants, importance."""
import sys, numpy as np, pandas as pd, lightgbm as lgb
from . import data as D
from ._rank2 import feats, pairs_auc, auc_ci, FOLDS, A, EK
from . import _rank2 as rank2
SPACES = ["clap"]
BC = ["t_plays", "t_full_rate", "t_skip_rate", "t_days_since", "t_fire", "t_water", "t_days_in_lib",
      "a_plays", "a_full_rate", "a_skip_rate", "a_days_since", "a_in_sess", "a_prev_same", "album_cont",
      "g_long_share", "g_sess_share", "g_run", "g_sess_skips", "g_sess_full", "dur"]
LABELS = {"full-vs-skip": lambda ev: np.where(ev["full"], 1, np.where(ev["skip"], 0, -1)),
          "not-skipped": lambda ev: np.where(ev["skip"], 0, 1)}

def run(sets, label, data, show_imp=()):
    rows = []
    y_of = LABELS[label]
    for name, cols in sets.items():
        preds = {c: np.full(len(ev), np.nan) for c, (ev, X) in data.items()}
        for lo_t, hi_t in zip(FOLDS[:-1], FOLDS[1:]):
            tX = pd.concat([X.loc[(ev["at"] < lo_t).values & (y_of(ev) >= 0), cols] for c, (ev, X) in data.items()])
            ty = np.concatenate([y_of(ev)[(ev["at"] < lo_t).values & (y_of(ev) >= 0)] for c, (ev, X) in data.items()])
            mdl = lgb.LGBMClassifier(n_estimators=300, learning_rate=0.03, num_leaves=15, min_child_samples=30,
                                     subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, verbose=-1).fit(tX.values, ty)
            for c, (ev, X) in data.items():
                m = ((ev["at"] >= lo_t) & (ev["at"] < hi_t)).values
                if m.any(): preds[c][m] = mdl.predict_proba(X.loc[m, cols].values)[:, 1]
        if name in show_imp:
            imp = pd.Series(mdl.booster_.feature_importance("gain"), index=cols); imp = (imp / imp.sum()).sort_values(ascending=False)
            print(f"[{label}] {name} gain:", imp.head(10).round(3).to_dict())
        for c, (ev, X) in data.items():
            y = y_of(ev); g = ev["lsess"].values
            for sub, m in [("all", np.ones(len(ev), bool)), ("stream", ev["stream"].values), ("non-album", ~ev["album_cont"].values)]:
                mm = m & ~np.isnan(preds[c])
                a, lo, hi, n = auc_ci(pairs_auc(g[mm], y[mm], preds[c][mm]))
                rows.append({"label": label, "lib": c[:9], "set": name, "subset": sub, "gauc": a, "ci90": f"{lo:.3f}–{hi:.3f}", "pairs": n})
    return rows


def run_e1() -> dict:
    """E1: session GAUC, completed vs skipped. The v1 score (the logged baseline) and
    the reference ranker, on the same rolling-fold events."""
    from . import space as S
    data = {c: feats(c) for c in [D.OWNER, D.FRIEND]}
    out = {"ranker": {}, "v1_score": {}}
    rows = run({"reference ranker (Bc+A)": BC + A}, "full-vs-skip", data)
    for r in rows:
        out["ranker"][f"{r['lib']}/{r['subset']}"] = {"gauc": r["gauc"], "ci90": r["ci90"], "pairs": r["pairs"]}
    y_of = LABELS["full-vs-skip"]
    for c, (ev, X) in data.items():
        m = (ev["at"] >= FOLDS[0]).values
        s = S.v1_score({"aff": X["clap.aff"], "rep": X["clap.rep"]}, 1 / (1 + X["t_plays"]), np.exp(-X["t_days_since"]))
        a, lo, hi, n = auc_ci(pairs_auc(ev["lsess"].values[m], y_of(ev)[m], np.asarray(s, float)[m]))
        out["v1_score"][c[:9]] = {"gauc": a, "ci90": f"{lo:.3f}–{hi:.3f}", "pairs": n}
    return out
