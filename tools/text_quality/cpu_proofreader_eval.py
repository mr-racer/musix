"""Evaluate an explicitly supplied local seq2seq corrector on frozen texts.

Research only: no application imports, database writes or inference service.
Optional torch/transformers dependencies belong to a separate experiment env.
"""

from __future__ import annotations

import argparse
import datetime as dt
import difflib
import json
import time
from pathlib import Path


def main() -> None:
    import torch
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
    from transformers.utils import logging

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--model-path", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--stop-at", required=True)
    args = parser.parse_args()
    deadline = dt.datetime.fromisoformat(args.stop_at)
    if deadline.tzinfo is None:
        raise SystemExit("The deadline needs an explicit time zone")
    logging.set_verbosity_error()
    torch.set_num_threads(4)
    tokenizer = AutoTokenizer.from_pretrained(args.model_path, local_files_only=True)
    model = AutoModelForSeq2SeqLM.from_pretrained(args.model_path, local_files_only=True).eval()
    model.generation_config.max_length = None
    cases = json.loads(args.cases.read_text())["cases"]
    args.out.mkdir(parents=True, exist_ok=True)
    n = 0
    with (args.out / "responses.jsonl").open("w", buffering=1) as output:
        for row in cases:
            if (deadline - dt.datetime.now(dt.UTC)).total_seconds() < 30:
                break
            text = row["text"]
            encoded = tokenizer(text, return_tensors="pt", truncation=False)
            tokens = encoded.input_ids.shape[-1]
            result = dict(row)
            if tokens > 768:
                result.update(corrected=text, skipped="input_budget")
            else:
                start = time.monotonic()
                with torch.inference_mode():
                    generated = model.generate(
                        **encoded,
                        max_new_tokens=min(1024, tokens + 128),
                        do_sample=False,
                    )
                corrected = tokenizer.decode(
                    generated[0],
                    skip_special_tokens=True,
                    clean_up_tokenization_spaces=False,
                )
                edits = []
                for tag, i, j, k, end in difflib.SequenceMatcher(
                    None, text, corrected
                ).get_opcodes():
                    if tag != "equal":
                        edits.append({"from": text[i:j], "to": corrected[k:end], "offset": i})
                protected = [row.get("artist"), row.get("title")]
                result.update(
                    corrected=corrected,
                    seconds=round(time.monotonic() - start, 3),
                    edits=edits,
                    supplied_name_changed=any(
                        name and text.count(name) != corrected.count(name) for name in protected
                    ),
                )
            output.write(json.dumps(result, ensure_ascii=False) + "\n")
            n += 1
    print(json.dumps({"completed": n, "cases": len(cases)}))


if __name__ == "__main__":
    main()
