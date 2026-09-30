"""A load failure that expires (v1 `models/breaker.py`): no retry storm on a dead leg,
but the door reopens after `ttl` — a load that failed because memory was full at that
moment clears on its own."""

from __future__ import annotations

import threading
import time


class CircuitBreaker:
    def __init__(self, ttl: float = 300.0) -> None:
        self.ttl = ttl
        self._lock = threading.Lock()
        self._open: dict[str, tuple[float, str]] = {}

    def is_open(self, leg: str) -> bool:
        with self._lock:
            entry = self._open.get(leg)
            if entry is None:
                return False
            if time.monotonic() >= entry[0]:  # lazy expiry: nothing else needs a timer
                del self._open[leg]
                return False
            return True

    def trip(self, leg: str, reason: str) -> None:
        with self._lock:
            self._open[leg] = (time.monotonic() + self.ttl, reason)

    def reason(self, leg: str) -> str | None:
        with self._lock:
            entry = self._open.get(leg)
            return entry[1] if entry else None

    def open_legs(self) -> list[str]:
        return sorted(leg for leg in list(self._open) if self.is_open(leg))
