"""Phase 0 exit: the v1 baseline report (numbers only) from the gates, the «Поток»
harness and the benches → docs/superpowers/specs/<date>-v2-baseline-report.md.
Usage: python baseline_report.py <snapshot date>
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
snap = sys.argv[1]
g = json.loads((HERE / "gates" / "report" / f"{snap}-v1.json").read_text())
r = json.loads((HERE / "recsys-eval" / "report" / f"{snap}.json").read_text())
b = json.loads((HERE / "bench" / "report" / f"{snap}.json").read_text())
OWNER, FRIEND = "owner", "friend"

L = [f"# MusiX v2 — baseline report (v1 on snapshot {snap})", "",
     "**Phase 0 exit criteria 1–2.** These are the v1 numbers every later phase is compared with",
     "(phase 0 spec §4–§5). They come from a v1 copy on the snapshot, never from prod. The",
     "report holds numbers only: no rows, titles or lyrics.", "",
     "## Search gates (4.1–4.3)", "",
     "Lyric-line search (the queries are derived from each track's own stored lyrics):", "",
     "| kind | n | recall@1 | recall@10 | MRR |", "|---|---|---|---|---|"]
L += [f"| {k} | {v['n']} | {v['recall@1']:.3f} | {v['recall@10']:.3f} | {v['mrr']:.3f} |" for k, v in g["lyrics"].items()]
s = g["sound"]
L += ["", f"Sound search: {int(s['n'])} prompts (genres, decades, sonic-axis poles), precision@10 "
      f"**{s['precision@10']:.3f}**. v2's overlap@10 is measured against these lists.", "",
      "Catalog search:", "", "| kind | n | recall@1 | recall@5 |", "|---|---|---|---|"]
L += [f"| {k} | {v['n']} | {v['recall@1']:.3f} | {v['recall@5']:.3f} |" for k, v in g["catalog"].items()]
ev = g.get("evals", {})
L += ["", "## Prompt evals (4.5)", "", "```", json.dumps(ev, indent=1, ensure_ascii=False), "```"]
e1, e2, e3, e4 = r["e1"], r["e2"], r["e3"], r["e4"]
L += ["", "## «Поток» (4.4, stream spec §2 / §10)", "",
      f"- E1, session GAUC (completed vs skipped): the v1 score gets **{e1['v1_score'][OWNER]['gauc']:.3f}** "
      f"({e1['v1_score'][OWNER]['ci90']}) on the owner; the reference ranker gets "
      f"**{e1['ranker'][OWNER + '/all']['gauc']:.3f}** ({e1['ranker'][OWNER + '/all']['ci90']}), and "
      f"{e1['ranker'][OWNER + '/stream']['gauc']:.3f} on «Поток» plays.",
      f"- E2, the merged candidate set contains the self-chosen next track "
      f"{e2[OWNER]['merged_set']['chosen']:.1%} of the time (random 500: "
      f"{e2[OWNER]['merged_set']['random500_chosen']:.1%}) and a never-played next track "
      f"{e2[OWNER]['merged_set']['never_played']:.1%} of the time (random: "
      f"{e2[OWNER]['merged_set']['random500_never_played']:.1%}).",
      f"- E3, CLAP energy axis vs the owner's {e3['n']} blind labels: AUC calm ↔ energetic "
      f"**{e3['clap_energy_axis']['auc_calm_vs_energetic']:.3f}**, Spearman {e3['clap_energy_axis']['spearman']:.3f}; "
      f"a linear probe on CLAP (CV) gets {e3['clap_linear_probe_cv']['spearman']:.3f}.", ""]
L += ["| E4, per 10 tracks | real v1 (logged) | reference engine (simulated) |", "|---|---|---|"]
rv, rp = e4[OWNER]["real_v1"], e4[OWNER]["reference_policy"]
for k in ("артистов/10", "жанров/10", "топ-жанр/10", "непрослушанных", "повторы за день"):
    L.append(f"| {k} | {rv[k]:.3f} | {rp[k]:.3f} |")
L += ["", f"The listener model's calibration on real v1 plays: it predicted {rv['listener_predicted']:.3f} "
      f"not-skipped, and {rv['actual_not_skipped']:.3f} happened. Invariants of the reference engine: "
      f"{e4[OWNER]['invariants']} (owner), {e4[FRIEND]['invariants']} (friend).", "",
      "Gates: " + ", ".join(f"{'PASS' if ok else 'FAIL'} {k}" for k, ok in r["gates"].items()), "",
      "## Performance (§5, v1 copy, CPU)", "", "| users | requests | errors | p50 ms | p95 ms | p99 ms |",
      "|---|---|---|---|---|---|"]
for u, lv in b["http"]["levels"].items():
    a = lv["all"]
    L.append(f"| {u} | {lv['requests']} | {lv['errors']} | {a['p50']:.0f} | {a['p95']:.0f} | {a['p99']:.0f} |")
h, c = b["browser"]["home"], b["browser"]["cold_start"]
L += ["", f"- Home screen: {h['requests']} requests, {h['bytes'] / 1e6:.2f} MB to network idle.",
      f"- Cold start: DOMContentLoaded {c['dcl_ms']:.0f} ms, FCP {c['fcp_ms']:.0f} ms.",
      f"- Stream start (FLAC): {b['browser']['stream_start_lan_ms']['median']:.0f} ms on the LAN, "
      f"{b['browser']['stream_start_lte_ms']['median']:.0f} ms under the LTE profile.",
      f"- Footprint: RSS max {b['rss_mib']['max']} MiB; VRAM {b['vram']}. Android: {b['android']}.", "",
      "Notes:", ""] + [f"- {n}" for n in b["notes"]]
L += ["", "## Findings that shape v2", "",
      "- **v1 search is not thread-safe.** Concurrent `/search/` requests race in `qdrant_client`'s",
      "  BM25 embedder (`dictionary changed size during iteration` → HTTP 500), and afterwards the",
      "  process silently returns wrong lyric results until it restarts (exact R@1 0.47 → 0.10).",
      "  v2 never shares non-thread-safe encoders across request threads; the `ml` service owns them.",
      "- **Lyric gate tolerance.** Queried sequentially on a fresh copy, three v1 runs agree within",
      "  0.003, and ranks are tie-aware (RRF scores tie often). The v2 gate is v2 ≥ v1 − max(0.01,",
      "  v1's run-to-run range).",
      "- **LLM evals move between runs** (facts отбраковка 1.00 vs 0.93 on two runs of the same",
      "  prompt): they are a reference, and a port may not change the prompts, not a hard gate.",
      "- **v1 hot spots under load** (5 users, p50 / p95): `/recommend/stream/next` 647 / 952 ms (the",
      "  stateless recompute the program replaces), `/recommend/taste-vibe` 458 / 757,",
      "  `/recommend/profile` 390 / 491, `/library/albums` 535 / 885. p99 at 20 users is 5.4 s.",
      "- **Stream start under LTE is 3.7 s** for FLAC; phase 1's tiers (AAC 320 on cellular) and",
      "  the signed-manifest prefetch target < 2 s."]
out = HERE.parents[1] / "docs" / "superpowers" / "specs" / f"{snap}-v2-baseline-report.md"
out.write_text("\n".join(L) + "\n")
print(out)
