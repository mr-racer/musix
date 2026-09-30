"""The three retrieval models, addressed as one object.

A seam, not a cache. Every model lives in :class:`ModelRegistry` and is loaded
exactly once per process; this class only gives the retriever one thing to hold
and gives a test one thing to replace. Swapping in a fake hub is how the ranking
logic is exercised without a GPU.

**Nothing here swallows a failure any more.** ``encode_dense`` used to catch
every exception and return ``None``, which is indistinguishable from "there was
nothing to encode" — so a leg could be dead for a whole session while the only
symptom was worse answers. The legs raise
(:mod:`app.resources.models.errors`) and this hub passes that straight through.

Degrading is still the right behaviour for the retriever — "ranked worse" beats
"no answer", especially on a box where the card is busy — but it is now a
decision :class:`~musix.assistant.retrieval.hybrid.HybridRetriever` makes in
writing, at a named site, and counts. See ``STATS.degraded``.
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


class ModelHub:
    """Dense, learned-sparse and cross-encoder, over the ml service (v2: numpy and
    scipy.sparse where v1 had torch tensors)."""

    def __init__(self, ml=None):
        self._ml = ml

    @property
    def ml(self):
        if self._ml is None:
            from musix.assistant.compat import MlSync
            from musix.settings import Settings

            self._ml = MlSync(Settings().ml_url)
        return self._ml

    def encode_dense(self, texts: list, *, is_query: bool = False):
        """L2-normalised dense vectors, (n, d) float32. ``None`` only for an empty
        ``texts``; every failure raises."""
        if not texts:
            return None
        v = self.ml.encode_text(texts, is_query=is_query)
        n = np.linalg.norm(v, axis=1, keepdims=True)
        return v / np.maximum(n, 1e-9)

    def encode_sparse(self, texts: list, *, is_query: bool = False):
        """Learned-sparse representations, a CSR matrix. ``None`` only for an empty
        ``texts``; every failure raises."""
        if not texts:
            return None
        return self.ml.encode_sparse(texts, is_query=is_query)

    def ce_probabilities(self, query: str, docs: list) -> Optional[list]:
        """``sigmoid(logit)`` per (query, doc) pair. An empty ``docs`` gives an empty
        list; every failure raises."""
        if not docs:
            return []
        return self.ml.ce_probabilities(query, docs)

    def status(self) -> dict:
        return self.ml.retrieval_status()


# One per process is enough.
DEFAULT_HUB = ModelHub()
