"""v1 `track_credits_service`'s credit-name splitting (the part the discoveries rail
uses); its producer/label aggregation over MetadataDB is not ported."""

from __future__ import annotations

import re
from typing import Optional

_CREDIT_SPLIT_RE = re.compile(r"\s*(?:[,;/]|&|\bfeat\b\.?)\s*", re.IGNORECASE)
_LABEL_SPLIT_RE = re.compile(r"\s*[,;]\s*|\s+&\s+")
MAX_CREDIT_NAMES = 3


def split_credit_names(raw: Optional[str], cap: int = MAX_CREDIT_NAMES) -> list[str]:
    """Split a raw producer tag into up to ``cap`` clean names."""
    parts = [p.strip() for p in _CREDIT_SPLIT_RE.split(str(raw or "")) if p.strip()]
    return parts[:cap]


def split_labels(raw: Optional[str]) -> list[str]:
    """Split a raw label tag into clean label names (no cap)."""
    return [p.strip() for p in _LABEL_SPLIT_RE.split(str(raw or "")) if p.strip()]
