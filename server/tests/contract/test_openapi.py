from pathlib import Path

from musix.api.openapi_export import openapi_json

COMMITTED = Path(__file__).resolve().parents[3] / "contracts" / "openapi.json"


def test_committed_openapi_matches_the_code() -> None:
    assert COMMITTED.read_text() == openapi_json(), (
        "contracts/openapi.json is stale: run `make openapi` and commit the diff"
    )
