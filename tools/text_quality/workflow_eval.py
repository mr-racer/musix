"""Measure cache reuse with alternating writer and editor requests, not batches."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
import urllib.request
from pathlib import Path

import penalty_eval as pe


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=4)
    parser.add_argument("--base-url", default="http://192.168.0.168:8082/v1")
    parser.add_argument("--model", default=pe.DEFAULT_MODEL)
    parser.add_argument("--stop-at", required=True)
    args = parser.parse_args()
    deadline = dt.datetime.fromisoformat(args.stop_at)
    if deadline.tzinfo is None:
        raise SystemExit("The deadline needs an explicit time zone")
    sys.path.insert(0, str(pe.SERVER))
    from musix.knowledge import prose_repair

    cases = [c for c in json.loads(args.cases.read_text())["cases"] if c["kind"] == "fact"][
        : args.limit
    ]
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    args.out.mkdir(parents=True, exist_ok=True)
    with (args.out / "responses.jsonl").open("w", buffering=1) as output:
        for case in cases:
            draft = ""
            source = f"Artist: {case['artist']}\nSong: {case['title'] or ''}\n{case['source']}"
            names = tuple(n for n in (case["artist"], case["title"]) if n)
            for stage in ("writer", "editor"):
                left = (deadline - dt.datetime.now(dt.UTC)).total_seconds()
                if left < 5:
                    raise SystemExit("Stopped before the deadline")
                body = pe.request_body(
                    case,
                    args.model,
                    2111,
                    "repeat_penalty",
                    1.0,
                    {
                        **pe.FIXED_SAMPLING,
                        "repeat_penalty": 1.0,
                        "presence_penalty": 1.5,
                    },
                )
                if stage == "editor":
                    if not draft:
                        break
                    body.update(
                        messages=[
                            {
                                "role": "user",
                                "content": prose_repair.prompt(
                                    draft,
                                    source,
                                    names=names,
                                    max_chars=case["max_chars"],
                                ),
                            }
                        ],
                        temperature=0.1,
                        presence_penalty=0.0,
                        max_tokens=1024,
                        response_format=prose_repair.RESPONSE_FORMAT,
                    )
                start = time.monotonic()
                response = pe.post(
                    opener,
                    args.base_url,
                    "/v1/chat/completions",
                    body,
                    timeout=min(left, 180),
                )
                raw = response["choices"][0]["message"].get("content") or ""
                if stage == "writer":
                    draft, _ = pe.extract_text("fact", raw)
                result = {
                    "stage": stage,
                    "case_id": case["id"],
                    "request_hash": pe.digest(body),
                    "seconds": round(time.monotonic() - start, 3),
                    "response": response,
                }
                output.write(json.dumps(result, ensure_ascii=False) + "\n")
                usage = response.get("usage", {})
                print(
                    json.dumps(
                        {
                            "stage": stage,
                            "case": case["id"],
                            "seconds": result["seconds"],
                            "prompt_tokens": usage.get("prompt_tokens"),
                            "cached_tokens": usage.get("prompt_tokens_details", {}).get(
                                "cached_tokens"
                            ),
                        }
                    ),
                    flush=True,
                )


if __name__ == "__main__":
    main()
