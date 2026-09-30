"""The model error taxonomy (v1 `app/resources/models/errors.py`): each subclass is a
state the HTTP layer maps to a status, so a caller can tell "retry later" from "broken"."""

from __future__ import annotations


class ModelError(RuntimeError):
    status = 500
    kind = "model_error"

    def __init__(self, leg: str, op: str, message: str) -> None:
        self.leg, self.op = leg, op
        super().__init__(f"[{leg}/{op}] {message}")


class ModelUnavailable(ModelError):
    """Not loaded, or the breaker is still open: retry later (503)."""

    status, kind = 503, "model_unavailable"


class ModelOverloaded(ModelError):
    """The queue is full: retry soon (429)."""

    status, kind = 429, "model_overloaded"


class ModelOOM(ModelError):
    """The allocator refused even one item; it clears on its own (503)."""

    status, kind = 503, "model_oom"


class ModelEncodeFailed(ModelError):
    """Anything else on the encode path (500)."""

    status, kind = 500, "model_encode_failed"
