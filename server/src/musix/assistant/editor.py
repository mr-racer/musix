"""The editor pass: the same local model reads its own draft against the material.

The owner's rule for every text he reads (2026-10-18): a draft, then an editor that
drops claims the facts do not carry, fixes non-words and strips machine phrasing. The
quantised model writes «назвать коллекцию» for «назвать группу» and joins two facts into
a third; asked to list the problems first, it catches both (2026-10-23 tests: clean
drafts come back unchanged in ~1–2 s, broken ones are fixed in ~4–7 s).

Code never rewrites the text itself: a regex ban list threw good texts away and still
missed invented words (rejected by the owner, 2026-10-18)."""

from __future__ import annotations

import logging
from typing import Optional

from musix.assistant.llm import as_str, as_str_list

logger = logging.getLogger(__name__)


async def edit(
    llm, lang: str, material: str, draft: str, follow_ups: Optional[list] = None
) -> tuple:
    """``(text, follow_ups)``. The draft as it was when the editor fails; an empty text
    when the editor found nothing in it supported."""
    from musix.assistant.prompts import EDIT_SYSTEM

    follow_ups = list(follow_ups or [])
    if not (draft or "").strip():
        return draft, follow_ups
    name = "Russian" if (lang or "").lower().startswith("ru") else "English"
    import json

    raw = await llm.ask_json(
        [
            {"role": "system", "content": EDIT_SYSTEM.format(lang=name)},
            {
                "role": "user",
                "content": f"MATERIAL:\n{material}\n\nDRAFT:\n{draft}\n\n"
                f"FOLLOW-UPS: {json.dumps(follow_ups, ensure_ascii=False)}",
            },
        ],
        required=("text",),
        temperature=0.1,
    )
    if not raw:
        return draft, follow_ups
    text = as_str(raw.get("text"), 4000).strip()
    issues = as_str_list(raw.get("issues"), limit=8, item_limit=200)
    if issues:
        logger.info("[editor] %d fix(es): %s", len(issues), " | ".join(issues))
    if len(text) > len(draft) * 1.3 + 40:
        # an editor that writes more than it was given is writing, not editing
        logger.info(
            "[editor] the edit grew the draft (%d → %d chars) — keeping the draft",
            len(draft),
            len(text),
        )
        return draft, follow_ups
    return text, as_str_list(raw.get("follow_ups"), limit=3, item_limit=120)
