"""The client of `ml-sound` and of `ml`'s GPU lease endpoints (spec §4, §6.2). Every failure
to reach either is `Unavailable`: the tick and the batch task retry on their own schedule."""

from __future__ import annotations

from typing import Any

import httpx

from musix.errors import Unavailable


class SoundClient:
    def __init__(self, sound_url: str, ml_url: str) -> None:
        def client(url: str, read: float) -> httpx.AsyncClient:
            return httpx.AsyncClient(
                base_url=url, timeout=httpx.Timeout(read, connect=3.0), trust_env=False
            )

        self._sound = client(sound_url, 30.0)
        # release waits for the op in flight on ml's executor (a bulk CLAP pass, a rerank)
        self._ml = client(ml_url, 300.0)

    async def close(self) -> None:
        await self._sound.aclose()
        await self._ml.aclose()

    async def _call(self, h: httpx.AsyncClient, method: str, path: str, **kw: Any) -> Any:
        try:
            r = await h.request(method, path, **kw)
        except httpx.TransportError as e:
            raise Unavailable(f"{h.base_url}{path}: {type(e).__name__}") from e
        if r.status_code >= 500:
            raise Unavailable(f"{h.base_url}{path}: {r.status_code}")
        return r

    async def sound_health(self) -> dict[str, Any] | None:
        try:
            r = await self._call(self._sound, "GET", "/health")
        except Unavailable:
            return None
        return r.json() if r.is_success else None

    async def start_batch(self, items: list[dict[str, Any]]) -> str:
        """→ the batch id; a running batch's id when one is already on (409)."""
        r = await self._call(self._sound, "POST", "/v1/batches", json={"items": items})
        if r.status_code == 409:
            return str(r.json()["batch_id"])
        r.raise_for_status()
        return str(r.json()["batch_id"])

    async def batch(self, batch_id: str, since: int) -> dict[str, Any] | None:
        """The batch's state and the items done after `since`; None when ml-sound lost it."""
        r = await self._call(self._sound, "GET", f"/v1/batches/{batch_id}", params={"since": since})
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()  # type: ignore[no-any-return]

    async def ml_gpu(self) -> str | None:
        """ml's card state (loaded | lent | empty); None when ml is down."""
        try:
            r = await self._call(self._ml, "GET", "/health")
        except Unavailable:
            return None
        return r.json().get("gpu", "empty") if r.is_success else None

    async def ml_release(self) -> None:
        (await self._call(self._ml, "POST", "/v1/gpu/release")).raise_for_status()

    async def ml_acquire(self) -> None:
        (await self._call(self._ml, "POST", "/v1/gpu/acquire")).raise_for_status()
