"""One executor thread per device, fed by a priority queue.

The models are not safe to run concurrently on one device (two forwards at once is how
the transient peaks add up on a shared card), so there is exactly one worker. What the
queue adds over v1's single batcher is ORDER: `interactive` work (a user is waiting —
search, the assistant) always runs before `bulk` work (ingest, enrichment), whatever
arrived first. Within a priority, FIFO."""

from __future__ import annotations

import asyncio
import itertools
import queue
import threading
from collections.abc import Callable
from concurrent.futures import Future
from typing import Any, TypeVar

from musix_ml.errors import ModelOverloaded

T = TypeVar("T")
PRIORITY = {"interactive": 0, "bulk": 1}


class PriorityExecutor:
    def __init__(self, max_queued: int = 512) -> None:
        self._q: queue.PriorityQueue[tuple[int, int, Future[Any], Callable[[], Any]]] = (
            queue.PriorityQueue()
        )
        self._seq = itertools.count()
        self._max = max_queued
        self._thread = threading.Thread(target=self._run, name="ml-executor", daemon=True)
        self._thread.start()

    def submit(self, priority: str, fn: Callable[[], T]) -> Future[T]:
        if self._q.qsize() >= self._max:
            raise ModelOverloaded("executor", "submit", f"{self._max} jobs queued")
        fut: Future[T] = Future()
        self._q.put((PRIORITY[priority], next(self._seq), fut, fn))
        return fut

    async def run(self, priority: str, fn: Callable[[], T]) -> T:
        return await asyncio.wrap_future(self.submit(priority, fn))

    def depth(self) -> int:
        return self._q.qsize()

    def _run(self) -> None:
        while True:
            _, _, fut, fn = self._q.get()
            if not fut.set_running_or_notify_cancel():
                continue  # the caller gave up while it waited
            try:
                fut.set_result(fn())
            except BaseException as e:
                fut.set_exception(e)
