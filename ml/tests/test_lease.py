"""Search stays available on the CPU while sound borrows the GPU."""

import sys
from collections.abc import Iterator
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from musix_ml import models
from musix_ml.app import create_app
from musix_ml.errors import ModelGpuLent


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("ML_DEVICE", "cuda")
    monkeypatch.setitem(
        sys.modules,
        "torch",
        SimpleNamespace(
            cuda=SimpleNamespace(
                is_available=lambda: True,
                mem_get_info=lambda: (8 * 2**30, 24 * 2**30),
                empty_cache=lambda: None,
            ),
            set_num_threads=lambda _: None,
        ),
    )
    models._loaded.clear()
    models._lent = False
    yield
    models._loaded.clear()
    models._lent = False


@pytest.mark.parametrize("leg", models.GPU_LEGS)
def test_search_uses_cpu_during_lease_and_returns_to_gpu(leg: str) -> None:
    clap = models._load("clap", "fake", object)

    def load() -> str:
        return models.device(leg)

    assert models._load(leg, "fake", load) == "cuda"
    assert models.release()["gpu"] == "lent"
    assert leg not in models.loaded()["loaded"]
    assert models._load(leg, "fake", load) == "cpu"
    assert models.device() == "cpu"
    assert models._loaded["clap"] is clap

    assert models.acquire()["gpu"] == "empty"
    assert leg not in models.loaded()["loaded"]
    assert models._load(leg, "fake", load) == "cuda"
    assert models._loaded["clap"] is clap


def test_repeated_release_keeps_cpu_cache_and_repeated_acquire_keeps_gpu_cache() -> None:
    models.release()
    cpu = models._load("dense", "fake", object)
    models.release()
    assert models._loaded["dense"] is cpu

    models.acquire()
    gpu = models._load("dense", "fake", object)
    models.acquire()
    assert models._loaded["dense"] is gpu


def test_cpu_fallback_does_not_need_free_gpu_memory() -> None:
    sys.modules["torch"].cuda.mem_get_info = lambda: (0, 24 * 2**30)
    models.release()
    assert models._load("dense", "fake", lambda: models.device()) == "cpu"
    with pytest.raises(ModelGpuLent):
        models.require_gpu("dense", "encode")


def test_interactive_http_search_works_during_lease_but_bulk_waits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def embed(texts: list[str], _: bool) -> np.ndarray:
        assert models._load("dense", "fake", lambda: models.device()) == "cpu"
        return np.zeros((len(texts), 2), dtype=np.float32)

    def sparse(texts: list[str], _: bool) -> list[tuple[list[int], list[float]]]:
        assert models._load("sparse", "fake", lambda: models.device()) == "cpu"
        return [([1], [0.5]) for _ in texts]

    def rerank(_: str, docs: list[str]) -> list[float]:
        assert models._load("cross_encoder", "fake", lambda: models.device()) == "cpu"
        return [0.5 for _ in docs]

    monkeypatch.setattr(models, "embed_text", embed)
    monkeypatch.setattr(models, "embed_sparse", sparse)
    monkeypatch.setattr(models, "rerank", rerank)
    # Acquiring queues warm-up independently; avoid loading real weights after the test.
    monkeypatch.setattr(models, "warm", lambda: None)
    with TestClient(create_app()) as client:
        assert client.post("/v1/gpu/release").json()["device"] == "cpu"
        requests = [
            ("/v1/embeddings", {"model": "octen-query", "input": "music search"}),
            ("/v1/embeddings/sparse", {"input": "music search", "is_query": True}),
            ("/v1/rerank", {"query": "music search", "documents": ["music"]}),
        ]
        for path, body in requests:
            response = client.post(path, json=body)
            assert response.status_code == 200
            assert response.json().get("data", response.json().get("results"))

            bulk = client.post(path, json=body, headers={"X-Priority": "bulk"})
            assert bulk.status_code == 503
            assert bulk.json()["error"]["type"] == "gpu_lent"
            assert bulk.headers["Retry-After"] == "30"

        assert client.post("/v1/gpu/acquire").json()["device"] == "cuda"
        assert not set(models.GPU_LEGS).intersection(client.get("/health").json()["loaded"])
