"""Offline CPU diagnostics for frozen NLI/acceptability classifiers.

This does not load models in the application or set an automatic acceptance
threshold. Over-budget inputs are recorded, never silently truncated.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import time
from pathlib import Path


def main() -> None:
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    from transformers.utils import logging

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-manifest", type=Path, required=True)
    parser.add_argument("--pairs", type=Path, required=True)
    parser.add_argument("--mode", choices=("nli", "acceptability"), required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--stop-at", required=True)
    args = parser.parse_args()
    deadline = dt.datetime.fromisoformat(args.stop_at)
    if deadline.tzinfo is None:
        raise SystemExit("The deadline needs an explicit time zone")
    logging.set_verbosity_error()
    torch.set_num_threads(2)
    manifest = json.loads(args.model_manifest.read_text())
    tokenizer = AutoTokenizer.from_pretrained(manifest["path"], local_files_only=True)
    model = AutoModelForSequenceClassification.from_pretrained(
        manifest["path"],
        local_files_only=True,
        dtype=torch.float32,
    ).eval()
    labels = model.config.id2label
    rows = json.loads(args.pairs.read_text())["rows"]
    args.out.mkdir(parents=True, exist_ok=True)
    metadata = {
        **manifest,
        "labels": labels,
        "mode": args.mode,
        "max_tokens": 512,
        "truncation": False,
        "threads": 2,
    }
    (args.out / "model.json").write_text(json.dumps(metadata, indent=2) + "\n")
    cache = {}

    def score(first: str, second: str | None = None) -> dict:
        key = (first, second)
        if key in cache:
            return cache[key]
        encoded = tokenizer(first, second, return_tensors="pt", truncation=False)
        count = encoded.input_ids.shape[-1]
        if count > 512:
            result = {"skipped": "token_budget", "tokens": count}
        else:
            if (deadline - dt.datetime.now(dt.UTC)).total_seconds() < 10:
                raise SystemExit("Stopped before the deadline")
            with torch.inference_mode():
                probs = model(**encoded).logits.softmax(-1)[0].tolist()
            result = {
                "tokens": count,
                "probabilities": {labels[i]: round(p, 6) for i, p in enumerate(probs)},
            }
        cache[key] = result
        return result

    with (args.out / "scores.jsonl").open("w", buffering=1) as output:
        for index, row in enumerate(rows, 1):
            start = time.monotonic()
            if args.mode == "nli":
                scores = {
                    "source_before": score(row["source"], row["before"]),
                    "source_after": score(row["source"], row["after"]),
                    "before_after": score(row["before"], row["after"]),
                    "after_before": score(row["after"], row["before"]),
                }
            else:
                scores = {"before": score(row["before"]), "after": score(row["after"])}
            output.write(
                json.dumps(
                    {
                        **row,
                        "scores": scores,
                        "seconds": round(time.monotonic() - start, 3),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            if index % 20 == 0 or index == len(rows):
                print(
                    json.dumps({"completed": index, "total": len(rows), "mode": args.mode}),
                    flush=True,
                )


if __name__ == "__main__":
    main()
