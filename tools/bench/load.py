"""HTTP latency of the v1 COPY (never prod) under 1 / 5 / 20 concurrent users.

The request mix is the prod access log: the path frequencies of `docker logs musix`
(read-only), top 25 routes, with {id} filled from the snapshot's own track ids. The
log only covers the time since the last prod restart; the window goes in the report.
Usage: python http.py <snapshot dir> [--minutes 5]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import re
import sqlite3
import subprocess
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "gates"))
from drivers import V1_URL, v1_tokens  # noqa: E402

ID = re.compile(r"/[0-9a-f]{8}-[0-9a-f-]{27,}|/acct_[0-9a-f]+|/[0-9a-f]{16,}")
OWNER = "c2b5b12d55d341feb0940929e5a12c0d"


def prod_mix(top: int = 25) -> tuple[list[tuple[str, str, int]], dict[str, str]]:
    log = subprocess.run(["docker", "logs", "musix"], capture_output=True, text=True).stderr
    log += subprocess.run(["docker", "logs", "musix"], capture_output=True, text=True).stdout
    c: Counter[tuple[str, str]] = Counter()
    first = last = None
    for m in re.finditer(r'(\d\d:\d\d:\d\d)[^\n]*"(GET|POST) (/api/v1/[^ ?"]*)', log):
        first = first or m[1]
        last = m[1]
        c[(m[2], ID.sub("/{id}", m[3]))] += 1
    mix = [(meth, path, n) for (meth, path), n in c.most_common(top)
           if not path.startswith("/api/v1/playback/diagnostics")]
    started = subprocess.run(["docker", "inspect", "musix", "--format", "{{.State.StartedAt}}"],
                             capture_output=True, text=True).stdout.strip()
    return mix, {"log_since": started, "first": first or "", "last": last or ""}


def fill(path: str, ids: list[str], covers: list[str]) -> str:
    if path.startswith("/api/v1/covers/"):  # covers are addressed by their file name, not a track id
        return "/api/v1/covers/" + random.choice(covers)
    return path.replace("{id}", random.choice(ids))


def params_for(path: str, ids: list[str], st: str) -> dict[str, str] | None:
    """The query parameters the real client sends, so the probe hits the real code path."""
    if path.endswith("/stream"):
        return {"st": st}
    if path.endswith("/taste-signal/state"):
        return {"track_ids": ",".join(random.sample(ids, 3))}
    if path.endswith("/stream/next"):
        return {"session_id": f"bench-{random.randrange(20)}", "n": "3"}
    return None


async def user(client: httpx.AsyncClient, mix: list[tuple[str, str, int]], ids: list[str], covers: list[str],
               st: str, deadline: float, lat: dict[str, list[float]], errors: Counter[str],
               client_err: Counter[str]) -> None:
    weights = [n for *_, n in mix]
    while time.monotonic() < deadline:
        meth, path, _ = random.choices(mix, weights)[0]
        url = fill(path, ids, covers)
        params = params_for(path, ids, st)
        headers = {"Range": "bytes=0-262143"} if path.endswith("/stream") else None
        body = {"query": "love", "mode": "text", "limit": 10} if meth == "POST" and path.startswith("/api/v1/search") else {}
        t0 = time.perf_counter()
        try:
            r = await client.request(meth, url, params=params, headers=headers, json=body if meth == "POST" else None)
            if r.status_code >= 500:
                errors[path] += 1
            elif r.status_code >= 400:  # a probe without the params the real client sends
                client_err[path] += 1
        except httpx.HTTPError:
            errors[path] += 1
        lat[path].append((time.perf_counter() - t0) * 1000)


def pct(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p / 100 * len(xs)))] if xs else float("nan")


async def run(minutes: float, snap: Path) -> dict[str, object]:
    mix, window = prod_mix()
    token = v1_tokens()[OWNER]
    db = sqlite3.connect(f"file:{snap / 'metadata.db'}?mode=ro", uri=True)
    ids = [r[0] for r in db.execute("select track_id from track_metadata where collection_name=?", (f"acct_{OWNER}",))]
    covers = [r[0].rsplit("/", 1)[-1] for r in db.execute(
        "select distinct cover_art_path from track_metadata where collection_name=? and cover_art_path like '/covers/%'",
        (f"acct_{OWNER}",))]
    out: dict[str, object] = {"mix": [{"method": m, "path": p, "weight": n} for m, p, n in mix], "window": window, "levels": {}}
    async with httpx.AsyncClient(base_url=V1_URL, timeout=60, headers={"Authorization": f"Bearer {token}"}) as client:
        st = (await client.post("/api/v1/auth/stream-token")).json().get("token", "")
        for users in (1, 5, 20):
            lat: dict[str, list[float]] = defaultdict(list)
            errors: Counter[str] = Counter()
            client_err: Counter[str] = Counter()
            deadline = time.monotonic() + minutes * 60
            await asyncio.gather(*(user(client, mix, ids, covers, st, deadline, lat, errors, client_err) for _ in range(users)))
            alls = [x for v in lat.values() for x in v]
            out["levels"][users] = {  # type: ignore[index]
                "requests": len(alls), "errors": sum(errors.values()),
                "all": {"p50": pct(alls, 50), "p95": pct(alls, 95), "p99": pct(alls, 99)},
                "routes": {p: {"n": len(v), "p50": pct(v, 50), "p95": pct(v, 95), "p99": pct(v, 99),
                               "share_4xx": client_err[p] / len(v)}
                           for p, v in sorted(lat.items())}}
            print(f"{users} users: {len(alls)} requests, p95 {pct(alls, 95):.0f} ms", flush=True)
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("snapshot")
    ap.add_argument("--minutes", type=float, default=5)
    a = ap.parse_args()
    res = asyncio.run(run(a.minutes, Path(a.snapshot)))
    Path(sys.argv[0]).with_name(".run").mkdir(exist_ok=True)
    (Path(__file__).with_name(".run") / "http.json").write_text(json.dumps(res, indent=1))
