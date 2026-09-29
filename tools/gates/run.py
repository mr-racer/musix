"""`make gates TARGET=v1 SNAP=<date>`: search gates 4.1–4.3, the prompt evals 4.5 and
the migration scaffold 4.6 → tools/gates/report/<date>-<target>.{md,json}.
Numbers only in the report; fixtures and raw results stay next to the snapshot.
Results are cached per (target, suite, collection, query): a re-run on the same
snapshot is instant and must give identical numbers (`--no-cache` re-asks).
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
from pathlib import Path
from typing import Any

import fixtures
import metrics
from drivers import V1Driver, V2Driver

ROOT = Path("/mnt/data/musix-snapshots")
REPORT = Path(__file__).parent / "report"


class Cache:
    def __init__(self, path: Path, enabled: bool) -> None:
        self.path, self.enabled = path, enabled
        self.data: dict[str, Any] = json.loads(path.read_text()) if enabled and path.exists() else {}

    def get(self, key: str, fn: Any) -> Any:
        if key not in self.data:
            self.data[key] = fn()
        return self.data[key]

    def save(self) -> None:
        self.path.write_text(json.dumps(self.data, ensure_ascii=False))


def ask(cache: Cache, suite: str, items: list[dict[str, Any]], fn: Any) -> list[Any]:
    def one(it: dict[str, Any]) -> Any:
        return cache.get(f"{suite}|{it['coll']}|{it['q']}", lambda: fn(it["coll"], it["q"]))
    # Sequential: v1's search is not thread-safe (qdrant_client's BM25 embedder batch
    # accumulator races: "dictionary changed size during iteration" → HTTP 500).
    out = [one(it) for it in items]
    cache.save()
    return out


def copy_exec(*cmd: str, timeout: int = 3600) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["docker", "exec", "musix-v1copy", *cmd], capture_output=True, text=True,
                          timeout=timeout)


def prompt_evals() -> dict[str, Any]:
    """4.5 — the v1 eval scripts, run inside the copy so they use the snapshot's
    instance settings (LLM endpoint and model). Skipped, not failed, without an LLM."""
    out: dict[str, Any] = {}
    r = copy_exec("python", "scripts/eval_facts_prompts.py", "--out", "/work/gates/facts.json")
    if r.returncode == 0:
        facts = json.loads(Path(WORK / "gates" / "facts.json").read_text())
        out["facts"] = {k: (v[0] / v[1] if v[1] else None) for k, v in facts["buckets"].items()}
    else:
        out["facts"] = f"skipped: {r.stderr.strip().splitlines()[-1][:160] if r.stderr.strip() else r.returncode}"
    r = copy_exec("python", "scripts/eval_bio_prompt.py", "--out", "/work/gates/bio.json")
    if r.returncode == 0:
        bio = json.loads(Path(WORK / "gates" / "bio.json").read_text())
        rows = bio["rows"]
        chars = sorted(x["chars"] for x in rows)
        out["llm_model"] = bio["model"]
        out["bio"] = {"n": len(rows), "empty": sum(x["empty"] for x in rows),
                      "wrong_lang": sum(x["wrong_lang"] for x in rows), "median_chars": chars[len(chars) // 2]}
    else:
        out["bio"] = f"skipped: {r.stderr.strip().splitlines()[-1][:160] if r.stderr.strip() else r.returncode}"
    r = subprocess.run(["docker", "exec", "-e", "MUSIX_LIVE_STACK=1", "musix-v1copy", "python", "-m", "pytest",
                        "-q", "-s", "-p", "no:cacheprovider", "tests/docker/test_assistant_routing.py"],
                       capture_output=True, text=True, timeout=3600)
    lines = [ln for ln in r.stdout.splitlines() if "accuracy" in ln.lower() or " passed" in ln or " failed" in ln]
    out["routing"] = {"exit": r.returncode, "lines": lines[-8:]}
    return out


def migration_scaffold(snap: Path) -> dict[str, Any]:
    """4.6 — v1 entity counts; phase 3 adds the v2 side and the checksums."""
    db = sqlite3.connect(f"file:{snap / 'metadata.db'}?mode=ro", uri=True)
    tables = [r[0] for r in db.execute("select name from sqlite_master where type='table' order by 1")]
    counts = {t: db.execute(f'select count(*) from "{t}"').fetchone()[0] for t in tables}  # noqa: S608
    q = json.loads((snap / "qdrant" / "collections.json").read_text())
    return {"sqlite": counts, "qdrant": {role(k): v["points_count"] for k, v in q.items()},
            "v2": "pending phase 3"}


ROLES = {"acct_c2b5b12d55d341feb0940929e5a12c0d": "owner", "acct_55804614d9c247e7961a8f76b57178ad": "friend"}


def role(coll: str) -> str:
    """The report is committed: accounts appear as roles, never as ids."""
    if coll in ROLES or not coll.startswith("acct_"):
        return ROLES.get(coll, coll)
    return f"member-{sorted(c for c in MEMBERS if c not in ROLES).index(coll) + 1}"


MEMBERS: list[str] = []


def write_report(snap: Path, target: str, res: dict[str, Any]) -> Path:
    REPORT.mkdir(exist_ok=True)
    base = REPORT / f"{snap.name}-{target}"
    base.with_suffix(".json").write_text(json.dumps(res, indent=2, ensure_ascii=False))
    md = [f"# Gates — {target} on snapshot {snap.name}", "",
          "## 4.1 Lyric-line search", "", "| kind | n | recall@1 | recall@10 | MRR |", "|---|---|---|---|---|"]
    md += [f"| {k} | {v['n']} | {v['recall@1']:.3f} ± {v['spread']['recall@1']:.3f} | "
           f"{v['recall@10']:.3f} ± {v['spread']['recall@10']:.3f} | {v['mrr']:.3f} ± {v['spread']['mrr']:.3f} |"
           for k, v in res["lyrics"].items()]
    md += ["", "Mean of the runs; ± is the run-to-run range (max − min). v1's lyric search is not",
           "deterministic, so the v2 gate tolerance is max(0.01, this range)."]
    s = res["sound"]
    md += ["", "## 4.2 Sound search", "", f"prompts {int(s['n'])}, precision@10 {s['precision@10']:.3f}"
           + (f", overlap@10 vs v1 {s['overlap@10_vs_v1']:.3f}" if "overlap@10_vs_v1" in s else "")]
    md += ["", "## 4.3 Catalog search", "", "| kind | n | recall@1 | recall@5 |", "|---|---|---|---|"]
    md += [f"| {k} | {v['n']} | {v['recall@1']:.3f} | {v['recall@5']:.3f} |" for k, v in res["catalog"].items()]
    md += ["", "## 4.5 Prompt evals (v1 scripts)", "", "```", json.dumps(res.get("evals", "not run"),
           indent=1, ensure_ascii=False), "```", "", "## 4.6 Migration scaffold (v1 counts)", "", "```",
           json.dumps(res["migration"], indent=1), "```"]
    base.with_suffix(".md").write_text("\n".join(md) + "\n")
    return base.with_suffix(".md")


def main() -> None:
    global WORK
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["v1", "v2"], default="v1")
    ap.add_argument("--snap", required=True)
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--skip-evals", action="store_true")
    ap.add_argument("--runs", type=int, default=3, help="lyric-suite repetitions")
    a = ap.parse_args()
    snap = ROOT / a.snap
    WORK = snap / "work"
    (WORK / "gates").mkdir(parents=True, exist_ok=True)
    fx = fixtures.build(snap)
    MEMBERS[:] = sorted(json.loads((snap / "qdrant" / "collections.json").read_text()))
    drv = V1Driver() if a.target == "v1" else V2Driver()
    # v1's sound lists as they stood BEFORE this run: with --no-cache the overlap is a
    # real determinism check instead of comparing a run with itself.
    base_path = snap / "gates" / "results-v1.json"
    base = json.loads(base_path.read_text()) if base_path.exists() else None
    cache = Cache(snap / "gates" / f"results-{a.target}.json", enabled=not a.no_cache)
    # v1 lyric search is not deterministic run to run (RRF + prefetch cut-offs over tied
    # scores), so the lyric suite runs RUNS times and reports the mean and the spread.
    lyr_runs = [ask(cache, f"lyrics-scored#{k}", fx["lyrics"], drv.lyrics) for k in range(a.runs)]
    snd = ask(cache, "sound-scored", fx["sound"], drv.sound)
    cat = ask(cache, "catalog", fx["catalog"], drv.catalog)
    key = lambda p: f"sound-scored|{p['coll']}|{p['q']}"  # noqa: E731
    baseline = [base[key(p)] for p in fx["sound"]] if base and all(key(p) in base for p in fx["sound"]) else None
    res: dict[str, Any] = {"snapshot": snap.name, "target": a.target,
                           "lyrics": metrics.mean_and_spread([metrics.lyric_metrics(fx["lyrics"], x) for x in lyr_runs]),
                           "sound": metrics.sound_metrics(fx["sound"], snd, baseline),
                           "catalog": metrics.catalog_metrics(fx["catalog"], cat),
                           "migration": migration_scaffold(snap)}
    if not a.skip_evals and a.target == "v1":
        res["evals"] = prompt_evals()
    print(write_report(snap, a.target, res))


WORK = Path()

if __name__ == "__main__":
    main()
