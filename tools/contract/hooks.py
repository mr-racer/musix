"""schemathesis hooks: log in as the dev owner once per 10 minutes (access tokens last 15)."""

import os

import httpx
import schemathesis

BASE = os.environ.get("MUSIX_CONTRACT_BASE", "http://127.0.0.1:18000")
CREDS = {
    "email": os.environ.get("MUSIX_CONTRACT_EMAIL", "owner@example.com"),
    "password": os.environ.get("MUSIX_CONTRACT_PASSWORD", "owner-pass-123"),
    "device": {"name": "schemathesis", "platform": "web"},
}


# the open auth routes answer 401 to fuzzed credentials by design: no bearer there
@schemathesis.auth(refresh_interval=600).skip_for(path_regex=r"^/api/v2/auth/(login|refresh|register|setup)$")
class OwnerLogin:
    def get(self, case, ctx):  # type: ignore[no-untyped-def]
        r = httpx.post(f"{BASE}/api/v2/auth/login", json=CREDS, timeout=10)
        r.raise_for_status()
        return r.json()["accessToken"]

    def set(self, case, data, ctx):  # type: ignore[no-untyped-def]
        case.headers = {**(case.headers or {}), "Authorization": f"Bearer {data}"}


@schemathesis.serializer("application/offset+octet-stream")
def chunk(ctx, value):  # type: ignore[no-untyped-def]
    """Resumable-upload chunks are raw bytes."""
    return value if isinstance(value, bytes) else str(value).encode()
