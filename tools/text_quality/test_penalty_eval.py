"""Checks that protect the experiment's comparisons and result accounting."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from penalty_eval import FIXED_SAMPLING, diagnostics, request_body, summarize


class ComparisonValidity(unittest.TestCase):
    def test_matched_requests_differ_only_in_the_parameter_under_test(self) -> None:
        case = {
            "messages": [{"role": "user", "content": "An identical prompt prefix."}],
            "temperature": 0.3,
            "max_tokens": 512,
        }
        before = json.dumps(case, sort_keys=True)
        a = request_body(case, "test-model", 42, "repeat_penalty", 1.0, FIXED_SAMPLING)
        b = request_body(case, "test-model", 42, "repeat_penalty", 1.1, FIXED_SAMPLING)
        self.assertEqual({key for key in a if a[key] != b[key]}, {"repeat_penalty"})
        self.assertTrue(a["cache_prompt"])
        self.assertEqual(a["presence_penalty"], 1.5)
        self.assertEqual(before, json.dumps(case, sort_keys=True))

    def test_an_explicit_skip_is_counted_separately_from_a_broken_reply(self) -> None:
        case = {"kind": "vibe", "max_chars": 160}
        skip = diagnostics(case, '{"best":null}', "stop")
        self.assertEqual(skip["flags"], ["skip"])
        broken = diagnostics(case, '{"best":"M1","line":"unfinished', "length")
        self.assertIn("invalid_json", broken["flags"])
        self.assertIn("incomplete", broken["flags"])

    def test_resumed_failures_do_not_inflate_observation_counts(self) -> None:
        with tempfile.TemporaryDirectory() as name:
            path = Path(name)
            cases = path / "cases.json"
            cases.write_text(json.dumps({"cases": [{"id": "a", "source": "source"}]}))
            failed = {"request_id": "one", "value": 1.0, "error": "timeout"}
            success = {
                "request_id": "one",
                "kind": "fact",
                "value": 1.0,
                "case_id": "a",
                "seed": 42,
                "text": "Текст",
                "flags": [],
                "seconds": 1.0,
                "response": {
                    "timings": {"cache_n": 9},
                    "usage": {"prompt_tokens": 10, "completion_tokens": 2},
                },
            }
            (path / "responses.jsonl").write_text(
                json.dumps(failed) + "\n" + json.dumps(success) + "\n"
            )
            summarize(path, cases)
            summary = json.loads((path / "summary.json").read_text())
            self.assertEqual(summary["1.0"]["n"], 1)
            self.assertEqual(summary["1.0"]["cached_prompt_fraction"], 0.9)


if __name__ == "__main__":
    unittest.main()
