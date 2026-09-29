"""E3: calm / mid / energetic vs the owner's blind labels (stream spec §2.3)."""
import json

import numpy as np
from scipy.stats import spearmanr
from sklearn.linear_model import RidgeCV
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import RepeatedStratifiedKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import data as D

ORD = {"calm": 0, "mid": 1, "energetic": 2}


def _report(s, y):
    s = np.asarray(s, float)
    ok = ~np.isnan(s)
    b = ok & (y != 1)
    q = np.quantile(s[ok], [np.mean(y == 0), np.mean(y <= 1)])
    pred = np.digitize(s, q)
    return {"spearman": round(float(spearmanr(s[ok], y[ok]).statistic), 3),
            "auc_calm_vs_energetic": round(float(roc_auc_score(y[b] == 2, s[b])), 3),
            "balanced_acc_3": round(float(np.mean([np.mean(pred[ok & (y == k)] == k) for k in range(3)])), 3)}


def run_e3(labels_path) -> dict:
    lab = json.load(open(labels_path))["labels"]
    lib = D.library(D.OWNER)
    ids = [t for t, l in lab.items() if l in ORD and t in lib.index]
    y = np.array([ORD[lab[t]] for t in ids])
    out = {"n": len(ids), "counts": {k: int((y == v).sum()) for k, v in ORD.items()},
           "clap_energy_axis": _report(lib.loc[ids, "ax_energy"].values, y)}
    idx, M = D.vectors(D.OWNER, "clap")
    X = np.stack([M[idx[t]] for t in ids])
    oof, cnt = np.zeros(len(y)), np.zeros(len(y))
    for tr, te in RepeatedStratifiedKFold(n_splits=5, n_repeats=4, random_state=0).split(X, y):
        m = make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(0, 5, 16))).fit(X[tr], y[tr])
        oof[te] += m.predict(X[te])
        cnt[te] += 1
    out["clap_linear_probe_cv"] = _report(oof / cnt, y)
    return out
