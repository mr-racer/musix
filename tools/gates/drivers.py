"""Search drivers. Both targets are HTTP, so v1 and v2 answer the same questions
through the same path users take. v1 = the throwaway copy on the snapshot
(tools/v1copy), never prod."""

from __future__ import annotations

import json
import subprocess
from typing import Any

import httpx

V1_URL = "http://127.0.0.1:18800"


def v1_tokens() -> dict[str, str]:
    with open(__file__.replace("gates/drivers.py", "v1copy/mint_token.py"), "rb") as f:
        out = subprocess.run(["docker", "exec", "-i", "musix-v1copy", "python", "-"], stdin=f,
                             capture_output=True, check=True).stdout
    return dict(json.loads(out))


class V1Driver:
    target = "v1"

    def __init__(self, url: str = V1_URL) -> None:
        self.tokens = v1_tokens()
        self.http = httpx.Client(base_url=url, timeout=300)

    def _auth(self, coll: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.tokens[coll.removeprefix('acct_')]}"}

    def _search(self, coll: str, q: str, mode: str) -> list[list[Any]]:
        """[[track_id, score], ...]. Scores matter: v1's lyric search fuses dense + BM25
        by RRF, whose rank scores tie often (1/2 from one list = 1/2 from the other) and
        Qdrant orders ties arbitrarily, so ranks are computed tie-aware from scores."""
        for _ in range(2):  # one retry: a v1 500 under load is transient
            r = self.http.post("/api/v1/search/", headers=self._auth(coll),
                               json={"query": q, "mode": mode, "limit": 10})
            if r.status_code < 500:
                break
        r.raise_for_status()
        return [[h["track"]["track_id"], h["score"]] for h in r.json()["hits"]]

    def lyrics(self, coll: str, q: str) -> list[list[Any]]:
        return self._search(coll, q, "text")

    def sound(self, coll: str, q: str) -> list[list[Any]]:
        return self._search(coll, q, "audio")

    def catalog(self, coll: str, q: str) -> list[dict[str, Any]]:
        r = self.http.get("/api/v1/search/catalog", headers=self._auth(coll), params={"q": q, "limit": 10})
        r.raise_for_status()
        return list(r.json())


class V2Driver:
    """Filled in phase 2, when v2 search exists (GET /api/v2/search)."""

    target = "v2"

    def __init__(self) -> None:
        raise NotImplementedError("v2 search lands in phase 2")
