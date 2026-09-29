"""`python -m recsys_eval <snapshot dir> [mood_labels.json]` → report/<date>.{md,json}.

E1 ranking, E2 retrieval, E3 sound, E4 whole-session simulation + hard invariants,
checked against the gates of the stream spec §10. The v1 baseline is the logged
v1 sessions themselves; the reference ranker + policy stands in for the v2 engine
until phase 2 replaces it.
"""

import json
import sys
from pathlib import Path

from . import data as D
from .e1 import run_e1
from .e2 import run_e2
from .e3 import run_e3
from .e4 import run_e4

LABELS = Path("/mnt/data/musix-snapshots/labels/mood_labels.json")
REPORT = Path(__file__).resolve().parents[1] / "report"


def gates(r):
    o = r["e4"][D.OWNER[:9]]["reference_policy"]  # gates run before the id → role rename
    inv = {k: v for lib in r["e4"].values() for k, v in lib["invariants"].items() if v}
    return {k: bool(v) for k, v in {
        "E1 ranker GAUC ≥ 0.70 (owner, all)": r["e1"]["ranker"][f"{D.OWNER[:9]}/all"]["gauc"] >= 0.70,
        "E3 CLAP axis AUC ≥ 0.95": r["e3"]["clap_energy_axis"]["auc_calm_vs_energetic"] >= 0.95,
        "E4 top genre / 10 ≤ 0.50": o["топ-жанр/10"] <= 0.50,
        "E4 genres / 10 ≥ 3.0": o["жанров/10"] >= 3.0,
        "E4 artists / 10 ≥ 8.0": o["артистов/10"] >= 8.0,
        "invariants: 0 violations": not inv,
    }.items()}


def main() -> None:
    snap = Path(sys.argv[1])
    labels = Path(sys.argv[2]) if len(sys.argv) > 2 else LABELS
    D.use(snap)
    r = {"snapshot": snap.name, "e1": run_e1(), "e2": run_e2(), "e3": run_e3(labels), "e4": run_e4()}
    r["gates"] = gates(r)
    REPORT.mkdir(exist_ok=True)
    out = REPORT / f"{snap.name}.json"
    # The report is committed: accounts appear as roles, never as ids.
    text = json.dumps(r, indent=2, ensure_ascii=False, default=float)
    for acct, role in ((D.OWNER[:9], "owner"), (D.FRIEND[:9], "friend")):
        text = text.replace(acct, role)
    r = json.loads(text)
    out.write_text(text)
    md = [f"# «Поток» harness — snapshot {snap.name}", "", "## Gates (stream spec §10)", ""]
    md += [f"- {'PASS' if ok else 'FAIL'} — {name}" for name, ok in r["gates"].items()]
    for k in ("e1", "e2", "e3", "e4"):
        md += ["", f"## {k.upper()}", "", "```json", json.dumps(r[k], indent=1, ensure_ascii=False, default=float), "```"]
    out.with_suffix(".md").write_text("\n".join(md) + "\n")
    print(out.with_suffix(".md"))
    print(json.dumps(r["gates"], indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
