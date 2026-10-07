"""The home's sky knows the weather (design/code/screens/home.md): clear, cloudy,
rain or snow at the listener's place, from Open-Meteo (no key, no account). The
place is the one chosen in the settings (`settings.weather.place`, asked at the first
run and in the settings page); a listener who chose none gets the instance's default,
Istanbul unless `MUSIX_WEATHER_LATLON` says otherwise.

One fetch per place per twenty minutes per process, in the background (the request
path only reads the cache), directly first and through the outbound proxy when the
direct way fails (internal traffic never goes through a proxy). The place search for
the settings (`places`) is Open-Meteo's geocoding, cached an hour per query."""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import logging
import time
from typing import Any, Literal

import httpx

from musix.contexts.knowledge.sources import client
from musix.contexts.screens import schemas as S

log = logging.getLogger(__name__)

Kind = Literal["clear", "cloudy", "rain", "snow"]
URL = "https://api.open-meteo.com/v1/forecast"
GEO = "https://geocoding-api.open-meteo.com/v1/search"
ISTANBUL = "55.7522,37.6156"
TTL = 20 * 60.0
_cache: dict[str, tuple[float, S.WeatherOut | None]] = {}
_inflight: dict[str, asyncio.Task[None]] = {}
_places: dict[str, tuple[float, list[S.PlaceOut]]] = {}


def latlon_of(settings_value: dict[str, Any] | None, instance_default: str | None) -> str:
    """The listener's place as "lat,lon": the settings' choice, else the instance's default
    (Istanbul unless `MUSIX_WEATHER_LATLON` says otherwise; empty switches the weather off)."""
    place = ((settings_value or {}).get("weather") or {}).get("place") or {}
    try:
        return f"{float(place['lat']):.4f},{float(place['lon']):.4f}"
    except (KeyError, TypeError, ValueError):
        return instance_default or ""  # an empty default means no weather at all (the tests)


def kind_of(code: int) -> Kind:
    """WMO weather code → what the sky shows."""
    if code in (0, 1):
        return "clear"
    if code in (71, 73, 75, 77, 85, 86):
        return "snow"
    if 51 <= code <= 67 or 80 <= code <= 82 or 95 <= code <= 99:
        return "rain"
    return "cloudy"


async def peek(latlon: str | None, proxy: str | None, wait: float = 1.5) -> S.WeatherOut | None:
    """What the sky shows now: the cached answer. A stale one refreshes in the background;
    a missing one (this process's first look at the place) is fetched now, but the home
    waits for it no longer than `wait`: after that the sky is clear and the fetch finishes
    on its own for the next request."""
    if not latlon:
        return None
    hit = _cache.get(latlon)
    if (hit is None or time.monotonic() - hit[0] >= TTL) and latlon not in _inflight:
        task = asyncio.create_task(fetch(latlon, proxy))
        _inflight[latlon] = task
        task.add_done_callback(lambda _t: _inflight.pop(latlon, None))
    pending = _inflight.get(latlon)
    if hit is None and pending is not None:
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(asyncio.shield(pending), wait)
        hit = _cache.get(latlon)
    return hit[1] if hit else None


async def fetch(latlon: str, proxy: str | None) -> None:
    if not latlon:
        return
    got: S.WeatherOut | None = None
    lat, lon = (float(x) for x in latlon.split(","))
    # Open-Meteo answers the server directly; the outbound proxy is the fallback (it exists
    # for the sources that are blocked here, and may not pass this one)
    for via, connect in ((None, 4.0), (proxy, 10.0)):
        try:
            async with client(via) as http:
                r = await http.get(
                    URL,
                    params={
                        "latitude": lat,
                        "longitude": lon,
                        "current": "weather_code,temperature_2m",
                    },
                    timeout=httpx.Timeout(20.0, connect=connect),
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
    # a failed round is remembered for two minutes only, so the sky is not clear for twenty
    _cache[latlon] = (time.monotonic() - (0 if got else TTL - 120), got)


async def places(q: str, proxy: str | None, lang: str = "ru") -> list[S.PlaceOut]:
    """Cities for the settings' place picker, as Open-Meteo's geocoding names them."""
    key = f"{lang}:{q.strip().lower()}"
    if len(key) < 5:
        return []
    hit = _places.get(key)
    if hit and time.monotonic() - hit[0] < 3600:
        return hit[1]
    out: list[S.PlaceOut] | None = None
    # the direct way answers in a third of a second or not at all, so it gets three seconds
    # before the proxy's turn; a failed lookup is not remembered
    for via, connect in ((None, 3.0), (proxy, 8.0)):
        try:
            async with client(via) as http:
                r = await http.get(
                    GEO,
                    params={"name": q.strip(), "count": 6, "language": lang, "format": "json"},
                    timeout=httpx.Timeout(15.0, connect=connect),
                )
                r.raise_for_status()
                rows = r.json().get("results") or []
            out = [
                S.PlaceOut(
                    name=str(x["name"]),
                    country=x.get("country"),
                    admin=x.get("admin1"),
                    lat=float(x["latitude"]),
                    lon=float(x["longitude"]),
                )
                for x in rows
                if "latitude" in x and "longitude" in x
            ]
            break
        except Exception as e:  # the picker just finds nothing
            log.warning("[weather] geocoding failed via %s (%s)", via or "direct", type(e).__name__)
    if out is None:
        return []
    _places[key] = (time.monotonic(), out)
    return out
