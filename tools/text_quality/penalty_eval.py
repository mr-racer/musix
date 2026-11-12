"""Evaluate one sampler parameter at a time against frozen, single-text cases.

Use ``prepare --help`` and ``run --help`` for the two stages. Corpus files and
responses belong outside the repository. Requests bypass the application and its
database cache; only llama-server's prompt KV cache is used. No repair calls or
automatic retries are made. Diagnostic flags are not factuality scores.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import html
import importlib.util
import json
import math
import random
import re
import shutil
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "server/src"
DEFAULT_MODEL = "qwen3.8-27b-ud-q3_k_xl"
FIXED_SAMPLING = {
    "top_p": 0.8,
    "top_k": 20,
    "min_p": 0.0,
    "repeat_last_n": 64,
    "frequency_penalty": 0.0,
    "repeat_penalty": 1.0,
    "presence_penalty": 1.5,
}


def digest(value: Any) -> str:
    blob = json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(blob).hexdigest()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def prepare(a: argparse.Namespace) -> None:
    sys.path.insert(0, str(SERVER))
    from musix.assistant.bio_v2 import prompts as bp
    from musix.knowledge import sonic_vibe as sv
    from musix.knowledge.facts_v2 import pipeline as fv2
    from musix.knowledge.facts_v2 import prompts as fp

    rows = [x for x in read_jsonl(a.audit / "facts.jsonl") if x.get("model")]
    by_id = {x["id"]: x for x in rows}
    hard_ids = json.loads(a.challenge_ids.read_text()) if a.challenge_ids else []
    hard = [by_id[i] for i in hard_ids if i in by_id][: a.fact_count]
    remaining = [x for x in rows if x["id"] not in hard_ids]
    random.Random(a.sample_seed).shuffle(remaining)
    chosen = hard + remaining[: max(0, a.fact_count - len(hard))]
    cases = []
    for row in chosen:
        plan = fv2.route(row["labels"])
        if not plan["primary"]:
            continue
        source = fv2.for_refine({"fact": row["raw"], "category": row["category"]})
        cap = max(fp.MAX_CHARS.get(k, 220) for k in plan["focus"])
        subject = (
            fp.SONG_SUBJECT.format(lang="Russian")
            if row["subject_kind"] == "song"
            else fp.ARTIST_SUBJECT
        )
        prompt = fp.REFINE.format(
            subject=subject,
            focus="\n\n".join(fp.FOCUS[k] for k in plan["focus"]),
            lang="Russian",
            shots=fp.SHOTS[plan["primary"]],
            max_chars=cap,
            name_rule=f'- The artist is written exactly "{row["artist"]}". Copy that spelling.',
            fact=source,
        )
        cases.append(
            {
                "id": f"fact:{row['id']}",
                "kind": "fact",
                "stratum": "known_failure" if row["id"] in hard_ids else "random",
                "artist": row["artist"],
                "title": row["title"],
                "source": source,
                "stored_text": row["text"],
                "max_chars": cap,
                "temperature": 0.3,
                "max_tokens": 512,
                "messages": [{"role": "user", "content": prompt}],
            }
        )

    # A single source isolates wording from the separate fact-selection problem.
    songs = [x for x in chosen if x["subject_kind"] == "song"][: a.vibe_count]
    for row in songs:
        window = sv._build_fact_window([{"fact": row["raw"], "category": row["category"]}])
        if not window:
            continue
        user = sv._build_user_prompt(
            tags=[],
            payload={"artist": row["artist"], "title": row["title"]},
            window=window,
            lang="ru",
        )
        cases.append(
            {
                "id": f"vibe:{row['id']}",
                "kind": "vibe",
                "stratum": "single_source",
                "artist": row["artist"],
                "title": row["title"],
                "source": window[0]["text"],
                "max_chars": sv.MAX_PHRASE_CHARS,
                "temperature": 0.7,
                "max_tokens": 256,
                "messages": [
                    {
                        "role": "system",
                        "content": sv._SYSTEM_PROMPT.format(lang_name="Russian"),
                    },
                    {"role": "user", "content": user},
                ],
            }
        )

    fixtures = json.loads((ROOT / "tools/gates/data/bio_passages.json").read_text())
    for row in fixtures[: a.bio_count]:
        cases.append(
            {
                "id": f"bio:{row['artist']}",
                "kind": "bio",
                "stratum": "fixed_passages",
                "artist": row["artist"],
                "title": None,
                "source": row["passages"],
                "max_chars": None,
                "temperature": 0.35,
                "max_tokens": 1536,
                "messages": [
                    {
                        "role": "user",
                        "content": bp.BIO_PROMPT.format(
                            artist=row["artist"],
                            lang="Russian",
                            passages=row["passages"],
                        ),
                    }
                ],
            }
        )
    for case in cases:
        case["prompt_hash"] = digest(case["messages"])
    payload = {
        "prepared_at": dt.datetime.now(dt.UTC).isoformat(),
        "sample_seed": a.sample_seed,
        "challenge_ids": hard_ids,
        "cases": cases,
        "limitations": [
            "Known failures are deliberately oversampled; this is not a prevalence estimate.",
            "Vibe cases have one source; selection among ten facts is not evaluated.",
            "Bio fixtures are fixed old passages, not a fresh retrieval evaluation.",
            "Existing prompts and raw first outputs are tested without downstream repairs.",
        ],
    }
    a.out.parent.mkdir(parents=True, exist_ok=True)
    write_json(a.out, payload)
    print(
        json.dumps(
            {
                "cases": len(cases),
                "kinds": dict(collections.Counter(c["kind"] for c in cases)),
                "path": str(a.out),
            },
            ensure_ascii=False,
        )
    )


def prepare_editor(a: argparse.Namespace) -> None:
    """Reuse the live assistant's exact editor prefix on one stored fact per call."""
    path = a.runtime / "musix/assistant/prompts.py"
    spec = importlib.util.spec_from_file_location("live_editor_prompts", path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"Cannot load editor prompts from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    system = module.EDIT_SYSTEM.format(lang="Russian")
    dataset = json.loads(a.cases.read_text())
    cases = []
    for row in dataset["cases"]:
        if row["kind"] != "fact":
            continue
        material = f"Artist: {row['artist']}\n"
        if row["title"]:
            material += f"Song: {row['title']}\n"
        material += f"Source note:\n{row['source']}"
        case = {
            **row,
            "id": f"edit:{row['id']}",
            "kind": "editor",
            "draft": row["stored_text"],
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": f"MATERIAL:\n{material}\n\n"
                    f"DRAFT:\n{row['stored_text']}\n\nFOLLOW-UPS: []",
                },
            ],
        }
        case["prompt_hash"] = digest(case["messages"])
        cases.append(case)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    write_json(
        a.out,
        {
            "prepared_at": dt.datetime.now(dt.UTC).isoformat(),
            "editor_prefix_hash": digest(system),
            "cases": cases,
            "limitations": [
                "Each request edits exactly one stored fact against its original source note.",
                "The existing production editor prompt is reused unchanged, with no new examples.",
                "Only an offline prototype: results never enter the application or its database.",
            ],
        },
    )
    print(
        json.dumps(
            {
                "cases": len(cases),
                "editor_prefix_hash": digest(system),
                "path": str(a.out),
            },
            ensure_ascii=False,
        )
    )


