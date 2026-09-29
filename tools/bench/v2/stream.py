"""Stream start for `high` (spec §10): a phone-sized Chrome page asks for a manifest, then
plays the signed URL through nginx; the time runs from the manifest request to the
<audio> 'playing' event. LAN, and the LTE profile (12 Mbit/s down, 70 ms RTT) through
CDP throttling, exactly as the v1 baseline measured it.
Usage (env /mnt/data/envs/musix-e2e): python stream.py [--runs 10] [--out f.json]
"""

import argparse
import json
import random
import statistics
import subprocess

import urllib.request
from playwright.sync_api import sync_playwright

EDGE = "http://127.0.0.1:18080"
API = "http://127.0.0.1:18000/api/v2"
LTE = {"offline": False, "latency": 70, "downloadThroughput": 12e6 / 8, "uploadThroughput": 3e6 / 8}
PLAY = """async ([token, trackId]) => {
    const t0 = performance.now();
    const r = await fetch('/api/v2/playback/manifest', {method: 'POST',
        headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
        body: JSON.stringify({trackIds: [trackId], network: 'cellular'})});
    const item = (await r.json()).items[0];
    return await new Promise((ok, bad) => {
        const a = new Audio();
        a.addEventListener('playing', () => ok({ms: performance.now() - t0, tier: item.tier,
            codec: item.codec}), {once: true});
        a.addEventListener('error', () => bad('media error ' + (a.error && a.error.code)), {once: true});
        a.muted = true; a.src = item.url; a.play().catch(bad);
    });
}"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=10)
    ap.add_argument("--out")
    args = ap.parse_args()
    body = {"email": "bench@example.com", "password": "bench-pass-123",
            "device": {"name": "bench-stream", "platform": "web"}}
    req = urllib.request.Request(f"{API}/auth/login", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    tok = json.load(urllib.request.urlopen(req))
    ids = subprocess.check_output(["docker", "exec", "musix-v2-dev-postgres-1", "psql", "-U", "musix", "-d",
        "musix", "-Atc", f"select id from tracks where account_id = '{tok['accountId']}'"]).decode().split()
    rnd = random.Random(3)
    out = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required"])
        for profile in ("lan", "lte"):
            times, tiers = [], set()
            for _ in range(args.runs):
                c = browser.new_context(viewport={"width": 412, "height": 915}, is_mobile=True)
                page = c.new_page()
                page.goto(EDGE + "/api/v2/health")  # same origin: the fetch needs no CORS
                if profile == "lte":
                    cdp = c.new_cdp_session(page)
                    cdp.send("Network.enable")
                    cdp.send("Network.emulateNetworkConditions", LTE)
                r = page.evaluate(PLAY, [tok["accessToken"], rnd.choice(ids)])
                times.append(r["ms"])
                tiers.add(f"{r['tier']}/{r['codec']}")
                c.close()
            out[profile] = {"median_ms": round(statistics.median(times)), "max_ms": round(max(times)),
                            "runs": len(times), "tiers": sorted(tiers)}
            print(profile, out[profile], flush=True)
        browser.close()
    if args.out:
        json.dump(out, open(args.out, "w"), indent=2)


if __name__ == "__main__":
    main()
