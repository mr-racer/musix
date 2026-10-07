"""The home's sky knows the weather (design/code/screens/home.md): clear, cloudy,
rain or snow at the instance's place, from Open-Meteo (no key, no account). The
place is `MUSIX_WEATHER_LATLON="55.75,37.62"`; without it, or when the fetch
fails, the sky stays clear and nothing falls: the home never waits on the net.
One fetch per twenty minutes per process, in the background (the request path only
reads the cache), directly first and through the outbound proxy when the direct way
fails (internal traffic never goes through a proxy)."""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import time
from typing import Literal

import httpx

from musix.contexts.knowledge.sources import client
from musix.contexts.screens import schemas as S

log = logging.getLogger(__name__)

Kind = Literal["clear", "cloudy", "rain", "snow"]
URL = "https://api.open-meteo.com/v1/forecast"
TTL = 20 * 60.0
_cache: dict[str, tuple[float, S.WeatherOut | None]] = {}
_inflight: dict[str, asyncio.Task[None]] = {}


def kind_of(code: int) -> Kind:
    """WMO weather code → what the sky shows."""
    if code in (0, 1):
        return "clear"
    if code in (71, 73, 75, 77, 85, 86):
        return "snow"
    if 51 <= code <= 67 or 80 <= code <= 82 or 95 <= code <= 99:
        return "rain"
    return "cloudy"


def peek(latlon: str | None, proxy: str | None) -> S.WeatherOut | None:
    """What the sky shows now: the cached answer. A stale or missing one starts a fetch in
    the background (one at a time), so the request path never waits on the net; the first
    home after a start is clear, the next one knows."""
    if not latlon:
        return None
    hit = _cache.get(latlon)
    if (hit is None or time.monotonic() - hit[0] >= TTL) and latlon not in _inflight:
        task = asyncio.create_task(fetch(latlon, proxy))
        _inflight[latlon] = task
        task.add_done_callback(lambda _t: _inflight.pop(latlon, None))
    return hit[1] if hit else None


async def fetch(latlon: str, proxy: str | None) -> None:
    got: S.WeatherOut | None = None
    lat, lon = (float(x) for x in latlon.split(","))
    # Open-Meteo answers the server directly; the outbound proxy is the fallback (it exists
    # for the sources that are blocked here, and may not pass this one)
    for via in dict.fromkeys([None, proxy]):
        try:
            async with client(via) as http:
                r = await http.get(
                    URL,
                    params={
                        "latitude": lat,
                        "longitude": lon,
                        "current": "weather_code,temperature_2m",
                    },
                    timeout=httpx.Timeout(20.0, connect=10.0),
                )
                r.raise_for_status()
                cur = r.json()["current"]
            got = S.WeatherOut(
                kind=kind_of(int(cur["weather_code"])),
                code=int(cur["weather_code"]),
                temperature_c=cur.get("temperature_2m"),
                at=dt.datetime.now(dt.UTC),
            )
            break
        except Exception as e:  # the sky must not depend on the net
            log.warning(
                "[weather] no answer from Open-Meteo via %s (%s)", via or "direct", type(e).__name__
            )
    _cache[latlon] = (time.monotonic(), got)
