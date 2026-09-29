import numpy as np

from recsys_eval._rank2 import auc_ci, pairs_auc


def test_a_session_constant_score_cannot_rank_within_the_session() -> None:
    # Two sessions; the "score" is constant inside each (e.g. hour of day). Pooled AUC
    # would reward it (session 2 completes more); session-grouped AUC must say 0.5.
    g = np.array([1, 1, 1, 1, 2, 2, 2, 2])
    y = np.array([1, 0, 0, 0, 1, 1, 1, 0])
    s = np.array([0.1, 0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.9])
    auc, *_ = auc_ci(pairs_auc(g, y, s))
    assert auc == 0.5


def test_ties_split_evenly() -> None:
    g = np.array([1, 1])
    y = np.array([1, 0])
    auc, *_ = auc_ci(pairs_auc(g, y, np.array([0.3, 0.3])))
    assert auc == 0.5
