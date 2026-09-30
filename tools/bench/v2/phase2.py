"""Phase-2 exit bench (spec §9) on the snapshot DB (api-snap, 4 workers, :18010): the real
accounts, libraries and histories of the 2026-09-29 prod snapshot. 20 clients per route,
closed loop, spread over the accounts (tokens minted by tools/gates/mint_v2.py — the
passwords stay unknown). Queries come from the gate fixtures, which stay with the
snapshot, out of git.

  /stream/next      p95 < 150 ms
  autoplay          p95 < 100 ms
  /search           p95 < 250 ms   (all sections; the dense encode runs on the CPU ml here)
  listen → chunk    < 1 s          (POST a listen, then the next chunk reflects it)

Usage (from v2/server): uv run python ../tools/bench/v2/phase2.py --snap 2026-09-29 --out f.json
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import os
import random
import statistics
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

API = "http://127.0.0.1:18010/api/v2"
CLIENTS = 20
HERE = Path(__file__).resolve().parent

SNAP_DB = os.environ.get("MUSIX_SNAP_DB", "musix_mig")  # the database api-snap serves


def psql(q: str) -> list[str]:
    out = subprocess.check_output(["docker", "exec", "musix-v2-dev-postgres-1", "psql", "-U", "musix", "-d", SNAP_DB, "-Atc", q])
    return [x for x in out.decode().split("\n") if x]


def pct(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))] if xs else float("nan")


def tokens() -> dict[str, str]:
    with open(HERE.parents[1] / "gates" / "mint_v2.py", "rb") as f:
        out = subprocess.run(["docker", "exec", "-i", "musix-v2-dev-api-snap-1", "python", "-"], stdin=f, capture_output=True, check=True)
    minted: dict[str, str] = json.loads(out.stdout)
    return {"acct_" + v1.replace("-", ""): tok for v1, tok in minted.items()}


def summary(lat: list[float], errors: int, seconds: float) -> dict[str, Any]:
    return {"n": len(lat), "errors": errors, "rps": round(len(lat) / seconds, 1), "p50": round(pct(lat, 50), 1),
            "p95": round(pct(lat, 95), 1), "p99": round(pct(lat, 99), 1), "max": round(max(lat), 1) if lat else None}


async def scenario(name: str, make: Any, clients: list[dict[str, Any]], seconds: float, think: float = 0.0) -> dict[str, Any]:
    """Closed loop; `think` > 0 adds a pause between one client's requests (a paced user)."""
    lat: list[float] = []
    errors = 0
    stop = time.monotonic() + seconds

    async def one(c: dict[str, Any]) -> None:
        nonlocal errors
        async with httpx.AsyncClient(base_url=API, headers={"Authorization": f"Bearer {c['token']}"}, timeout=120) as h:
            if think:
                await asyncio.sleep(random.random() * think)  # spread the first requests
            while time.monotonic() < stop:
                method, url, kw = make(c)
                t = time.perf_counter()
                r = await h.request(method, url, **kw)
                ms = (time.perf_counter() - t) * 1000
                if r.status_code >= 400:
                    errors += 1
                else:
                    lat.append(ms)
                if think:
                    await asyncio.sleep(think)

    await asyncio.gather(*(one(c) for c in clients))
    out = summary(lat, errors, seconds)
    print(name, json.dumps(out))
    return out


async def listen_to_chunk(accounts: list[dict[str, Any]], runs: int) -> dict[str, Any]:
    """POST a full listen of the chunk's first track, then ask for the next chunk: the
    listened track must be gone from it (served today), and the session must know it.
    The time is the listen POST plus the next chunk, as a client sees them."""
    lat, fresh = [], 0
    for i in range(runs):
        a = accounts[i % len(accounts)]
        session = f"bench-{uuid.uuid4().hex[:8]}"
        async with httpx.AsyncClient(base_url=API, headers={"Authorization": f"Bearer {a['token']}"}, timeout=30) as h:
            first = (await h.get("/stream/next", params={"sessionId": session, "n": 3})).json()["items"]
            if not first:
                continue
            tid = first[0]["trackId"]
            dur = (first[0].get("track") or {}).get("durationMs") or 200_000
            ev = {"clientEventId": str(uuid.uuid4()), "sessionId": session, "trackId": tid,
                  "startedAt": (dt.datetime.now(dt.UTC) - dt.timedelta(milliseconds=dur)).isoformat(),
                  "playedMs": dur, "durationMs": dur, "endReason": "completed", "source": "stream", "contextType": "stream"}
            t = time.perf_counter()
            await h.post("/events/listens:batch", json={"events": [ev]})
            nxt = (await h.get("/stream/next", params={"sessionId": session, "n": 3})).json()["items"]
            lat.append((time.perf_counter() - t) * 1000)
            fresh += all(x["trackId"] != tid for x in nxt)
    return {"runs": len(lat), "reflected": fresh, "p50": round(pct(lat, 50), 1), "p95": round(pct(lat, 95), 1), "max": round(max(lat), 1) if lat else None}