def prepare_patches(a: argparse.Namespace) -> None:
    sys.path.insert(0, str(SERVER))
    from musix.knowledge.text_edits import (
        PATCH_SYSTEM,
        SLOTTED_PATCH_SYSTEM,
        mask_names,
    )

    dataset = json.loads(a.cases.read_text())
    cases = []
    system = SLOTTED_PATCH_SYSTEM if a.mask_names else PATCH_SYSTEM
    for row in dataset["cases"]:
        if row["kind"] != "fact":
            continue
        material = f"Artist: {row['artist']}\nSong: {row['title'] or ''}\n{row['source']}"
        case = {
            **row,
            "id": f"patch:{row['id']}",
            "kind": "patch",
            "draft": row["stored_text"],
            "guard_source": material,
            "protected_names": [x for x in (row["artist"], row["title"]) if x],
            "temperature": 0.1,
            "max_tokens": 512,
            "messages": [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": f"SOURCE:\n{material}\n\nDRAFT:\n{row['stored_text']}",
                },
            ],
        }
        if a.mask_names:
            masked = mask_names(case["draft"], material, tuple(case["protected_names"]))
            case["name_slots"] = masked.slots
            case["messages"][1]["content"] = f"SOURCE:\n{masked.source}\n\nDRAFT:\n{masked.draft}"
        case["prompt_hash"] = digest(case["messages"])
        cases.append(case)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    write_json(
        a.out,
        {
            "prepared_at": dt.datetime.now(dt.UTC).isoformat(),
            "editor_prefix_hash": digest(system),
            "cases": cases,
            "limitations": [
                "One text and its source per request; no retries or automatic second pass.",
                "The guard checks structure, protected spellings and numeric anchors, "
                "not semantic truth.",
                "A rejected patch keeps the original text. This is not deployed to an application.",
            ],
        },
    )
    print(json.dumps({"cases": len(cases), "prefix_hash": digest(system)}, ensure_ascii=False))


