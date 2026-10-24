"""The card lent to ml-sound and back (spec sound-engine §4), without real models."""

import pytest

from musix_ml import models
from musix_ml.errors import ModelGpuLent


@pytest.fixture(autouse=True)
def _clean() -> None:
    models._loaded.clear()
    models._lent = False
    yield
    models._loaded.clear()
    models._lent = False


def test_lent_card_refuses_the_gpu_legs_keeps_clap_and_comes_back() -> None:
    calls: list[str] = []
    models._load("dense", "fake", lambda: calls.append("dense") or "dense-model")
    assert models.loaded()["gpu"] == "loaded"

    out = models.release()
    assert out["gpu"] == "lent" and "dense" not in out["loaded"]  # the weights are dropped
    with pytest.raises(ModelGpuLent) as e:
        models._load("dense", "fake", lambda: calls.append("again") or "x")
    assert e.value.status == 503 and e.value.kind == "gpu_lent"
    assert models._load("clap", "fake", lambda: "clap-model") == "clap-model"  # CPU: untouched
    assert calls == ["dense"]  # nothing loaded while lent

    assert models.acquire()["gpu"] == "empty"
    assert models._load("dense", "fake", lambda: "dense-model") == "dense-model"
    assert models.loaded()["gpu"] == "loaded"
