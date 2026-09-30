import threading
import time

import pytest

from musix_ml.breaker import CircuitBreaker
from musix_ml.executor import PriorityExecutor


def test_interactive_work_runs_before_queued_bulk_work() -> None:
    ex = PriorityExecutor()
    gate, order = threading.Event(), []
    blocker = ex.submit("bulk", gate.wait)  # holds the one executor thread
    bulk = [ex.submit("bulk", lambda i=i: order.append(f"bulk{i}")) for i in range(3)]
    urgent = ex.submit("interactive", lambda: order.append("interactive"))
    gate.set()
    for f in [blocker, *bulk, urgent]:
        f.result(timeout=5)
    assert order == ["interactive", "bulk0", "bulk1", "bulk2"]


def test_breaker_opens_then_expires() -> None:
    b = CircuitBreaker(ttl=0.05)
    b.trip("clap", "out of memory")
    assert b.is_open("clap")
    assert b.reason("clap") == "out of memory"
    assert b.open_legs() == ["clap"]
    time.sleep(0.06)
    assert not b.is_open("clap")
    assert b.open_legs() == []


def test_overloaded_queue_refuses() -> None:
    from musix_ml.errors import ModelOverloaded

    ex = PriorityExecutor(max_queued=1)
    gate = threading.Event()
    ex.submit("bulk", gate.wait)
    time.sleep(0.05)  # the blocker is running, not queued
    ex.submit("bulk", lambda: None)
    with pytest.raises(ModelOverloaded):
        ex.submit("bulk", lambda: None)
    gate.set()
