"""The LLM client: any OpenAI-compatible Chat Completions endpoint (llama-server, LM
Studio, Ollama, OpenAI) — v1 `llm_client`, reduced to one httpx call.

Configuration, highest first: the admin's `instance_settings["llm"]` row, then env
(`MUSIX_LLM_*`), then defaults. The API key is stored Fernet-encrypted (`apiKeyEnc`)
and never leaves this module: responses and logs get `public_view`.

Every answer is cached by the hash of what determines it (model, messages, temperature,
extra body) in `llm_cache` — the v1 `recsys_llm_texts` idea generalized. A rerun of an
enrichment job, or the same question twice, costs a PK lookup instead of a generation.

Concurrency and priority are the queue's job: LLM work runs on the `ai` queue, whose
worker has concurrency 1 (one local model); interactive jobs defer with a higher
priority than bulk enrichment. This module never sleeps or retries on its own."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
import sqlalchemy as sa
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.identity.models import instance_settings
from musix.contexts.knowledge.models import llm_cache
from musix.errors import Unavailable

DEFAULT_MODEL = "openai/gpt-oss-20b"  # v1's
DEFAULT_KEY = "lm-studio"  # v1's: local servers want *a* key
TIMEOUT = httpx.Timeout(600.0, connect=5.0)  # a 27b model writes a bio in minutes


@dataclass(frozen=True)
class LlmConfig:
    base_url: str | None
    model: str
    api_key: str = field(repr=False)  # never in a repr, a log line or a response

    def public_view(self) -> dict[str, Any]:
        return {
            "baseUrl": self.base_url,
            "model": self.model,
            "hasKey": self.api_key != DEFAULT_KEY,
        }


def normalize_base_url(url: str) -> str:
    url = url.strip().rstrip("/")
    return url if url.endswith("/v1") else url + "/v1"


async def config(
    s: AsyncSession,
    fernet: Fernet | None,
    env_base: str | None,
    env_model: str | None,
    env_key: str | None,
) -> LlmConfig:
    row: dict[str, Any] = (
        await s.scalar(sa.select(instance_settings.c.value).where(instance_settings.c.key == "llm"))
        or {}
    )
    key = None
    if row.get("apiKeyEnc") and fernet is not None:
        try:
            key = fernet.decrypt(row["apiKeyEnc"].encode()).decode()
        except InvalidToken:
            key = None  # a rotated Fernet key: the admin re-enters it
    base = row.get("baseUrl") or env_base
    return LlmConfig(
        base_url=normalize_base_url(base) if base else None,
        model=(row.get("model") or env_model or DEFAULT_MODEL).strip(),
        api_key=(key or env_key or DEFAULT_KEY).strip(),
    )


def encrypt_key(fernet: Fernet, key: str) -> str:
    return fernet.encrypt(key.encode()).decode()


def cache_key(
    model: str, messages: list[dict[str, str]], temperature: float, extra: dict[str, Any] | None
) -> str:
    blob = json.dumps(
        {"m": model, "msg": messages, "t": temperature, "x": extra or {}},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(blob.encode()).hexdigest()


def strip_fences(content: str) -> str:
    """v1 `ask_llm(parse_json=True)`: drop the ``` fences a model adds despite instructions."""
    clean = content.strip()
    for fence in ("```json", "```"):
        if clean.startswith(fence):
            clean = clean[len(fence) :].lstrip()
    if clean.endswith("```"):
        clean = clean[:-3].rstrip()
    return clean.strip()


log = logging.getLogger(__name__)

_THINK = re.compile(r"^\s*<think>.*?</think>\s*", re.S)


