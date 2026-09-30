"""Search drivers. Both targets are HTTP, so v1 and v2 answer the same questions
through the same path users take. v1 = the throwaway copy on the snapshot
(tools/v1copy), never prod."""

from __future__ import annotations

import json
import os
import subprocess
import time
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


SNAP_DB = os.environ.get("MUSIX_SNAP_DB", "musix_mig")  # api-snap's database (compose reads the same var)
V2_URL = os.environ.get("MUSIX_GATES_V2_URL", "http://127.0.0.1:18010")  # api-snap (make snap-api); the prod stack: its edge
PG_CONTAINER = os.environ.get("MUSIX_GATES_PG", "musix-v2-dev-postgres-1")
API_CONTAINER = os.environ.get("MUSIX_GATES_API", "musix-v2-dev-api-snap-1")  # mints test tokens with its keys


class V2Driver:
    """GET /api/v2/search on the snapshot database, one section per suite. v2 answers in
    its own track ids; `migr_track_map` (written by the snapshot loader) turns them back
    into v1 ids, so both targets are scored against the same fixtures."""

    target = "v2"

    def __init__(self, url: str = V2_URL) -> None:
        self.http = httpx.Client(base_url=url, timeout=300)
        self._mint()
        rows = subprocess.run(
            ["docker", "exec", PG_CONTAINER, "psql", "-U", "musix", "-d", SNAP_DB, "-Atc",
             "select track_id, v1_track_id from migr_track_map"], capture_output=True, text=True, check=True,
        ).stdout.split()
        self.v1_of = dict(r.split("|") for r in rows)

    def _mint(self) -> None:
        with open(__file__.replace("drivers.py", "mint_v2.py"), "rb") as f:
            out = subprocess.run(["docker", "exec", "-i", API_CONTAINER, "python", "-"], stdin=f,
                                 capture_output=True, check=True).stdout
        self.tokens: dict[str, str] = json.loads(out)
        self.minted = time.monotonic()

    def _get(self, coll: str, q: str, section: str) -> dict[str, Any]:
        if time.monotonic() - self.minted > 600:  # tokens last 15 min
            self._mint()
        r = self.http.get("/api/v2/search", params={"q": q, "limit": 10, "sections": section},
                          headers={"Authorization": f"Bearer {self.tokens[coll.removeprefix('acct_')]}"})
        r.raise_for_status()
        return dict(r.json())

    def _scored(self, coll: str, q: str, section: str) -> list[list[Any]]:
        return [[self.v1_of[h["track"]["id"]], h["score"]] for h in self._get(coll, q, section)[section]]

    def lyrics(self, coll: str, q: str) -> list[list[Any]]:
        return self._scored(coll, q, "lyrics")

    def sound(self, coll: str, q: str) -> list[list[Any]]:
        return self._scored(coll, q, "sound")

    def catalog(self, coll: str, q: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for h in self._get(coll, q, "catalog")["top"]:
            if h["type"] == "song":
                out.append({"type": "song", "track_id": self.v1_of.get(h["id"])})
            else:
                out.append({"type": h["type"], h["type"]: h["name"]})
        return out