def prepare_repair(a: argparse.Namespace) -> None:
    sys.path.insert(0, str(SERVER))
    from musix.knowledge.prose_repair import REPAIR_SYSTEM, RESPONSE_FORMAT, prompt

    dataset = json.loads(a.cases.read_text())
    cases = []
    for row in dataset["cases"]:
        if row["kind"] != "fact":
            continue
        material = f"Artist: {row['artist']}\nSong: {row['title'] or ''}\n{row['source']}"
        names = tuple(x for x in (row["artist"], row["title"]) if x)
        surface = row.get("surface", "fact")
        case = {
            **row,
            "id": f"repair:{row['id']}",
            "kind": "repair",
            "draft": row["stored_text"],
            "guard_source": material,
            "protected_names": names,
            "temperature": 0.1,
            "max_tokens": 2048 if surface == "bio" else 1024,
            "request_options": {"response_format": RESPONSE_FORMAT},
            "messages": [
                {
                    "role": "user",
                    "content": prompt(
                        row["stored_text"],
                        material,
                        names=names,
                        max_chars=row["max_chars"],
                        surface=surface,
                    ),
                }
            ],
        }
        case["prompt_hash"] = digest(case["messages"])
        cases.append(case)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    write_json(
        a.out,
        {
            "prepared_at": dt.datetime.now(dt.UTC).isoformat(),
            "prefix_hash": digest(REPAIR_SYSTEM),
            "cases": cases,
        },
    )
    print(json.dumps({"cases": len(cases), "prefix_hash": digest(REPAIR_SYSTEM)}))


def post(
    opener: Any, base: str, path: str, body: dict[str, Any], *, timeout: float = 180
) -> dict[str, Any]:
    request = urllib.request.Request(
        base.rstrip("/").removesuffix("/v1") + path,
        data=json.dumps(body, ensure_ascii=False).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer lm-studio",
        },
    )
    with opener.open(request, timeout=timeout) as response:
        return json.load(response)


def request_body(
    case: dict[str, Any],
    model: str,
    seed: int,
    parameter: str,
    value: float,
    fixed: dict[str, Any],
) -> dict[str, Any]:
    return {
        "model": model,
        "messages": case["messages"],
        **fixed,
        parameter: value,
        "temperature": case["temperature"],
        "seed": seed,
        "max_tokens": case["max_tokens"],
        "cache_prompt": True,
        "stream": False,
        "chat_template_kwargs": {"enable_thinking": False},
        **case.get("request_options", {}),
    }


def extract_text(kind: str, raw: str) -> tuple[str, list[str]]:
    if kind == "bio":
        return raw.strip(), []
    clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    try:
        obj = json.loads(clean)
    except json.JSONDecodeError:
        return raw, ["invalid_json"]
    if not isinstance(obj, dict):
        return raw, ["invalid_shape"]
    if kind == "vibe" and obj.get("best") is None:
        return "", ["skip"]
    key = "line" if kind == "vibe" else "text"
    if not isinstance(obj.get(key), str):
        return raw, ["invalid_shape"]
    if kind == "vibe" and obj.get("best") != "M1":
        return obj[key], ["unknown_source_key"]
    return obj[key].strip(), []


