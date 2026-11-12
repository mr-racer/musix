"""The raw SearXNG call, paced and diagnosed.

This wraps the search instance and nothing else: one HTTP request, the whole
JSON body, and the rate limiting the instance needs to keep working. Every
policy decision on top of it — which engines, what counts as spam, when one host
has taken over the results — lives in the service that calls this.

**Why the whole body and not just ``results``.** ``unresponsive_engines`` is
where the diagnosis lives. Without it, "DuckDuckGo timed out and this answer was
assembled by three fallbacks" is invisible from inside and shows up only as "the
results got worse".

**Why the pacing.** One assistant iteration fires up to eight searches, each
fanning out to every engine in the whitelist — roughly 50 outbound requests from
one IP in a couple of seconds. DuckDuckGo and Brave rate-limit that immediately,
SearXNG reads the timeout as a failure and suspends the engine for up to
``max_ban_time_on_fail``, and the rest of the run gets served by whatever fringe
engines are left. That is the mechanism behind a Kanye query coming back with
Indonesian journal PDFs.

The gate is process-global and the wait is real (unlike Reddit's, which skips):
a search is on the critical path of every branch, so skipping it would mean
answering without having looked, while a second of spacing is the cost of the
engines answering at all. It is a blocking sleep, so callers must be on a worker
thread — which they are, the whole search phase runs through ``to_thread``.

SearXNG is always a LOCAL service (the Compose network, or a port on the host),
so nothing here is ever proxied.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Optional

logger = logging.getLogger(__name__)

SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://searxng:8080").rstrip("/")

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"

_gate = threading.Lock()
_next_call_at = 0.0
SEARX_BURST = 4.0

# Wikimedia's User-Agent policy: an API call that looks like a browser (curl_cffi's
# Chrome impersonation) is answered 429 from this host, a descriptive agent in
# under a second (measured 2026-11-12). Every «wikipedia api direct: Expecting
# value» line in the worker log was that 429 page.
WIKI_UA = "MusixAssistant/2.0 (self-hosted music player; assistant web search)"
# Hedging: the second road starts this long after the first unless the first has
# answered; whichever answers usefully first wins and is tried first next time.
HEDGE_AFTER = 1.0
ROAD_MEMORY = 900.0
FALLBACK_DEADLINE = 9.0
_roads: dict = {}  # name -> (preferred road, until)


def _first_ok(calls: list, *, after: float = HEDGE_AFTER, deadline: float = FALLBACK_DEADLINE):
    """``(index, result)`` of the first of ``calls`` to return something truthy,
    each started ``after`` seconds after the previous unless one already answered.
    ``(None, None)`` when none did by ``deadline``. Losers run on and are ignored."""
    from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

    pool = ThreadPoolExecutor(len(calls))
    started = time.monotonic()
    futures: dict = {}
    try:
        nxt = 0
        while True:
            if nxt < len(calls):
                futures[pool.submit(calls[nxt])] = nxt
                nxt += 1
            # a road that already answered wins before anything is waited on
            for fut, i in futures.items():
                if fut.done() and not fut.exception() and fut.result():
                    return i, fut.result()
            pending = [f for f in futures if not f.done()]
            if not pending and nxt >= len(calls):
                return None, None
            left = deadline - (time.monotonic() - started)
            if left <= 0:
                return None, None
            if pending:
                wait(
                    pending,
                    timeout=min(left, after) if nxt < len(calls) else left,
                    return_when=FIRST_COMPLETED,
                )
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def _hedged(name: str, roads: list, call):
    """``call(road)`` over ``roads``, the one that won last time first."""
    pref, until = _roads.get(name, (None, 0.0))
    if pref in roads and time.monotonic() < until:
        roads = [pref] + [r for r in roads if r != pref]
    i, got = _first_ok([lambda r=r: call(r) for r in roads])
    if i is not None:
        _roads[name] = (roads[i], time.monotonic() + ROAD_MEMORY)
    return got


def base_url() -> str:
    """The instance address, read at call time so a test can repoint it."""
    return (os.environ.get("SEARXNG_URL") or SEARXNG_URL).rstrip("/")


def _pace(min_interval: float) -> None:
    """v2: the shared `searxng` token bucket (infra/ratelimit), so every worker
    process spaces its searches as one; the wait happens on the turn's loop while
    this worker thread blocks on it (phase 2 spec §7: pacing is a queue rate limit)."""
    from musix.assistant import compat

    if compat.sessionmaker() is None:  # no loop bound (tests, one-off scripts)
        return
    from musix.infra.ratelimit import Source, acquire

    # burst = one round's searches: the round fires them together now, and a burst
    # of 1 made the «parallel» searches of one turn wait 1.5 s for each other.
    compat.run_async(
        acquire(
            compat.sessionmaker(),
            Source("searxng", rate=1.0 / max(min_interval, 0.1), burst=SEARX_BURST),
        )
    )


def _set_next(min_interval: float) -> None:
    global _next_call_at
    _next_call_at = time.monotonic() + min_interval


def query(
    q: str,
    *,
    engines: Optional[str] = None,
    language: str = "en",
    limit: int = 20,
    timeout: float = 20.0,
    min_interval: float = 1.5,
) -> Optional[dict]:
    """One search. ``None`` means the INSTANCE did not answer.

    A ``None`` and an empty ``results`` are different failures with different
    fixes — the instance being down versus the engines having nothing — so they
    are kept apart rather than both collapsing to "no results".

    The returned dict is SearXNG's own, with ``results`` truncated to ``limit``.
    """
    import httpx

    if not (q or "").strip():
        return None

    base = base_url()
    if not base or "<" in base:
        logger.warning("[searxng] no usable instance address (%r)", base)
        return None

    _pace(min_interval)

    params = {"q": q, "format": "json", "language": language, "safesearch": 0, "pageno": 1}
    if engines:
        params["engines"] = engines

    try:
        resp = httpx.get(
            f"{base}/search",
            params=params,
            timeout=timeout,
            headers={
                "Accept": "application/json, text/javascript, */*",
                "Referer": f"{base}/",
                "User-Agent": _UA,
            },
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # noqa: BLE001 — an unreachable instance is a state
        logger.warning("[searxng] unreachable for %r: %s: %s", q, type(exc).__name__, exc)
        return None

    results = (data.get("results") or [])[:limit]
    return {
        "results": results,
        "unresponsive_engines": [list(e) for e in (data.get("unresponsive_engines") or [])],
        "number_of_results": data.get("number_of_results"),
    }


def fallback(q: str, limit: int = 10, engines: str | None = None) -> list[dict]:
    """SearXNG did not answer, or every engine it was pinned to failed.

    From this host its engines are mostly blocked. Measured 2026-11-12: of the
    `ddgs` backends only Bing answers (direct or via the proxy, 2-12 s, either road
    stalling at random); DuckDuckGo / Brave / Mojeek / Google / Startpage return
    nothing, and `backend="auto"` walks those dead ones and waits out their timeouts.
    Now:
    - a Wikipedia-pinned query asks Wikipedia's own search API (SearXNG's engine only
      answers an exact title);
    - any other query asks `ddgs` Bing (hedged across both roads), our own Bing
      scrape and Wikipedia's API at once, DuckDuckGo-shaped rows first, and the whole
      thing ends at ``FALLBACK_DEADLINE`` with whatever has answered.
    """
    if engines and "wikipedia" in engines:
        rows = search_wikipedia(q, limit)
        if rows:
            return rows
    from concurrent.futures import ThreadPoolExecutor, wait

    from musix.assistant.web_search import search_bing

    pool = ThreadPoolExecutor(3)
    try:
        parts = [
            pool.submit(search_ddg, q, limit),
            pool.submit(lambda: [{**r, "engine": "bing"} for r in search_bing(q, limit)]),
            pool.submit(search_wikipedia, q, min(limit, 5)),
        ]
        wait(parts, timeout=FALLBACK_DEADLINE)
        rows: list[dict] = []
        for fut in parts:
            if not fut.done() or fut.exception() is not None:
                continue
            seen = {r["url"] for r in rows}
            rows += [r for r in fut.result() if r["url"] not in seen]
        if not all(f.done() for f in parts):
            logger.info(
                "[searxng] fallback deadline for %r: %d rows from the roads that answered",
                q,
                len(rows),
            )
        return rows
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def search_pinned(q: str, limit: int = 10) -> list[dict]:
    """A `site:` query. SearXNG answered none from this host, so it is not asked:
    `ddgs` Bing honours the operator (fandom / music.apple.com rows, 2-6 s)."""
    return search_ddg(q, limit)


def search_wikipedia(q: str, limit: int = 10) -> list[dict]:
    """Wikipedia's search API: Russian for a Cyrillic query, English otherwise. Never raises.

    Plain httpx with a descriptive agent (see ``WIKI_UA``), hedged over the two
    roads: the direct one drops with «Network is unreachable» at random, the
    proxy answers in ~1 s."""
    import re

    import httpx

    from musix.assistant.compat import get_proxy_url, outbound

    lang = "ru" if re.search("[а-яё]", q, re.I) else "en"
    params = {
        "action": "query",
        "list": "search",
        "srsearch": q,
        "srlimit": min(limit, 10),
        "format": "json",
        "srprop": "snippet",
    }

    def ask(proxy: str | None) -> list[dict] | None:
        try:
            with outbound("wikipedia-proxy" if proxy else "wikipedia-direct"):
                r = httpx.get(
                    f"https://{lang}.wikipedia.org/w/api.php",
                    params=params,
                    headers={"User-Agent": WIKI_UA},
                    timeout=6,
                    proxy=proxy,
                )
            r.raise_for_status()
            hits = (r.json().get("query") or {}).get("search") or []
        except Exception as exc:  # noqa: BLE001 — the other road, then nothing
            logger.info(
                "[searxng] wikipedia api %s: %s: %s",
                "via proxy" if proxy else "direct",
                type(exc).__name__,
                exc,
            )
            return None
        return [
            {
                "url": f"https://{lang}.wikipedia.org/wiki/" + h["title"].replace(" ", "_"),
                "title": h["title"],
                "content": re.sub(r"<[^>]+>", "", h.get("snippet") or ""),
                "engine": "wikipedia",
            }
            for h in hits
        ]

    proxy = get_proxy_url()
    return _hedged("wikipedia", [None, proxy] if proxy else [None], ask) or []


def search_ddg(q: str, limit: int = 10) -> list[dict]:
    """`ddgs` with the one backend that answers from this host (Bing by default),
    hedged over the direct road and the proxy. Shaped like a SearXNG result row
    (``url``/``title``/``content``) so callers need no second code path. Never raises.
    """
    try:
        from ddgs import DDGS
    except ImportError:
        logger.info("[searxng] no ddgs fallback installed")
        return []
    from musix.assistant.compat import get_proxy_url, outbound

    def ask(proxy: str | None) -> list | None:
        try:
            with (
                outbound("ddgs-proxy" if proxy else "ddgs-direct"),
                DDGS(timeout=6, proxy=proxy) as ddgs,
            ):
                return list(ddgs.text(q, max_results=limit, backend=DDGS_BACKEND))
        except Exception as exc:  # noqa: BLE001
            logger.info(
                "[searxng] ddgs %s %s: %s: %s",
                DDGS_BACKEND,
                "via proxy" if proxy else "direct",
                type(exc).__name__,
                exc,
            )
            return None

    proxy = get_proxy_url()
    rows = _hedged("ddgs", [None, proxy] if proxy else [None], ask) or []
    return [
        {
            "url": r.get("href") or r.get("url") or "",
            "title": r.get("title") or "",
            "content": r.get("body") or r.get("content") or "",
            "engine": "duckduckgo",
        }
        for r in rows
    ]


# The one `ddgs` backend that answers from this host (2026-11-12); `auto` walks the dead.
DDGS_BACKEND = os.environ.get("MUSIX_DDGS_BACKEND", "bing")
