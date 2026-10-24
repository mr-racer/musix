"""ml-sound without models: the guard's decision and the HTTP surface over a fake runner
(spec sound-engine §5, §6.2)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from musix_sound import guard
from musix_sound.app import create_app
from musix_sound.batch import Batch


@pytest.mark.parametrize(
    ("kind", "cpu", "gpu", "ok"),
    [
        ("gpu", 0.10, 0.99, True),  # the GPU item minds only the rest of the CPU
        ("gpu", 0.50, 0.00, False),  # a transcode or another service is busy: wait
        ("cpu", 0.99, 0.05, True),  # the CPU track minds only the GPU
        ("cpu", 0.00, 0.60, False),  # llama-server or ml is on the card: wait
    ],
)
def test_guard_never_lets_the_two_lanes_overlap(kind: str, cpu: float, gpu: float, ok: bool) -> None:
    assert guard.may_start(kind, cpu, gpu) is ok


class FakeRunner:
    def __init__(self) -> None:
        self.current: Batch | None = None
        self.last: Batch | None = None

    def start(self, b: Batch) -> None:
        self.current = b


def test_one_batch_at_a_time_and_paths_stay_in_the_media_roots() -> None:
    r = FakeRunner()
    c = TestClient(create_app(r))  # type: ignore[arg-type]
    item = {"id": "0a1b", "path": "/mnt/data/music/a.flac"}

    bad = c.post("/v1/batches", json={"items": [{**item, "path": "/mnt/data/music/../../etc/passwd"}]})
    assert bad.status_code == 400
    assert c.post("/v1/batches", json={"items": [{**item, "path": "/etc/passwd"}]}).status_code == 400

    first = c.post("/v1/batches", json={"items": [item]})
    assert first.status_code == 202
    bid = first.json()["batch_id"]
    busy = c.post("/v1/batches", json={"items": [item]})
    assert busy.status_code == 409 and busy.json()["batch_id"] == bid
    assert c.get("/health").json()["batch"] == bid

    assert r.current is not None
    r.current.done.append({"id": "0a1b", "measures": {}})
    v = c.get(f"/v1/batches/{bid}", params={"since": 0}).json()
    assert [d["id"] for d in v["done"]] == ["0a1b"]
    assert c.get(f"/v1/batches/{bid}", params={"since": 1}).json()["done"] == []
    assert c.get("/v1/batches/nope").status_code == 404