def diagnostics(case: dict[str, Any], raw: str, finish_reason: str) -> dict[str, Any]:
    patch = None
    repair = None
    if case["kind"] in {"repair", "evidence"}:
        if str(SERVER) not in sys.path:
            sys.path.insert(0, str(SERVER))
        from musix.knowledge.prose_repair import parse_reply

        if case["kind"] == "evidence":
            from evidence_editor import parse

            result = parse(raw, case)
        else:
            result = parse_reply(
                raw,
                case["draft"],
                source=case["guard_source"],
                names=tuple(case["protected_names"]),
                max_chars=case["max_chars"],
            )
        text = result.text if finish_reason == "stop" else case["draft"]
        repair = {"status": result.status, "reason": result.reason}
        flags = ["repair_rejected"] if result.status == "rejected" else []
    elif case["kind"] == "patch":
        if str(SERVER) not in sys.path:
            sys.path.insert(0, str(SERVER))
        from musix.knowledge.text_edits import apply_edits, restore_name_edits

        text, flags = case["draft"], []
        patch = {"accepted": False, "reason": "incomplete", "applied": 0}
        if finish_reason == "stop":
            clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
            try:
                obj = json.loads(clean)
            except json.JSONDecodeError:
                flags.append("invalid_json")
                patch["reason"] = "invalid_json"
            else:
                proposed = obj.get("edits") if isinstance(obj, dict) else None
                slot_error = None
                if case.get("name_slots"):
                    proposed, slot_error = restore_name_edits(proposed, case["name_slots"])
                result = apply_edits(
                    text,
                    proposed,
                    source=case["guard_source"],
                    protected_names=tuple(case["protected_names"]),
                    max_chars=case["max_chars"],
                )
                text = result.text
                patch = {
                    "accepted": result.accepted,
                    "reason": result.reason,
                    "applied": result.applied,
                }
                if slot_error:
                    patch["reason"] = slot_error
        if not patch["accepted"]:
            flags.append("patch_rejected")
    else:
        text, flags = extract_text(case["kind"], raw)
    if finish_reason != "stop":
        flags.append("incomplete")
    if text and not re.search("[А-Яа-яЁё]", text):
        flags.append("no_russian")
    if not text and "skip" not in flags:
        flags.append("empty")
    mixed = sorted(
        {
            word
            for word in re.findall("[A-Za-zА-Яа-яЁё]+", text)
            if re.search("[A-Za-z]", word) and re.search("[А-Яа-яЁё]", word)
        }
    )
    if mixed:
        flags.append("mixed_script")
    if re.search(r"</?think>|\bNO_DATA\b|\bSKIP\b|^Why:|^MATERIAL:|^DRAFT:", text, re.M):
        flags.append("service_text")
    if case.get("max_chars") and len(text) > case["max_chars"]:
        flags.append("over_length")
    words = re.findall(r"[\w'-]+", text.casefold())
    grams = collections.Counter(tuple(words[i : i + 5]) for i in range(max(0, len(words) - 4)))
    repeats = [" ".join(k) for k, n in grams.items() if n > 1]
    if repeats:
        flags.append("repeated_5gram")
    result = {
        "text": text,
        "flags": flags,
        "mixed_words": mixed,
        "repeated_5grams": repeats,
    }
    if patch is not None:
        result["patch"] = patch
    if repair is not None:
        result["repair"] = repair
    return result


