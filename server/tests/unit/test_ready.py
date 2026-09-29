from fastapi import FastAPI
from fastapi.testclient import TestClient

from musix.api.app import router


async def _ok() -> None:
    return None


async def _down() -> None:
    raise ConnectionRefusedError


def test_ready_is_503_and_names_the_failing_dependency() -> None:
    app = FastAPI()
    app.include_router(router)
    app.state.checks = {"postgres": _ok, "qdrant": _down}
    r = TestClient(app).get("/api/v2/ready")
    assert r.status_code == 503
    assert r.json() == {
        "status": "degraded",
        "checks": {"postgres": "ok", "qdrant": "error: ConnectionRefusedError"},
    }
