"""Phase-1 exit bench (spec §10): 20 concurrent users on the synthetic 6k account, through
nginx (the real edge). Logins go to the api port directly: nginx rate-limits /auth.
Usage (from server/): uv run python ../tools/bench/v2/load.py [--seconds 20] [--out f.json]
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import datetime as dt
import json
import random
import statistics
import subprocess
import time
import uuid

import httpx

EDGE = "http://127.0.0.1:18080/api/v2"
API = "http://127.0.0.1:18000/api/v2"
BENCH = {"email": "bench@example.com", "password": "bench-pass-123"}
USERS = 20


def psql(q: str) -> list[str]:
    out = subprocess.check_output(
        ["docker", "exec", "musix-v2-dev-postgres-1", "psql", "-U", "musix", "-d", "musix", "-Atc", q]
    )
    return out.decode().split()


def pct(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


async def scenario(name, make, tokens, seconds):  # type: ignore[no-untyped-def]
    lat: list[float] = []
    errors = 0
    stop = time.monotonic() + seconds

    async def user(i: int, tok: str) -> None:
        nonlocal errors
        async with httpx.AsyncClient(timeout=30, headers={"Authorization": f"Bearer {tok}"}) as c:
            while time.monotonic() < stop:
                method, path, body = make(i)
                t = time.perf_counter()
                r = await c.request(method, EDGE + path, json=body)
                lat.append((time.perf_counter() - t) * 1000)
                if r.status_code >= 400:
                    errors += 1

    await asyncio.gather(*(user(i, t) for i, t in enumerate(tokens)))
    res = {"n": len(lat), "errors": errors, "p50": round(pct(lat, 50), 1), "p95": round(pct(lat, 95), 1),
           "p99": round(pct(lat, 99), 1), "rps": round(len(lat) / seconds)}
    print(f"{name:22} {res}", flush=True)
    return res


async def initial_sync(tok: str) -> dict:
    """One client, cold: every page until hasMore is false (gzip on, as clients get it)."""
    runs = []
    for _ in range(3):
        t, pages, changes, raw = time.perf_counter(), 0, 0, 0
        cursor = None
        async with httpx.AsyncClient(timeout=60, headers={"Authorization": f"Bearer {tok}"}) as c:
            while True:
                r = await c.get(EDGE + "/sync", params={"limit": 1000, **({"cursor": cursor} if cursor else {})})
                page = r.json()
                pages, changes = pages + 1, changes + len(page["changes"])
                raw += int(r.headers.get("content-length") or 0) or len(r.content)
                cursor = page["cursor"]
                if not page["hasMore"]:
                    break
        runs.append(((time.perf_counter() - t) * 1000, pages, changes, raw))
    ms = statistics.median(r[0] for r in runs)
    print(f"initial sync           {ms:.0f} ms, {runs[0][1]} pages, {runs[0][2]} changes", flush=True)
    return {"ms": round(ms), "pages": runs[0][1], "changes": runs[0][2]}


def rss_sampler(samples: list[float], stop: asyncio.Event) -> asyncio.Task[None]:
    """The largest api process's RSS (the budget is per worker), every 2 s."""
    cmd = ["docker", "exec", "musix-v2-dev-api-1", "sh", "-c",
           "for p in /proc/[0-9]*; do grep -s VmRSS $p/status; done"]

    async def run() -> None:
        while not stop.is_set():
            # in a thread: docker exec takes a while and would freeze the load loop itself
            out = (await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True)).stdout
            kb = [int(line.split()[1]) for line in out.splitlines() if line.startswith("VmRSS")]
            if kb:
                samples.append(max(kb) / 1024)
            await asyncio.sleep(2)
    return asyncio.create_task(run())


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=20)
    ap.add_argument("--out")
    args = ap.parse_args()
    tokens = []
    for i in range(USERS):
        r = httpx.post(f"{API}/auth/login", json={**BENCH, "device": {"name": f"bench-{i}", "platform": "android"}})
        r.raise_for_status()
        tokens.append(r.json()["accessToken"])
    acct = r.json()["accountId"]
    # writes: 20 people, 20 accounts (one account's 20 devices hammering the same stats
    # rows is lock contention no real library has)
    writers, own = [], []
    for i in range(1, USERS + 1):
        w = httpx.post(f"{API}/auth/login", json={"email": f"bench-{i:02d}@example.com",
                       "password": BENCH["password"], "device": {"name": "bench", "platform": "android"}})
        w.raise_for_status()
        writers.append(w.json()["accessToken"])
        own.append(psql(f"select id from tracks where account_id = '{w.json()['accountId']}'"))
    track_ids = psql(f"select id from tracks where account_id = '{acct}' and deleted_at is null")
    album_ids = psql(f"select distinct album_id from tracks where account_id = '{acct}' and album_id is not null")
    head = int(psql(f"select max(seq) from change_log where account_id = '{acct}'")[0])
    delta = base64.urlsafe_b64encode(json.dumps({"s": head - 100}).encode()).decode().rstrip("=")
    rnd = random.Random(1)
    psql("select pg_stat_statements_reset()")

    def listens(n: int):  # type: ignore[no-untyped-def]
        def make(i: int):  # type: ignore[no-untyped-def]
            now = dt.datetime.now(dt.UTC).isoformat()
            return "POST", "/events/listens:batch", {"events": [
                {"clientEventId": str(uuid.uuid4()), "sessionId": "bench", "trackId": rnd.choice(own[i]),
                 "startedAt": now, "playedMs": 200_000, "durationMs": 240_000, "endReason": "completed"}
                for _ in range(n)]}
        return make

    rss: list[float] = []
    stop = asyncio.Event()
    sampler = rss_sampler(rss, stop)
    results = {
        "home": await scenario("GET /home", lambda i: ("GET", "/home", None), tokens, args.seconds),
        "album": await scenario("GET /albums/{id}", lambda i: ("GET", f"/albums/{rnd.choice(album_ids)}", None), tokens, args.seconds),
        "player_context": await scenario("GET /player/context", lambda i: ("GET", f"/player/context/{rnd.choice(track_ids)}", None), tokens, args.seconds),
        "sync_delta_100": await scenario("GET /sync delta 100", lambda i: ("GET", f"/sync?cursor={delta}", None), tokens, args.seconds),
        "listens_10": await scenario("POST listens ×10", listens(10), writers, args.seconds),
        "listens_100": await scenario("POST listens ×100", listens(100), writers, args.seconds),
        "manifest_5": await scenario("POST manifest ×5", lambda i: ("POST", "/playback/manifest", {"trackIds": rnd.sample(track_ids, 5), "network": "cellular"}), tokens, args.seconds),
    }
    stop.set()
    await sampler
    results["initial_sync"] = await initial_sync(tokens[0])
    results["api_rss_mb"] = {"max": round(max(rss)), "samples": len(rss)}
    print(f"api RSS max/worker     {max(rss):.0f} MB over {len(rss)} samples", flush=True)
    top = subprocess.check_output(["docker", "exec", "musix-v2-dev-postgres-1", "psql", "-U", "musix", "-d", "musix",
        "-Atc", "select calls, round(total_exec_time::numeric, 1), round(mean_exec_time::numeric, 3), rows, "
        "regexp_replace(left(query, 160), '\\s+', ' ', 'g') from pg_stat_statements "
        "where query not ilike '%pg_stat_statements%' order by total_exec_time desc limit 10"]).decode()
    results["pg_top10"] = [dict(zip(["calls", "total_ms", "mean_ms", "rows", "query"], line.split("|", 4)))
                           for line in top.strip().splitlines()]
    results["dataset"] = {"tracks": len(track_ids), "albums": len(album_ids)}
    if args.out:
        json.dump(results, open(args.out, "w"), indent=2, ensure_ascii=False)


if __name__ == "__main__":
    asyncio.run(main())