def run(a: argparse.Namespace) -> None:
    deadline = dt.datetime.fromisoformat(a.stop_at) if a.stop_at else None
    if deadline is not None and deadline.tzinfo is None:
        raise SystemExit("The deadline needs an explicit time zone")

    def remaining() -> float:
        seconds = (deadline - dt.datetime.now(dt.UTC)).total_seconds() if deadline else 180
        if seconds < 5:
            raise SystemExit("Stopped before the configured deadline; responses are resumable.")
        return min(180, seconds)

    dataset = json.loads(a.cases.read_text())
    cases = dataset["cases"]
    fixed = {
        **FIXED_SAMPLING,
        "repeat_penalty": a.repeat_penalty,
        "presence_penalty": a.presence_penalty,
    }
    spec = {
        "cases_hash": digest(cases),
        "model": a.model,
        "parameter": a.parameter,
        "values": a.values,
        "seeds": a.seeds,
        "fixed": fixed,
        "base_url": a.base_url,
    }
    if any(c["kind"] == "patch" for c in cases):
        spec["validator_sha256"] = hashlib.sha256(
            (SERVER / "musix/knowledge/text_edits.py").read_bytes()
        ).hexdigest()
    if any(c["kind"] == "repair" for c in cases):
        spec["validator_sha256"] = hashlib.sha256(
            (SERVER / "musix/knowledge/prose_repair.py").read_bytes()
        ).hexdigest()
    validator_files = [
        SERVER / "musix/knowledge" / name
        for name in ("text_quality.py", "text_edits.py", "prose_repair.py")
        if (SERVER / "musix/knowledge" / name).exists()
    ]
    if any(c["kind"] == "evidence" for c in cases):
        validator_files.append(Path(__file__).with_name("evidence_editor.py"))
    if any(c.get("editor_variant") == "language_only" for c in cases):
        validator_files.append(Path(__file__).with_name("language_editor.py"))
    spec["validator_dependencies"] = {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in validator_files
    }
    spec_hash = digest(spec)
    a.out.mkdir(parents=True, exist_ok=True)
    manifest_path = a.out / "manifest.json"
    if manifest_path.exists() and json.loads(manifest_path.read_text())["spec_hash"] != spec_hash:
        raise SystemExit("Output directory belongs to another experiment; choose a new directory.")
    code_snapshot = a.out / "validator_code"
    code_snapshot.mkdir(exist_ok=True)
    for path in validator_files:
        shutil.copy2(path, code_snapshot / path.name)
    write_json(
        manifest_path,
        {
            "spec_hash": spec_hash,
            "spec": spec,
            "started_at": dt.datetime.now(dt.UTC).isoformat(),
        },
    )
    responses = a.out / "responses.jsonl"
    previous = read_jsonl(responses) if responses.exists() else []
    done = {r["request_id"] for r in previous if not r.get("error")}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    # The native endpoint echoes effective sampler values; validate each arm once.
    probes_path = a.out / "sampler_probes.json"
    probes = []
    for value in a.values:
        probe = post(
            opener,
            a.base_url,
            "/completion",
            {
                **fixed,
                a.parameter: value,
                "prompt": "Return OK.",
                "n_predict": 1,
                "seed": a.seeds[0],
                "cache_prompt": True,
            },
            timeout=remaining(),
        )
        params = probe["generation_settings"]
        for key, expected in {**fixed, a.parameter: value}.items():
            if not math.isclose(params[key], expected, abs_tol=1e-6):
                raise SystemExit(f"Server ignored {key}: expected {expected}, got {params[key]}")
        probes.append({"value": value, "effective": params})
    write_json(probes_path, probes)

    total = len(cases) * len(a.seeds) * len(a.values)
    n = 0
    with responses.open("a", buffering=1) as output:
        for index, case in enumerate(cases):
            for seed in a.seeds:
                values = list(a.values)
                random.Random(f"{index}:{seed}").shuffle(values)
                for value in values:
                    n += 1
                    body = request_body(case, a.model, seed, a.parameter, value, fixed)
                    request_id = digest({"spec_hash": spec_hash, "case": case["id"], "body": body})
                    if request_id in done:
                        continue
                    result = {
                        "request_id": request_id,
                        "case_id": case["id"],
                        "kind": case["kind"],
                        "stratum": case["stratum"],
                        "seed": seed,
                        "value": value,
                        "request_hash": digest(body),
                    }
                    start = time.monotonic()
                    try:
                        response = post(
                            opener,
                            a.base_url,
                            "/v1/chat/completions",
                            body,
                            timeout=remaining(),
                        )
                        choice = response["choices"][0]
                        raw = choice["message"].get("content") or ""
                        result.update(
                            response=response,
                            **diagnostics(case, raw, choice["finish_reason"]),
                        )
                    except (
                        urllib.error.URLError,
                        TimeoutError,
                        KeyError,
                        ValueError,
                    ) as error:
                        result["error"] = f"{type(error).__name__}: {error}"
                    result["seconds"] = round(time.monotonic() - start, 3)
                    output.write(json.dumps(result, ensure_ascii=False) + "\n")
                    print(
                        json.dumps(
                            {
                                "n": n,
                                "total": total,
                                "case": case["id"],
                                "value": value,
                                "seed": seed,
                                "seconds": result["seconds"],
                                "flags": result.get("flags", []),
                                "error": result.get("error"),
                            },
                            ensure_ascii=False,
                        ),
                        flush=True,
                    )
                    if result.get("error"):
                        raise SystemExit("Request failed. Saved the error; no automatic retry.")
    summarize(a.out, a.cases)


