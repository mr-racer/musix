"""The ranker (stream spec §3.2): LightGBM, label "not skipped", trained nightly on every
account's history replayed without leakage, validated on the last 14 days by session
GAUC (completed vs skipped pairs in the same session), and promoted only if it clears
0.70 and is not worse than the current model by more than 0.01."""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from musix.recsys.features import matrix
from musix.recsys.replay import Row

ROUNDS = 400
PARAMS: dict[str, Any] = {  # the offline study's, in LightGBM's native names
    "objective": "binary",
    "learning_rate": 0.03,
    "num_leaves": 15,
    "min_data_in_leaf": 30,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "feature_fraction": 0.8,
    "lambda_l2": 1.0,
    "verbose": -1,
    "seed": 7,
    "num_threads": 2,
}
VALIDATION = dt.timedelta(days=14)
PROMOTE_MIN, PROMOTE_SLACK = 0.70, 0.01


@dataclass
class Data:
    X: np.ndarray
    y: np.ndarray  # 1 = not skipped
    w: np.ndarray
    full: np.ndarray
    skip: np.ndarray
    group: np.ndarray  # (account, session) → int
    at: np.ndarray


def dataset(rows_by_account: Iterable[Sequence[Row]]) -> Data:
    X, y, w, full, skip, grp, at = [], [], [], [], [], [], []
    for a, rows in enumerate(rows_by_account):
        for r in rows:
            X.append(matrix(r.acc, r.sess, [r.cand])[0])
            positive = (not r.skip) or r.fired
            y.append(0 if r.watered else int(positive))
            w.append(2.0 if (r.fired or r.watered) else 1.0)  # «огонёк» / «вода» count double
            full.append(r.full)
            skip.append(r.skip)
            grp.append(a * 1_000_000 + r.session)
            at.append(r.at.timestamp())
    return Data(
        np.asarray(X),
        np.asarray(y),
        np.asarray(w),
        np.asarray(full, bool),
        np.asarray(skip, bool),
        np.asarray(grp),
        np.asarray(at),
    )


def gauc(group: np.ndarray, full: np.ndarray, skip: np.ndarray, score: np.ndarray) -> float:
    """Session-grouped AUC of completed (1) vs skipped (0) listens; ties count half."""
    num = den = 0.0
    idx: dict[int, list[int]] = defaultdict(list)
    for i, g in enumerate(group):
        if full[i] or skip[i]:
            idx[int(g)].append(i)
    for rows in idx.values():
        p = score[[i for i in rows if full[i]]]
        n = score[[i for i in rows if skip[i]]]
        if len(p) and len(n):
            num += float((p[:, None] > n[None, :]).sum() + 0.5 * (p[:, None] == n[None, :]).sum())
            den += len(p) * len(n)
    return num / den if den else float("nan")


class Model:
    """A trained booster: p(not skipped) and, for reasons, per-feature contributions."""

    def __init__(self, booster: Any) -> None:
        self.booster = booster

    # Serving: ONE thread. The api runs 4 workers on the box's cores, and OpenMP's idle
    # threads fall asleep while a request awaits the database — measured on the snapshot,
    # the default pool cost 0.8–13 ms a call against a steady 2.7 ms on one thread.
    SERVE_THREADS = 1

    def predict(self, X: np.ndarray) -> np.ndarray:
        out: np.ndarray = self.booster.predict(X, num_threads=self.SERVE_THREADS)
        return out

    def contrib(self, X: np.ndarray) -> np.ndarray:
        """(n, len(FEATURES) + 1): SHAP-style contributions, the last column the bias."""
        out: np.ndarray = self.booster.predict(X, pred_contrib=True, num_threads=self.SERVE_THREADS)
        return out

    def dump(self) -> str:
        return str(self.booster.model_to_string())

    @classmethod
    def load(cls, text: str) -> Model:
        import lightgbm as lgb

        return cls(lgb.Booster(model_str=text))


def fit(d: Data, mask: np.ndarray | None = None) -> Model:
    import lightgbm as lgb

    m = np.ones(len(d.y), bool) if mask is None else mask
    ds = lgb.Dataset(d.X[m], d.y[m], weight=d.w[m], free_raw_data=True)
    return Model(lgb.train(PARAMS, ds, num_boost_round=ROUNDS))


def train(d: Data, now: dt.datetime) -> tuple[Model, dict[str, float]]:
    """(model trained on everything, metrics): the validation model sees only the data
    before the last 14 days and is scored on those days."""
    cut = (now - VALIDATION).timestamp()
    before, after = d.at < cut, d.at >= cut
    metrics: dict[str, float] = {"rows": float(len(d.y)), "validation_rows": float(after.sum())}
    if before.sum() > 100 and after.sum() > 20:
        val = fit(d, before)
        metrics["gauc"] = gauc(
            d.group[after], d.full[after], d.skip[after], val.predict(d.X[after])
        )
    return fit(d), metrics


def promote(new: dict[str, float], current: dict[str, float] | None) -> bool:
    g = new.get("gauc", float("nan"))
    if not g >= PROMOTE_MIN:  # also False for NaN
        return False
    return current is None or not current.get("gauc", 0) > g + PROMOTE_SLACK
