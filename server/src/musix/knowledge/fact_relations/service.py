"""Producer credits from a song's raw facts: one LLM call per fact that talks about producing.

Production uses the producer leg only. Sampling links belong to the facts_v2 pipeline
(``ai_tasks/refined_facts._store_links``), which labels a fact before reading it.

GLiNER2 used to pre-mark candidate names in each fact before the LLM read it. The owner
removed it for good on 2026-10-01, for two reasons:
- the 3090 has no room for it next to llama-server;
- on the CPU it cost the assistant seconds per page.
The prompt already told the model to "trust the sentence meaning, not the markers".

A fact that never says "produc…" cannot credit a producer (rule 5 of the prompt), so it
is not sent. Nothing here raises: a failing LLM or a bad reply skips that fact.
"""

import logging
import re

from .llm_re import build_llm_messages, merge_results, parse_llm_re

logger = logging.getLogger(__name__)

_PRODUCING = re.compile(r"produc", re.I)


def song_producers(facts, title, artist, ask_llm_fn):
    """Every producer the facts explicitly credit, deduplicated by normalized name.

    ``ask_llm_fn(messages) -> dict | str | None`` is called once per producing fact.
    """
    merged = {"producers": [], "links": []}
    for fact in facts or []:
        if not _PRODUCING.search(fact or ""):
            continue
        try:
            raw = ask_llm_fn(build_llm_messages(title, artist, fact))
        except Exception as e:
            logger.warning("[fact_relations] LLM call failed: %s", e)
            continue
        parsed = parse_llm_re(raw) if raw is not None else None
        if parsed:
            merged = merge_results(merged, {"producers": parsed["producers"], "links": []})
    return merged["producers"]
