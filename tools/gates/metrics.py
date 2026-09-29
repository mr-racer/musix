"""Gate metrics. Pure functions over (fixture, results)."""

from __future__ import annotations

from collections import defaultdict
from typing import Any


def tie_aware(target: str, hits: list[list[Any]]) -> tuple[float, float] | None:
    """(expected recall@1, expected reciprocal rank) of the target among scored hits, with
    ties split evenly: a target tied with one other hit for the top counts 0.5 at @1."""
    score = next((s for t, s in hits if t == target), None)
    if score is None:
        return None
    above = sum(1 for _, s in hits if s > score)
    tied = sum(1 for _, s in hits if s == score)  # includes the target
    r1 = 1 / tied if above == 0 else 0.0
    rr = sum(1 / (above + i) for i in range(1, tied + 1)) / tied
    return r1, rr


def lyric_metrics(queries: list[dict[str, Any]], results: list[list[list[Any]]]) -> dict[str, dict[str, float]]:
    by: dict[str, list[tuple[float, float] | None]] = defaultdict(list)
    for q, hits in zip(queries, results, strict=True):
        by[q["kind"]].append(tie_aware(q["track"], hits))
    return {k: {"n": len(r), "recall@1": sum(x[0] for x in r if x) / len(r),
                "recall@10": sum(x is not None for x in r) / len(r),
                "mrr": sum(x[1] for x in r if x) / len(r)} for k, r in sorted(by.items())}


def catalog_hit(q: dict[str, Any], hit: dict[str, Any]) -> bool:
    if q["want_kind"] == "song":
        return hit.get("type") == "song" and hit.get("track_id") == q["want"]
    field = "album" if q["want_kind"] == "album" else "artist"
    return hit.get("type") == q["want_kind"] and (hit.get(field) or "").casefold() == q["want"].casefold()


def catalog_metrics(queries: list[dict[str, Any]], results: list[list[dict[str, Any]]]) -> dict[str, dict[str, float]]:
    by: dict[str, list[int | None]] = defaultdict(list)
    for q, hits in zip(queries, results, strict=True):
        rank = next((i + 1 for i, h in enumerate(hits) if catalog_hit(q, h)), None)
        by[q["kind"]].append(rank)
        by["all"].append(rank)
    return {k: {"n": len(r), "recall@1": sum(x == 1 for x in r) / len(r),
                "recall@5": sum(x is not None and x <= 5 for x in r) / len(r)} for k, r in sorted(by.items())}


def ids(hits: list[list[Any]]) -> list[str]:
    return [h[0] for h in hits]


def sound_metrics(prompts: list[dict[str, Any]], results_scored: list[list[list[Any]]],
                  baseline_scored: list[list[list[Any]]] | None) -> dict[str, float]:
    results = [ids(h) for h in results_scored]
    baseline = [ids(h) for h in baseline_scored] if baseline_scored is not None else None
    prec = [len(set(h[:10]) & set(p["relevant"])) / 10 for p, h in zip(prompts, results, strict=True)]
    out = {"n": float(len(prompts)), "precision@10": sum(prec) / len(prec)}
    if baseline is not None:
        jac = [len(set(a[:10]) & set(b[:10])) / max(1, len(set(a[:10]) | set(b[:10])))
               for a, b in zip(results, baseline, strict=True)]
        out["overlap@10_vs_v1"] = sum(jac) / len(jac)
    return out


def mean_and_spread(runs: list[dict[str, dict[str, float]]]) -> dict[str, dict[str, Any]]:
    """Per kind: the mean of each metric over repeated runs, plus its range (max − min)."""
    out: dict[str, dict[str, Any]] = {}
    for kind in runs[0]:
        keys = [k for k in runs[0][kind] if k != "n"]
        out[kind] = {"n": runs[0][kind]["n"], "runs": len(runs),
                     **{k: sum(r[kind][k] for r in runs) / len(runs) for k in keys},
                     "spread": {k: max(r[kind][k] for r in runs) - min(r[kind][k] for r in runs) for k in keys}}
    return out
