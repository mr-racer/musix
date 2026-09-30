"""The seams between v1's assistant code (copied into this package) and v2.

v1 reached into process singletons: `ModelRegistry` (the models in-process), the
per-account SQLite `MetadataDB`, a per-account Qdrant collection, `settings_service`
and `llm_client`. Here each is one small adapter with the v1 call shape, so the copied
modules change only their imports:

- `ModelRegistry` → the ml service over HTTP (sync: the assistant's retrieval runs in
  worker threads, as in v1); vectors come back as numpy / scipy.sparse, not torch;
- `STATS` / `ModelError` → v1's names for "a leg degraded" and "a model failed";
- `run_async` → a coroutine from one of those threads, onto the turn's event loop
  (v1's `run_coroutine_threadsafe` bridge).

Everything that reads the account's data is bound to ONE account per turn
(`Account`) and filters by it — no path takes an account or collection from input."""

from __future__ import annotations

import asyncio
import logging
import threading
from collections import Counter
from collections.abc import Coroutine
from typing import Any, TypeVar

import httpx
import numpy as np
from scipy import sparse as sp

logger = logging.getLogger(__name__)
T = TypeVar("T")

SPARSE_DIM = 280_524  # = ml's MILCO dim
ENCODE_BATCH = 32


class ModelError(Exception):
    """A model leg failed (v1 app/resources/models/errors.ModelError)."""


class _Stats:
    """v1 `STATS.degraded(leg, where)`: a lost retrieval leg is counted, not hidden."""

    def __init__(self) -> None:
        self.counts: Counter[str] = Counter()
        self._lock = threading.Lock()

    def degraded(self, leg: str, where: str) -> None:
        with self._lock:
            self.counts[f"{leg}/{where}"] += 1


STATS = _Stats()


class MlSync:
    """v1 `ModelRegistry`'s retrieval calls, answered by the ml service."""

    def __init__(self, base_url: str, *, priority: str = "interactive") -> None:
        self.http = httpx.Client(
            base_url=base_url, timeout=httpx.Timeout(120.0, connect=3.0), trust_env=False
        )
        self.headers = {"X-Priority": priority}

    def _post(self, path: str, body: dict[str, Any]) -> Any:
        try:
            r = self.http.post(path, json=body, headers=self.headers)
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise ModelError(f"ml {path}: {type(e).__name__}") from e
        return r.json()

    def encode_text(self, texts: list[str], *, is_query: bool = False, **_: Any) -> np.ndarray:
        out: list[list[float]] = []
        for i in range(0, len(texts), 256):
            d = self._post(
                "/v1/embeddings",
                {
                    "input": texts[i : i + 256],
                    "model": "octen-query" if is_query else "octen-document",
                },
            )
            out.extend(x["embedding"] for x in sorted(d["data"], key=lambda x: x["index"]))
        return np.asarray(out, dtype=np.float32)

    def encode_sparse(self, texts: list[str], *, is_query: bool = False) -> sp.csr_matrix:
        rows, cols, vals = [], [], []
        base = 0
        for i in range(0, len(texts), 256):
            d = self._post(
                "/v1/embeddings/sparse", {"input": texts[i : i + 256], "is_query": is_query}
            )
            for x in sorted(d["data"], key=lambda x: x["index"]):
                rows.extend([base + x["index"]] * len(x["indices"]))
                cols.extend(x["indices"])
                vals.extend(x["values"])
            base += len(d["data"])
        return sp.csr_matrix(
            (np.asarray(vals, np.float32), (rows, cols)), shape=(len(texts), SPARSE_DIM)
        )

    def ce_probabilities(self, query: str, docs: list[str]) -> list[float]:
        if not docs:
            return []
        probs = [0.0] * len(docs)
        for i in range(0, len(docs), 256):
            d = self._post("/v1/rerank", {"query": query, "documents": docs[i : i + 256]})
            for r in d["results"]:
                probs[i + r["index"]] = float(r["relevance_score"])
        return probs

    def clap_text(self, texts: list[str]) -> np.ndarray:
        return np.asarray(self._post("/v1/clap/text", {"input": texts})["data"], dtype=np.float32)

    def gliner_tracks(self, texts: list[str]) -> list[dict[str, Any]]:
        return list(self._post("/v1/gliner/tracks", {"input": texts})["data"])

    def is_clap_available(self) -> bool:
        return True  # the ml service serves CLAP whenever it is up

    def retrieval_status(self) -> dict[str, Any]:
        try:
            r = self.http.get("/health")
            return dict(r.json())
        except httpx.HTTPError as e:
            return {"status": f"down: {type(e).__name__}"}

    def close(self) -> None:
        self.http.close()


