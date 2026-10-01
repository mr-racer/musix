"""Ingest wall-clock on the dev stack (CPU ml): scan one real folder the dev DB has never
seen into a fresh account, and time it until every file is indexed (lyrics online, CLAP
audio + chunks, dense text, axes — all intelligence but the LLM enrichment, spec §9).

Usage (from server/): uv run python ../tools/bench/v2/ingest.py "/mnt/data/music/Music/<folder>" --out f.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
import time
import uuid
from pathlib import Path

import httpx

API = "http://127.0.0.1:18000/api/v2"
OWNER = {"email": "owner@example.com", "password": "owner-pass-123"}
DEVICE = {"name": "bench-ingest", "platform": "android"}


def psql(q: str) -> list[str]:
    out = subprocess.check_output(["docker", "exec", "musix-v2-dev-postgres-1", "psql", "-U", "musix", "-d", "musix", "-Atc", q])
    return [x for x in out.decode().split("\n") if x]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    owner = httpx.post(f"{API}/auth/login", json={**OWNER, "device": DEVICE}, timeout=30).json()
    h = {"Authorization": f"Bearer {owner['accessToken']}"}
    code = httpx.post(f"{API}/invites", headers=h).json()["code"]
    email = f"ingest-{uuid.uuid4().hex[:6]}@example.com"
    tok = httpx.post(f"{API}/auth/register", json={"email": email, "password": "bench-pass-123", "inviteCode": code, "device": DEVICE}, timeout=30).json()
    acct = tok["accountId"]
    folder = a.folder.replace("'", "''")
    t0 = time.monotonic()
    r = httpx.post(f"{API}/library/scan", json={"path": a.folder, "accountId": acct}, headers=h, timeout=30)
    r.raise_for_status()
    seen = {}
    while True:
        rows = psql(
            f"select mf.intel_state || '|' || mf.state from media_files mf join tracks t on t.media_file_id = mf.id "
            f"where t.account_id = '{acct}' and mf.path like '{folder}%'"
        )
        states = [x.split("|") for x in rows]
        n = len(states)
        done = sum(s[0] in ("indexed", "failed") for s in states)
        el = round(time.monotonic() - t0)
        if n and "registered" not in seen:
            seen["registered_first"] = el
        if n and done == n and el > 5:
            seen["indexed_all"] = el
            break
        if el > 3600:
            break
        time.sleep(5)
    files = len(states)
    failed = sum(s[0] == "failed" for s in states)
    res = {"folder_files": files, "failed": failed, "wall_s": seen.get("indexed_all"), "per_file_s": round((seen.get("indexed_all") or 0) / max(files, 1), 2),
           "extrapolated_6k_h": round((seen.get("indexed_all") or 0) / max(files, 1) * 6000 / 3600, 1)}
    print(json.dumps(res))
    if a.out:
        a.out.write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