class Llm:
    """One per process. `ask` is the v1 `ask_llm` signature, minus per-call endpoints."""

    def __init__(
        self,
        sm: async_sessionmaker[AsyncSession],
        fernet: Fernet | None,
        env_base: str | None = None,
        env_model: str | None = None,
        env_key: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.sm, self.fernet = sm, fernet
        self.env = (env_base, env_model, env_key)
        # trust_env=False: never route the (usually LAN) endpoint through a shell proxy
        self.http = httpx.AsyncClient(timeout=TIMEOUT, trust_env=False, transport=transport)

    async def close(self) -> None:
        await self.http.aclose()

    async def config(self) -> LlmConfig:
        async with self.sm() as s:
            return await config(s, self.fernet, *self.env)

    async def ask(
        self,
        prompt: str,
        *,
        kind: str,
        system: str | None = None,
        temperature: float = 0.3,
        extra_body: dict[str, Any] | None = None,
        cache: bool = True,
    ) -> str:
        messages = ([{"role": "system", "content": system}] if system else []) + [
            {"role": "user", "content": prompt}
        ]
        return await self.chat(
            messages, kind=kind, temperature=temperature, extra_body=extra_body, cache=cache
        )

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        kind: str,
        temperature: float = 0.3,
        max_tokens: int | None = None,
        request_timeout: float | None = None,
        extra_body: dict[str, Any] | None = None,
        cache: bool = True,
        on_delta: Callable[[str], None] | None = None,
    ) -> str:
        """A message list (the assistant's repair rounds need one). Raises Unavailable.

        With [on_delta], the completion is streamed (SSE) and `on_delta(text so far)` is
        called as tokens arrive, so the answer appears while the model is still writing.
        A cache hit is reported once, whole."""
        cfg = await self.config()
        if cfg.base_url is None:
            raise Unavailable("LLM is not configured")
        extra = {**(extra_body or {}), **({"max_tokens": max_tokens} if max_tokens else {})}
        key = cache_key(cfg.model, messages, temperature, extra or None)
        if cache:
            async with self.sm() as s:
                hit = await s.scalar(sa.select(llm_cache.c.response).where(llm_cache.c.key == key))
            if hit is not None:
                if on_delta is not None:
                    on_delta(str(hit))
                return str(hit)
        body: dict[str, Any] = {
            "model": cfg.model,
            "messages": messages,
            "temperature": temperature,
        }
        body.update(extra)
        try:
            if on_delta is None:
                r = await self.http.post(
                    cfg.base_url + "/chat/completions",
                    json=body,
                    headers={"Authorization": f"Bearer {cfg.api_key}"},
                    timeout=request_timeout or httpx.USE_CLIENT_DEFAULT,
                )
                r.raise_for_status()
                raw = r.json()["choices"][0]["message"].get("content") or ""
            else:
                raw = await self._stream(cfg, body, request_timeout, on_delta)
        except httpx.HTTPError as e:
            raise Unavailable(
                f"LLM: {type(e).__name__}"
            ) from e  # the key is in headers, never in str(e)
        content = _THINK.sub("", raw).strip()
        if cache and content:
            async with self.sm() as s:
                await s.execute(
                    pg_insert(llm_cache)
                    .values(key=key, kind=kind, model=cfg.model, response=content)
                    .on_conflict_do_nothing()
                )
                await s.commit()
        return content

    async def _stream(
        self,
        cfg: LlmConfig,
        body: dict[str, Any],
        request_timeout: float | None,
        on_delta: Callable[[str], None],
    ) -> str:
        """`stream: true` over SSE: the deltas joined, `on_delta(text so far)` after each.
        A `<think>` preamble is held back until it closes; a broken callback never stops
        the answer."""
        parts: list[str] = []
        async with self.http.stream(
            "POST",
            cfg.base_url + "/chat/completions",
            json={**body, "stream": True},
            headers={"Authorization": f"Bearer {cfg.api_key}"},
            timeout=request_timeout or httpx.USE_CLIENT_DEFAULT,
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    delta = (json.loads(data)["choices"][0].get("delta") or {}).get("content")
                except (ValueError, KeyError, IndexError):
                    continue
                if not delta:
                    continue
                parts.append(delta)
                text = "".join(parts)
                if text.lstrip().startswith("<think>") and "</think>" not in text:
                    continue
                try:
                    on_delta(_THINK.sub("", text))
                except Exception:
                    log.debug("[llm] on_delta failed", exc_info=True)
        return "".join(parts)

    async def ask_json(self, prompt: str, **kw: Any) -> Any:
        return json.loads(strip_fences(await self.ask(prompt, **kw)))
