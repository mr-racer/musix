"""Serper.dev: Google's results over a JSON API.

The first road for every assistant search when ``MUSIX_SERPER_API_KEY`` is set. From
this host SearXNG's engines are mostly blocked and the direct scrapers are slow and
noisy (2026-11-12 measurements); Serper answers in ~1 s with Google's ranking,
honours ``site:`` and Russian queries.

When it cannot serve (no key, the credits ran out, the key was refused, the API rate
limit) it rests, and the rest is shared through ``source_health`` so every worker
learns it from one refusal; the searches then go the old way: SearXNG, then the direct
fallbacks. A network failure or a 5xx skips only that one query.
"""

from __future__ import annotations

import logging
import os
import re
import time

logger = logging.getLogger(__name__)

API_URL = os.environ.get("MUSIX_SERPER_URL", "https://google.serper.dev/search")
TIMEOUT = 6.0
# One credit buys up to 10 results; more costs double. The cross-encoder reranks
# anyway, so ten Google results beat twenty from the scrapers.
MAX_NUM = 10
EXHAUSTED_REST = 6 * 3600.0  # out of credits / key refused: check again in a few hours
RATE_REST = 60.0  # 429: the API's own rate limit
SHARED_CHECK_EVERY = 30.0
ROAD_MEMORY = 900.0

_state = {"until": 0.0, "checked": 0.0, "shared_open": False}
_road = {"proxy": False, "until": 0.0}


def api_key() -> str:
    return os.environ.get("MUSIX_SERPER_API_KEY", "").strip()


def available() -> bool:
    """A key is set and Serper is not resting (here or, per ``source_health``, in
    another worker)."""
    if not api_key():
        return False
    now = time.monotonic()
    if now < _state["until"]:
        return False
    if now - _state["checked"] > SHARED_CHECK_EVERY:
        _state["checked"] = now
        try:
            from musix.assistant import data

            got = data.rows(
                "SELECT open_until > now() FROM source_health WHERE source = 'serper'", {}
            )
            _state["shared_open"] = bool(got and got[0][0])
        except Exception:  # noqa: BLE001 — no shared state: trust the local one
            _state["shared_open"] = False
    return not _state["shared_open"]


def _rest(seconds: float, why: str) -> None:
    _state["until"] = time.monotonic() + seconds
    logger.warning("[serper] %s: resting %.0f min, searches go to SearXNG", why, seconds / 60)
    try:
        from musix.assistant import data

        data.rows(
            "INSERT INTO source_health (source, failures, open_until, last_error) "
            "VALUES ('serper', 0, now() + make_interval(secs => %(s)s), %(e)s) "
            "ON CONFLICT (source) DO UPDATE SET open_until = excluded.open_until, "
            "last_error = excluded.last_error RETURNING 1",
            {"s": seconds, "e": f"assistant: {why}"[:300]},
        )
        _state.update(checked=time.monotonic(), shared_open=True)
    except Exception:  # noqa: BLE001
        logger.info("[serper] could not share the rest", exc_info=True)


def _locale(q: str) -> dict:
    if re.search("[а-яё]", q, re.I):
        return {"gl": "ru", "hl": "ru"}
    return {"gl": "us", "hl": "en"}


def wikipedia_query(q: str) -> str:
    """A Wikipedia-only search: the language edition follows the query's script, as
    Wikipedia's own search API road does."""
    lang = "ru" if re.search("[а-яё]", q, re.I) else "en"
    return f"site:{lang}.wikipedia.org {q}"


def _post(body: dict, proxy: str | None):
    import httpx

    return httpx.post(
        API_URL,
        json=body,
        headers={"X-API-KEY": api_key(), "Content-Type": "application/json"},
        timeout=TIMEOUT,
        proxy=proxy,
    )


def search(q: str, limit: int = 10) -> list[dict] | None:
    """Google's organic results shaped like SearXNG rows (``url``/``title``/
    ``content``/``engine``). ``None`` means Serper did not serve this query (the
    caller takes the old road); ``[]`` means it answered with nothing. Never raises.

    The direct road first, the proxy when the direct one drops (it does at random
    from this host); never both at once — every request costs a credit."""
    if not q or not available():
        return None
    import httpx

    from musix.assistant.compat import get_proxy_url, outbound

    body = {"q": q, "num": max(1, min(limit, MAX_NUM)), **_locale(q)}
    proxy = get_proxy_url()
    roads: list[str | None] = [None, proxy] if proxy else [None]
    if proxy and _road["proxy"] and time.monotonic() < _road["until"]:
        roads.reverse()
    t0 = time.monotonic()
    resp = None
    for road in roads:
        try:
            with outbound("serper"):
                resp = _post(body, road)
            if road is not None and roads[0] is None:
                _road.update(proxy=True, until=time.monotonic() + ROAD_MEMORY)
            break
        except httpx.TransportError as exc:
            logger.info(
                "[serper] %s: %s: %s", "via proxy" if road else "direct", type(exc).__name__, exc
            )
        except Exception as exc:  # noqa: BLE001 — the breaker is open, or worse
            logger.info("[serper] skipped: %s: %s", type(exc).__name__, exc)
            return None
    if resp is None:
        return None

    status = resp.status_code
    if status != 200:
        text = (resp.text or "")[:200]
        if status in (401, 403) or (status == 400 and "credit" in text.lower()):
            _rest(EXHAUSTED_REST, f"HTTP {status} {text.strip()}")
        elif status == 429:
            _rest(RATE_REST, "HTTP 429")
        else:
            logger.info("[serper] HTTP %s for %r: %s", status, q, text)
        return None
    try:
        organic = resp.json().get("organic") or []
    except ValueError:
        logger.info("[serper] not JSON for %r", q)
        return None
    rows = [
        {
            "url": r.get("link") or "",
            "title": r.get("title") or "",
            "content": r.get("snippet") or "",
            "engine": "google",
        }
        for r in organic
        if r.get("link")
    ][:limit]
    logger.info("[serper] %r -> %d results in %.1fs", q, len(rows), time.monotonic() - t0)
    return rows
