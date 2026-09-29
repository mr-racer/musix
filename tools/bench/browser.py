"""Browser probes of the v1 COPY at phone size (412×915), in the system Chrome:
  - home: request count and bytes to first render (CDP encodedDataLength until network idle);
  - web cold start: navigation timing + first contentful paint;
  - stream start: a synthetic <audio> on the stream URL of a FLAC track → 'playing',
    over LAN and under an LTE profile (12 Mbit/s, 70 ms RTT). It measures server +
    network, not the SPA's click handling (ruling in the phase 0 ledger).
Usage (env /mnt/data/envs/musix-e2e): python browser.py <snapshot dir> <tokens.json>
"""

import json
import sqlite3
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:18800"
OWNER = "c2b5b12d55d341feb0940929e5a12c0d"
LTE = {"offline": False, "latency": 70, "downloadThroughput": 12e6 / 8, "uploadThroughput": 3e6 / 8}


def context(browser, token, theme="dark"):
    c = browser.new_context(viewport={"width": 412, "height": 915}, is_mobile=True, device_scale_factor=2)
    c.add_init_script(f"""
        localStorage.setItem('musix_token', {json.dumps(token)});
        localStorage.setItem('musix_user_role', 'owner');
        localStorage.setItem('musix_user_id', '{OWNER}');
        localStorage.setItem('musix_welcome_seen_{OWNER}', '1');
        localStorage.setItem('musix_guide_seen_{OWNER}', '1');
        localStorage.setItem('musix_lang', 'ru');
        localStorage.setItem('musix_theme', '{theme}');""")
    return c


def home_probe(browser, token):
    c = context(browser, token)
    page = c.new_page()
    cdp = c.new_cdp_session(page)
    cdp.send("Network.enable")
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
    stats = {"requests": 0, "bytes": 0}
    cdp.on("Network.loadingFinished", lambda e: stats.update(requests=stats["requests"] + 1,
                                                                  bytes=stats["bytes"] + e["encodedDataLength"]))
    last = {"t": time.perf_counter()}
    page.on("request", lambda _: last.update(t=time.perf_counter()))
    t0 = time.perf_counter()
    page.goto(BASE + "/", wait_until="load")
    # The SPA polls (llm-status, taste state), so "network idle" never comes: wait for
    # 1.5 s without a new request instead, at most 20 s.
    while time.perf_counter() - last["t"] < 1.5 and time.perf_counter() - t0 < 20:
        page.wait_for_timeout(100)
    stats["to_network_idle_ms"] = (last["t"] - t0) * 1000
    nav = page.evaluate("""() => { const n = performance.getEntriesByType('navigation')[0];
        const f = performance.getEntriesByName('first-contentful-paint')[0];
        return {dcl_ms: n.domContentLoadedEventEnd, load_ms: n.loadEventEnd, fcp_ms: f ? f.startTime : null}; }""")
    c.close()
    return stats, nav


def stream_probe(browser, token, st, track_id, lte):
    c = context(browser, token)
    page = c.new_page()
    page.goto(BASE + "/api/v1/instance/config")  # same origin, no SPA boot
    if lte:
        cdp = c.new_cdp_session(page)
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", LTE)
    ms = page.evaluate("""([url]) => new Promise((ok, bad) => {
        const a = new Audio(); const t0 = performance.now();
        a.addEventListener('playing', () => ok(performance.now() - t0), {once: true});
        a.addEventListener('error', () => bad('media error ' + (a.error && a.error.code)), {once: true});
        a.muted = true; a.src = url; a.play().catch(bad); })""",
        [f"{BASE}/api/v1/search/tracks/{track_id}/stream?st={st}"])
    c.close()
    return ms


def main():
    snap, tokens = Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text())
    token, st = tokens["token"], tokens["st"]
    db = sqlite3.connect(f"file:{snap / 'metadata.db'}?mode=ro", uri=True)
    flacs = [r[0] for r in db.execute("select track_id from track_metadata where collection_name=? "
                                      "and lower(file_path) like '%.flac' order by track_id limit 5", (f"acct_{OWNER}",))]
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True, args=["--autoplay-policy=no-user-gesture-required"])
        cold = [home_probe(b, token) for _ in range(3)]
        out["home"] = cold[-1][0]
        out["cold_start"] = {k: sorted(n[k] for _, n in cold if n[k] is not None)[1] for k in ("dcl_ms", "load_ms", "fcp_ms")}
        for name, lte in (("lan", False), ("lte", True)):
            xs = sorted(stream_probe(b, token, st, t, lte) for t in flacs)
            out[f"stream_start_{name}_ms"] = {"median": xs[len(xs) // 2], "max": xs[-1], "n": len(xs)}
        b.close()
    (Path(__file__).with_name(".run") / "browser.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
