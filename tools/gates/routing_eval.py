"""Gate 4.5, routing, on v2's code: the 27 phrasings of v1's
`tests/docker/test_assistant_routing.py` through the assistant's PLANNER — the router
production actually runs (v1's `router.py`, which that test measured, is legacy and
not ported). The planner has no «ask» rung: every miss is a confident one.

Criteria (v1's floors): accuracy ≥ 0.75, confident wrong ≤ v1's rung + slack is not
applicable (the planner always answers), playlist ↔ facts confusions = 0.

Usage (from server/):
    uv run python ../tools/gates/routing_eval.py --base-url http://192.168.0.168:8082/v1 \\
        --model qwen3.8-27b-ud-iq3_s --out ../tools/gates/report/<date>-v2-routing.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from musix.assistant import compat
from musix.assistant.config import AgentConfig
from musix.assistant.llm import LLMClient
from musix.assistant.planner import Planner
from musix.infra import db
from musix.infra.llm import Llm
from musix.settings import Settings

DATA = Path(__file__).parent / "data" / "routing_cases.json"
FAMILY = {"lyrics_search": "search", "audio_search": "search", "playlist": "playlist", "general": "facts"}


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--db", default="postgresql://musix:musix@127.0.0.1:18432/musix_mig")
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    sm = db.make_sessionmaker(db.make_engine(Settings(database_url=a.db)))
    llm = Llm(sm, None, a.base_url, a.model)
    compat.set_llm(llm)
    cfg = AgentConfig(lang="ru")
    planner = Planner(LLMClient(cfg), cfg, None, audio_available=True)
    rows = []
    for case in json.loads(DATA.read_text(encoding="utf-8")):
        plan = await planner.plan(case["message"])
        got = FAMILY.get(plan.intent) if plan else None
        rows.append({**case, "intent": plan.intent if plan else None, "got": got, "ok": got == case["expected"]})
        print("." if got == case["expected"] else "x", end="", flush=True)
    print()
    await llm.close()
    n = len(rows)
    res = {
        "model": a.model,
        "n": n,
        "accuracy": sum(r["ok"] for r in rows) / n,
        "no_plan": sum(r["got"] is None for r in rows),
        "confident_wrong": sum(r["got"] is not None and not r["ok"] for r in rows),
        "playlist_facts_confused": sum({r["expected"], r["got"]} == {"playlist", "facts"} for r in rows),
        "misses": [f"{r['message']!r}: expected {r['expected']}, got {r['intent']}" for r in rows if not r["ok"]],
    }
    print(json.dumps(res, ensure_ascii=False, indent=1))
    if a.out:
        a.out.write_text(json.dumps({**res, "rows": rows}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    asyncio.run(main())