def summarize(directory: Path, cases_path: Path) -> None:
    rows = read_jsonl(directory / "responses.jsonl")
    # Resuming must not count a prior failed attempt as an extra observation.
    unique = {r["request_id"]: r for r in rows}
    rows = list(unique.values())
    summary = {}
    for value in sorted({r["value"] for r in rows}):
        group = [r for r in rows if r["value"] == value and not r.get("error")]
        cache = [r["response"].get("timings", {}).get("cache_n", 0) for r in group]
        prompt = [r["response"].get("usage", {}).get("prompt_tokens", 0) for r in group]
        summary[str(value)] = {
            "n": len(group),
            "flags": dict(collections.Counter(flag for r in group for flag in r["flags"])),
            "median_seconds": statistics.median(r["seconds"] for r in group) if group else None,
            "completion_tokens": sum(
                r["response"].get("usage", {}).get("completion_tokens", 0) for r in group
            ),
            "cached_prompt_fraction": sum(cache) / max(1, sum(prompt)),
            "per_kind": {},
        }
        for kind in sorted({r["kind"] for r in group}):
            subset = [r for r in group if r["kind"] == kind]
            bad_contract = {
                "invalid_shape",
                "invalid_json",
                "unknown_source_key",
                "incomplete",
            }
            summary[str(value)]["per_kind"][kind] = {
                "n": len(subset),
                "broken_contract": sum(bool(set(r["flags"]) & bad_contract) for r in subset),
                "abstentions": sum("skip" in r["flags"] or r["text"] == "NO_DATA" for r in subset),
                "wrong_language_prose": sum(
                    "no_russian" in r["flags"]
                    and not (set(r["flags"]) & (bad_contract | {"service_text", "skip"}))
                    for r in subset
                ),
                "mixed_script": sum("mixed_script" in r["flags"] for r in subset),
                "over_length": sum("over_length" in r["flags"] for r in subset),
            }
    write_json(directory / "summary.json", summary)
    cases = {c["id"]: c for c in json.loads(cases_path.read_text())["cases"]}
    review = []
    for case_id in cases:
        group = [r for r in rows if r["case_id"] == case_id and not r.get("error")]
        for seed in sorted({r["seed"] for r in group}):
            variants = [r for r in group if r["seed"] == seed]
            random.Random(f"blind:{case_id}:{seed}").shuffle(variants)
            review.append(
                {
                    "case_id": case_id,
                    "seed": seed,
                    "source": cases[case_id]["source"],
                    "variants": [
                        {
                            "label": chr(65 + i),
                            "request_id": r["request_id"],
                            "text": r["text"],
                        }
                        for i, r in enumerate(variants)
                    ],
                }
            )
    write_json(directory / "blind_review.json", review)
    sections = []
    for row in review:
        variants = "".join(
            f"<article><b>{v['label']}</b><p>{html.escape(v['text'])}</p></article>"
            for v in row["variants"]
        )
        sections.append(
            f"<section><h2>{html.escape(row['case_id'])} · seed {row['seed']}</h2>"
            f"<details><summary>Исходный материал</summary><pre>"
            f"{html.escape(row['source'])}</pre></details><div>{variants}</div></section>"
        )
    (directory / "blind_review.html").write_text(
        '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Слепое сравнение</title>'
        "<style>body{font:17px/1.5 system-ui;margin:32px auto;max-width:1400px;padding:0 20px}"
        "section{border-bottom:1px solid #ccc;padding:16px 0}section>div{display:flex;gap:24px}"
        "article{flex:1;min-width:0}pre,p{white-space:pre-wrap;overflow-wrap:anywhere}"
        "@media(max-width:850px){section>div{display:block}}</style>"
        "<h1>Сравнение формулировок без указания параметра</h1>"
        "<p>Проверяйте смысл, русский язык и сохранность стиля по исходному материалу. "
        "Пустая строка означает отказ от выбора факта.</p>" + "".join(sections) + "</html>"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def revalidate(a: argparse.Namespace) -> None:
    """Recheck saved proposals without generating again or overwriting raw results."""
    cases = {c["id"]: c for c in json.loads(a.cases.read_text())["cases"]}
    version = hashlib.sha256((SERVER / "musix/knowledge/text_edits.py").read_bytes()).hexdigest()
    destination = a.out / "validated"
    destination.mkdir(exist_ok=True)
    with (destination / "responses.jsonl").open("w") as stream:
        for old in read_jsonl(a.out / "responses.jsonl"):
            if old.get("error"):
                continue
            choice = old["response"]["choices"][0]
            checked = diagnostics(
                cases[old["case_id"]],
                choice["message"].get("content") or "",
                choice["finish_reason"],
            )
            row = {
                **old,
                **checked,
                "validator_sha256": version,
                "previous_patch": old.get("patch"),
            }
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
    write_json(
        destination / "manifest.json",
        {
            "validator_sha256": version,
            "source_results": str(a.out / "responses.jsonl"),
            "new_model_calls": 0,
        },
    )
    summarize(destination, a.cases)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prep = sub.add_parser("prepare")
    prep.add_argument("--audit", type=Path, required=True)
    prep.add_argument("--out", type=Path, required=True)
    prep.add_argument("--challenge-ids", type=Path)
    prep.add_argument("--fact-count", type=int, default=24)
    prep.add_argument("--vibe-count", type=int, default=6)
    prep.add_argument("--bio-count", type=int, default=4)
    prep.add_argument("--sample-seed", type=int, default=20261111)
    prep.set_defaults(func=prepare)
    editor = sub.add_parser("prepare-editor")
    editor.add_argument("--runtime", type=Path, required=True)
    editor.add_argument("--cases", type=Path, required=True)
    editor.add_argument("--out", type=Path, required=True)
    editor.set_defaults(func=prepare_editor)
    patches = sub.add_parser("prepare-patches")
    patches.add_argument("--cases", type=Path, required=True)
    patches.add_argument("--out", type=Path, required=True)
    patches.add_argument("--mask-names", action="store_true")
    patches.set_defaults(func=prepare_patches)
    repairs = sub.add_parser("prepare-repair")
    repairs.add_argument("--cases", type=Path, required=True)
    repairs.add_argument("--out", type=Path, required=True)
    repairs.set_defaults(func=prepare_repair)
    trial = sub.add_parser("run")
    trial.add_argument("--cases", type=Path, required=True)
    trial.add_argument("--out", type=Path, required=True)
    trial.add_argument("--base-url", default="http://192.168.0.168:8082/v1")
    trial.add_argument("--model", default=DEFAULT_MODEL)
    trial.add_argument("--parameter", choices=("repeat_penalty", "presence_penalty"), required=True)
    trial.add_argument("--values", type=float, nargs="+", required=True)
    trial.add_argument("--seeds", type=int, nargs="+", default=[2111, 2811])
    trial.add_argument("--repeat-penalty", type=float, default=1.0)
    trial.add_argument("--presence-penalty", type=float, default=1.5)
    trial.add_argument("--stop-at", help="Absolute ISO 8601 deadline with an explicit UTC offset")
    trial.set_defaults(func=run)
    summary = sub.add_parser("summarize")
    summary.add_argument("--out", type=Path, required=True)
    summary.add_argument("--cases", type=Path, required=True)
    summary.set_defaults(func=lambda a: summarize(a.out, a.cases))
    validation = sub.add_parser("revalidate")
    validation.add_argument("--out", type=Path, required=True)
    validation.add_argument("--cases", type=Path, required=True)
    validation.set_defaults(func=revalidate)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