_loop: asyncio.AbstractEventLoop | None = None


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def run_async(coro: Coroutine[Any, Any, T]) -> T:
    """Run a coroutine on the turn's loop from a worker thread and wait for it."""
    if _loop is None:
        raise RuntimeError("no event loop bound for the assistant")
    return asyncio.run_coroutine_threadsafe(coro, _loop).result()


_llm: Any = None


def set_llm(llm: Any) -> None:
    """The process's `musix.infra.llm.Llm` (the worker's)."""
    global _llm
    _llm = llm


def get_llm() -> Any:
    if _llm is None:
        raise RuntimeError("no LLM bound for the assistant")
    return _llm


async def ask_llm(
    user_message: str,
    *,
    system_prompt: str | None = None,
    temperature: float = 0.3,
    parse_json: bool = False,
    **_: Any,
) -> Any:
    """v1 `llm_client.ask_llm`'s signature over the v2 client."""
    llm = get_llm()
    if parse_json:
        return await llm.ask_json(
            user_message, system=system_prompt, temperature=temperature, kind="assistant"
        )
    return await llm.ask(
        user_message, system=system_prompt, temperature=temperature, kind="assistant"
    )


def get_proxy_url() -> str | None:
    """v1 `proxy_config.get_proxy_url`: the outbound proxy for web sources only."""
    from musix.settings import Settings

    return Settings().proxy_url or None


def get_proxy() -> dict[str, str] | None:
    """v1 `proxy_config.get_proxy`: requests-style proxies, or None."""
    url = get_proxy_url()
    return {"http": url, "https": url} if url else None


def ml_sync() -> MlSync:
    from musix.assistant.retrieval.hub import DEFAULT_HUB

    return DEFAULT_HUB.ml


_cfg: Any = None


def set_config(cfg: Any) -> None:
    """The LLM config resolved for this turn (the runner awaits it once)."""
    global _cfg
    _cfg = cfg


def pydantic_model() -> Any:
    """v1 `agents._create_pydantic_model` over the instance's LLM config. Tool-calling
    agents (track chat, the playlist agent's web leg) talk to the endpoint through
    pydantic-ai directly: their multi-turn tool loop is not llm_cache material."""
    if _cfg is None or _cfg.base_url is None:
        raise ModelError("LLM is not configured")
    return pydantic_model_for(_cfg)


def pydantic_model_for(cfg: Any) -> Any:
    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.providers.openai import OpenAIProvider

    return OpenAIChatModel(
        cfg.model, provider=OpenAIProvider(base_url=cfg.base_url, api_key=cfg.api_key)
    )


_sm: Any = None


def set_sessionmaker(sm: Any) -> None:
    global _sm
    _sm = sm


def sessionmaker() -> Any:
    return _sm


# ── outbound sources (phase 2 review focus 3: every one through a bucket + breaker) ──

SOURCES: dict[str, tuple[float, float, bool]] = {
    # name: (tokens/s, burst, breaker) — one budget for the whole instance
    "wikipedia": (5.0, 5.0, True),
    "duckduckgo": (1.0, 2.0, True),
    "reddit": (0.5, 1.0, True),
    "web-pages": (8.0, 8.0, False),  # arbitrary hosts: paced as one, no shared breaker
    "searxng": (1.0 / 1.5, 1.0, False),  # = searxng_client's pacing (a local instance)
}


def outbound(name: str) -> Any:
    """Wrap one outbound call of v1's assistant code (sync, on a worker thread): take a
    token from the shared bucket, refuse while the source's breaker is open, record the
    outcome. Outside a turn (tests, scripts: no loop bound) it is a no-op."""
    from contextlib import contextmanager

    @contextmanager
    def gate() -> Any:
        if _loop is None or _sm is None:
            yield
            return
        from musix.infra import ratelimit

        rate, burst, breaker = SOURCES[name]
        if breaker and run_async(ratelimit.is_open(_sm, name)):
            raise ModelError(f"{name} is failing; skipped")
        run_async(ratelimit.acquire(_sm, ratelimit.Source(name, rate, burst)))
        try:
            yield
        except Exception as e:
            if breaker:
                run_async(ratelimit.record(_sm, name, ok=False, error=f"{type(e).__name__}: {e}"))
            raise
        if breaker:
            run_async(ratelimit.record(_sm, name, ok=True))

    return gate()
