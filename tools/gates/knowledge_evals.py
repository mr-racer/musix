"""Gate 4.5 on v2's code: the facts_v2 classifier on the 55 labelled facts and the bio
prompt on the 10 fixed passages — v1's `scripts/eval_facts_prompts.py` and
`scripts/eval_bio_prompt.py`, same data, same scoring (copied below), with v2's copies
of the prompts and pipeline and v2's LLM client. Equal to v1 = the port kept the logic.

Usage (from v2/server; the LLM is the instance's — here the same llama-server v1 used):
    uv run python ../tools/gates/knowledge_evals.py --base-url http://192.168.0.168:8082/v1 \
        --model qwen3.8-27b-ud-iq3_s --out ../tools/gates/report/<date>-v2-knowledge.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
from pathlib import Path

from musix.infra import db
from musix.infra.llm import Llm
from musix.assistant.bio_v2 import prompts as BP
from musix.knowledge import text_quality as tq
from musix.knowledge.facts_v2 import pipeline as fv2
from musix.settings import Settings

DATA = Path(__file__).parent / "data"


def verdict(labels: list, gold) -> tuple:
    """(что случилось, верно ли) для одного факта.

    Решает не метка, а исход: показан факт или нет. Off-scope метка ничего не
    пишет, поэтому «about_artist» — это скрытие, а не показ.
    """
    shown = fv2.route(labels)["primary"] is not None
    if gold == "other":
        return ("скрыт" if not shown else "ПОКАЗАН"), not shown
    if isinstance(gold, list) and set(gold) & fv2.OFF_SCOPE:
        ok = not shown and bool(set(labels) & set(gold))
        return ("off-scope" if ok else "не off-scope"), ok
    if not shown:
        return "ПОТЕРЯН", False
    hit = bool(set(labels) & set(gold))
    return ("верный класс" if hit else f"класс {','.join(labels) or '—'}"), hit


def score(items, runs: list) -> dict:
    """Свести N прогонов в отчёт. Факт считается верным, если верен в большинстве."""
    per_id = {it["id"]: it for it in items}
    merged = {}
    for run in runs:
        for row in run:
            merged.setdefault(row["id"], []).append(row)

    buckets = {"отбраковка": [0, 0], "сохранность": [0, 0],
               "класс": [0, 0], "off-scope": [0, 0]}
    misses, details = [], []
    for fid, rows in merged.items():
        it = per_id[fid]
        oks = [verdict(r["labels"], it["gold"])[1] for r in rows]
        ok = sum(oks) * 2 >= len(oks)                    # большинство прогонов
        note, _ = verdict(rows[0]["labels"], it["gold"])
        if it["gold"] == "other":
            key = "отбраковка"
        elif isinstance(it["gold"], list) and set(it["gold"]) & fv2.OFF_SCOPE:
            key = "off-scope"
        else:
            key = "сохранность"
        buckets[key][1] += 1
        buckets[key][0] += ok
        if key == "сохранность" and ok:
            buckets["класс"][1] += 1
            buckets["класс"][0] += 1
        elif key == "сохранность":
            buckets["класс"][1] += 1
        details.append({"id": fid, "gold": it["gold"], "got": rows[0]["labels"],
                        "ok": ok, "note": note, "why": it["why"],
                        "refined": rows[0].get("refined", "")})
        if not ok:
            misses.append(details[-1] | {"fact": it["fact"][:220],
                                         "was": it["was"]})
    return {"buckets": buckets, "misses": misses, "details": details}



async def facts(llm: Llm) -> dict:
    async def ask(prompt: str, temperature: float = 0.3) -> str:
        return await llm.ask(prompt, kind="eval:facts", temperature=temperature, cache=False)

    items = json.loads((DATA / "facts_gold.json").read_text(encoding="utf-8"))
    run = []
    for it in items:  # one fact per call, as v1's eval (see its docstring)
        entity = {"artist": it["artist"], "title": it["title"] or ""} if it["scope"] == "song" else {"name": it["artist"]}
        recs = await fv2.classify_entity(ask, entity, it["scope"], [{"id": 0, "fact": it["fact"], "category": it["category"]}])
        run.append({"id": it["id"], "labels": (recs[0] if recs else {"labels": []}).get("labels", [])})
    report = score(items, [run])
    return {"buckets": report["buckets"], "misses": [m["id"] for m in report["misses"]]}


async def bio(llm: Llm) -> dict:
    rows = json.loads((DATA / "bio_passages.json").read_text(encoding="utf-8"))
    out = []
    for row in rows:
        text = (await llm.ask(BP.BIO_PROMPT.format(artist=row["artist"], lang="Russian", passages=row["passages"]),
                              kind="eval:bio", temperature=0.35, cache=False) or "").strip()
        out.append({"artist": row["artist"], "empty": tq.is_refusal(text), "wrong_lang": tq.no_target_script(text, "ru"),
                    "chars": len(text)})
    return {"n": len(out), "empty": sum(r["empty"] for r in out), "wrong_lang": sum(r["wrong_lang"] for r in out),
            "median_chars": statistics.median(r["chars"] for r in out)}


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--db", default="postgresql://musix:musix@127.0.0.1:18432/musix_snap")
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    sm = db.make_sessionmaker(db.make_engine(Settings(database_url=a.db)))
    llm = Llm(sm, None, a.base_url, a.model)
    try:
        res = {"model": a.model, "facts": await facts(llm), "bio": await bio(llm)}
    finally:
        await llm.close()
    b = res["facts"]["buckets"]
    res["facts"]["rates"] = {k: (v[0] / v[1] if v[1] else None) for k, v in b.items()}
    print(json.dumps({"facts": res["facts"]["rates"], "bio": res["bio"]}, ensure_ascii=False, indent=1))
    if a.out:
        a.out.write_text(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    asyncio.run(main())
