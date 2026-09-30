"""The one client for the `ml` service (spec §1): pooled connections, timeouts, and a
breaker per operation, so a dead model host costs one fast refusal instead of every
request waiting out a timeout. Every call names its priority: `interactive` when a user
is waiting, `bulk` for ingest and enrichment."""

from __future__ import annotations

import time
from typing import Any, Literal

import httpx
import numpy as np

from musix.errors import Unavailable

Priority = Literal["interactive", "bulk"]
FAILURES_TO_OPEN, OPEN_S = 5, 30.0


class MlClient:
    def __init__(self, base_url: str, *, read_timeout: float = 600.0) -> None:
        self._http = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(read_timeout, connect=3.0),
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
            trust_env=False,  # internal traffic never goes through a proxy
        )
        self._fails: dict[str, int] = {}
        self._open_until: dict[str, float] = {}

    async def close(self) -> None:
        await self._http.aclose()

    async def _post(self, op: str, path: str, body: dict[str, Any], priority: Priority) -> Any:
        if self._open_until.get(op, 0.0) > time.monotonic():
            raise Unavailable(f"ml {op} is failing; retrying shortly", op=op)
        try:
            r = await self._http.post(path, json=body, headers={"X-Priority": priority})
        except httpx.TransportError as e:
            self._fail(op)
            raise Unavailable(f"ml {op}: {type(e).__name__}", op=op) from e
        if r.status_code in (429, 503):  # a state the host names: retry, not a fault
            err = r.json().get("error", {})
            raise Unavailable(
                err.get("message", f"ml {op} busy"), op=op, retry_after=r.headers.get("retry-after")
            )
        if r.status_code >= 500:
            self._fail(op)
            raise Unavailable(f"ml {op} failed ({r.status_code})", op=op)
        r.raise_for_status()
        self._fails[op] = 0
        return r.json()

    def _fail(self, op: str) -> None:
        self._fails[op] = self._fails.get(op, 0) + 1
        if self._fails[op] >= FAILURES_TO_OPEN:
            self._open_until[op] = time.monotonic() + OPEN_S
            self._fails[op] = 0

    async def embed_text(
        self, texts: list[str], *, is_query: bool, priority: Priority
    ) -> np.ndarray:
        model = "octen-query" if is_query else "octen-document"
        d = await self._post("dense", "/v1/embeddings", {"input": texts, "model": model}, priority)
        return np.asarray([x["embedding"] for x in d["data"]], dtype=np.float32)

    async def embed_sparse(
        self, texts: list[str], *, is_query: bool, priority: Priority
    ) -> list[tuple[list[int], list[float]]]:
        d = await self._post(
            "sparse", "/v1/embeddings/sparse", {"input": texts, "is_query": is_query}, priority
        )
        return [(x["indices"], x["values"]) for x in d["data"]]

    async def rerank(self, query: str, docs: list[str], *, priority: Priority) -> list[float]:
        if not docs:
            return []
        d = await self._post("rerank", "/v1/rerank", {"query": query, "documents": docs}, priority)
        scores = [0.0] * len(docs)
        for x in d["results"]:
            scores[x["index"]] = x["relevance_score"]
        return scores

    async def clap_text(self, texts: list[str], *, priority: Priority) -> np.ndarray:
        d = await self._post("clap_text", "/v1/clap/text", {"input": texts}, priority)
        return np.asarray(d["data"], dtype=np.float32)

    async def clap_audio(
        self, path: str, *, priority: Priority = "bulk"
    ) -> tuple[np.ndarray, np.ndarray] | None:
        d = await self._post("clap_audio", "/v1/clap/audio", {"path": path}, priority)
        if d["mean"] is None:
            return None
        return np.asarray(d["mean"], np.float32), np.asarray(d["chunks"], np.float32)

    async def gliner(
        self, texts: list[str], *, priority: Priority = "bulk"
    ) -> list[dict[str, Any]]:
        d = await self._post("gliner", "/v1/gliner/relations", {"input": texts}, priority)
        return list(d["data"])

    async def proxy(self, path: str, body: dict[str, Any], priority: Priority) -> Any:
        """The raw ml response, for the public /api/v2/models passthrough."""
        return await self._post(path.rsplit("/", 1)[-1], path, body, priority)
