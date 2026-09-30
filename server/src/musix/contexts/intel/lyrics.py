"""Online lyrics (spec §2): the tag first (read at ingest), then lrclib (the only source
with synced LRC), then lyrics.ovh, then syncedlyrics — v1's chain with lrclib moved to
the front for the timestamps. Every source runs inside its shared budget and breaker
(`infra/ratelimit`); a source that fails or finds nothing hands over to the next."""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.contexts.library.sanitizer import sanitize_lyrics
from musix.errors import Unavailable
from musix.infra.ratelimit import Source, guard

LRCLIB = Source("lrclib", rate=2.0, burst=4)
OVH = Source("lyrics.ovh", rate=2.5, burst=2)
SYNCED = Source("syncedlyrics", rate=0.5, burst=1)
UA = {"User-Agent": "MusiX/2 (self-hosted music player)"}


@dataclass(frozen=True)
class Query:
    title: str
    artist: str
    album: str | None
    duration_s: float | None


@dataclass(frozen=True)
class Found:
    text: str
    source: str
    synced_lrc: str | None = None


Fetch = Callable[[Query], Awaitable[Found | None]]


async def lrclib(q: Query) -> Found | None:
    params = {"track_name": q.title, "artist_name": q.artist}
    async with httpx.AsyncClient(timeout=8, headers=UA) as h:
        r = await h.get(
            "https://lrclib.net/api/get",
            params={
                **params,
                **({"album_name": q.album} if q.album else {}),
                **({"duration": round(q.duration_s)} if q.duration_s else {}),
            },
        )
        if r.status_code == 404:  # exact match missed: the fuzzy search endpoint
            r = await h.get("https://lrclib.net/api/search", params=params)
            hits = r.json() if r.status_code == 200 else []
            d = next((x for x in hits if x.get("plainLyrics")), None)
        else:
            r.raise_for_status()
            d = r.json()
    if not d or d.get("instrumental") or not d.get("plainLyrics"):
        return None
    return Found(d["plainLyrics"], "lrclib", d.get("syncedLyrics") or None)


async def ovh(q: Query) -> Found | None:
    async with httpx.AsyncClient(timeout=8, headers=UA) as h:
        r = await h.get(f"https://api.lyrics.ovh/v1/{q.artist}/{q.title}")
    if r.status_code != 200:
        return None
    text = (r.json().get("lyrics") or "").replace("\\n", "\n").strip()
    return Found(text, "lyrics.ovh") if text else None


async def synced(q: Query) -> Found | None:
    import syncedlyrics  # blocking requests inside: run it off the loop

    text = await asyncio.to_thread(
        syncedlyrics.search,
        f"{q.title} {q.artist}",
        providers=["Lrclib", "NetEase", "Megalobiz"],
        plain_only=True,
    )
    text = re.sub(r"\[.*?\]", "", text or "").strip()
    return Found(text, "syncedlyrics") if text else None


CHAIN: tuple[tuple[Source, Fetch], ...] = ((LRCLIB, lrclib), (OVH, ovh), (SYNCED, synced))


async def find(
    sm: async_sessionmaker[AsyncSession],
    q: Query,
    chain: tuple[tuple[Source, Fetch], ...] = CHAIN,
) -> Found | None:
    for src, fetch in chain:
        try:
            got = await guard(sm, src, lambda fetch=fetch: fetch(q))  # type: ignore[misc]
        except (Unavailable, httpx.HTTPError, ValueError, OSError):
            continue  # an open breaker, a network error, a bad body: the next source
        if got and (clean := sanitize_lyrics(got.text)):
            return Found(clean, got.source, got.synced_lrc)
    return None