def api_rss_mb() -> float:
    """Mean RSS of the api worker processes (the uvicorn master excluded)."""
    out = subprocess.check_output(["docker", "exec", "musix-v2-dev-api-snap-1", "sh", "-c",
                                   "for p in /proc/[0-9]*; do tr '\\0' ' ' < $p/cmdline; echo \" $(grep -s VmRSS $p/status)\"; done"]).decode()
    rss = [int(line.split("VmRSS:")[1].split()[0]) / 1024 for line in out.splitlines()
           if "VmRSS:" in line and ("multiprocessing" in line or "spawn_main" in line)]
    return round(statistics.mean(rss), 1) if rss else float("nan")


def fresh_day() -> None:
    """The bench's own served-today history goes before each stream scenario: thousands of
    chunks served in a minute would empty the libraries for the rest of the run."""
    psql("delete from stream_decisions where session_id like 'bench-%'")
    psql("delete from listen_events where session_id like 'bench-%'")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snap", default="2026-09-29")
    ap.add_argument("--seconds", type=float, default=20)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    fx = json.loads(Path(f"/mnt/data/musix-snapshots/{a.snap}/gates/fixtures.json").read_text())
    toks = tokens()
    accounts = []
    for coll, tok in toks.items():
        acct = psql(f"select m.account_id from migr_account_map m where replace(m.v1_user_id, '-', '') = '{coll[5:]}'")
        if not acct:
            continue
        tids = psql(f"select id from tracks where account_id = '{acct[0]}' and deleted_at is null order by random() limit 300")
        if len(tids) < 20:
            continue
        queries = [x["q"] for kind in ("lyrics", "catalog", "sound") for x in fx[kind] if x["coll"] == coll]
        accounts.append({"coll": coll, "token": tok, "tracks": tids, "queries": queries or ["love"]})
    print("accounts:", [(x["coll"][:12], len(x["tracks"]), len(x["queries"])) for x in accounts])
    clients = [dict(accounts[i % len(accounts)], session=f"bench-{i}") for i in range(CLIENTS)]
    rnd = random.Random(7)
    psql("select pg_stat_statements_reset()")
    res: dict[str, Any] = {"date": dt.date.today().isoformat(), "accounts": len(accounts), "clients": CLIENTS, "seconds": a.seconds}
    nxt = lambda c: ("GET", "/stream/next", {"params": {"sessionId": c["session"], "n": 3}})  # noqa: E731
    fresh_day()
    res["stream_next_paced"] = await scenario("stream_next_paced", nxt, clients, a.seconds, think=1.0)
    fresh_day()
    res["stream_next"] = await scenario("stream_next", nxt, clients, a.seconds)
    # the CPU ml encodes one query at a time: all-sections search is paced to what it can take
    res["search_paced"] = await scenario("search_paced", lambda c: ("GET", "/search", {"params": {"q": rnd.choice(c["queries"])}}), clients, a.seconds, think=10.0)
    res["autoplay"] = await scenario("autoplay", lambda c: ("POST", "/stream/autoplay", {"json": {"seedTrackId": rnd.choice(c["tracks"]), "limit": 20}}), clients, a.seconds)
    res["search_catalog"] = await scenario("search_catalog", lambda c: ("GET", "/search", {"params": {"q": rnd.choice(c["queries"])[:12], "sections": "catalog"}}), clients, a.seconds)
    fresh_day()
    res["listen_to_chunk"] = await listen_to_chunk(accounts, 40)
    print("listen_to_chunk", json.dumps(res["listen_to_chunk"]))
    res["api_rss_mb"] = api_rss_mb()
    top = psql("select round(total_exec_time)::int || '|' || calls || '|' || round(mean_exec_time::numeric, 2) || '|' || "
               "left(regexp_replace(query, '\\s+', ' ', 'g'), 110) from pg_stat_statements where dbid = (select oid from pg_database "
               f"where datname = '{SNAP_DB}') order by total_exec_time desc limit 10")
    res["pg_top10"] = [dict(zip(("total_ms", "calls", "mean_ms", "query"), r.split("|", 3), strict=True)) for r in top]
    fresh_day()
    if a.out:
        a.out.write_text(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    asyncio.run(main())
