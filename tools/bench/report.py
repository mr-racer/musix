"""Assemble tools/bench/report/<date>.{md,json} from .run/ (numbers only)."""

import json
import re
import sys
from pathlib import Path

run = Path(__file__).with_name(".run")
snap, minutes = sys.argv[1], sys.argv[2]
http = json.loads((run / "http.json").read_text())
browser = json.loads((run / "browser.json").read_text())
# `docker stats` MemUsage is "5.4GiB / 30.5GiB": only the first number is the usage
rss = [float(m[1]) * (1024 if m[2].startswith("G") else 1) for m in
       (re.match(r"([\d.]+)(\w+)", ln.split("/")[0].strip()) for ln in (run / "rss.txt").read_text().splitlines()) if m]
android = (run / "android.txt").read_text().strip()
rep = {"snapshot": snap, "minutes_per_level": float(minutes), "http": http, "browser": browser,
       "rss_mib": {"max": max(rss) if rss else None, "samples": len(rss)}, "vram": "0 (FORCE_CPU=1)",
       "android": android if android == "attached" else "deferred to phase 4 (phone not on the LAN)",
       "notes": ["the v1 copy runs FORCE_CPU=1: model-bound routes (search) are CPU, not comparable to prod",
                 "the transcode cache is cold (empty); prod's is warm",
                 f"request mix from the prod access log since {http['window']['log_since']}"]}
out = Path(__file__).with_name("report") / snap
out.with_suffix(".json").write_text(json.dumps(rep, indent=1))
md = [f"# v1 performance baselines — snapshot {snap}", "", "## HTTP (v1 copy, CPU)", "",
      "| users | requests | errors | p50 ms | p95 ms | p99 ms |", "|---|---|---|---|---|---|"]
for u, lv in http["levels"].items():
    a = lv["all"]
    md.append(f"| {u} | {lv['requests']} | {lv['errors']} | {a['p50']:.0f} | {a['p95']:.0f} | {a['p99']:.0f} |")
md += ["", "Per route at 5 users (p50 / p95 ms):", ""]
md += [f"- `{p}`: {v['p50']:.0f} / {v['p95']:.0f} (n={v['n']})"
       + (f" — **{v['share_4xx']:.0%} 4xx: probed without the client's params, not a latency number**"
          if v.get("share_4xx", 0) > 0.5 else "")
       for p, v in http["levels"]["5"]["routes"].items()]
h, c = browser["home"], browser["cold_start"]
md += ["", "## Browser (phone 412×915)", "",
       f"- Home: {h['requests']} requests, {h['bytes'] / 1e6:.2f} MB to network idle ({h['to_network_idle_ms']:.0f} ms)",
       f"- Cold start: DOMContentLoaded {c['dcl_ms']:.0f} ms, FCP {c['fcp_ms']:.0f} ms, load {c['load_ms']:.0f} ms",
       f"- Stream start (FLAC, synthetic <audio>): LAN median {browser['stream_start_lan_ms']['median']:.0f} ms, "
       f"LTE median {browser['stream_start_lte_ms']['median']:.0f} ms",
       "", f"## Footprint", "", f"- RSS max {rep['rss_mib']['max']} MiB; VRAM {rep['vram']}",
       "", f"## Android", "", f"- {rep['android']}", "", "## Notes", ""] + [f"- {n}" for n in rep["notes"]]
out.with_suffix(".md").write_text("\n".join(md) + "\n")
print(out.with_suffix(".md"))
