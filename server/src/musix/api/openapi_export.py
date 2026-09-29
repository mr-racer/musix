"""Print the OpenAPI document: `python -m musix.api.openapi_export > contracts/openapi.json`."""

from __future__ import annotations

import json
import sys

from musix.api.app import create_app
from musix.settings import Settings


def openapi_json() -> str:
    app = create_app(Settings(_env_file=None))  # type: ignore[call-arg]
    return json.dumps(app.openapi(), indent=2, ensure_ascii=False, sort_keys=True) + "\n"


if __name__ == "__main__":
    sys.stdout.write(openapi_json())
