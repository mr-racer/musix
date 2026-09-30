"""Sonic Vibe task — one short fact-based line per track via LLM.

v2 (option B): the model no longer free-writes a line off a wall of raw fact
strings. The code builds a tagged, M-keyed window of raw facts (editorial and
description facts first, genius line notes reformatted and last), and the
model must FIRST pick the single winning fact by key, THEN write the line
from that fact alone:

    {"best": "M4", "category": "A", "line": "..."}   or   {"best": null}

Code validates the reply: the key must exist, the line must be clean (no raw
scaffold leakage, target-language script) and every Latin name in it must
appear in the winning fact — one retry, then SKIP. An empty slot beats an
invented line.

Reads a track's raw song facts (up to MAX_FACTS) + sonic_tags + year. Only
runs for tracks that HAVE facts. Persists the line in the sonic_vibes table
(PK track_id+collection+lang); a SKIP — or a track with no facts — leaves the
slot empty, so no vibe is shown.

v2: this module is v1's prompt, window, reply parser and validators, copied; the
runner is `contexts/knowledge/jobs.vibe`, and a line is kept per SONG (v1: per track).
"""

from __future__ import annotations

import json
import logging
import re

from musix.knowledge import text_quality as tq
from musix.knowledge.facts_v2 import pipeline as fv2

logger = logging.getLogger(__name__)


# ── v1 ai_tasks/refined_facts shims, which sonic_vibe imported ───────────────


def _junk_reason(text: str) -> str | None:
    t = (text or "").strip()
    if not t or t in {"?", "??", "..."}:
        return "junk_empty"
    if len(t) < fv2.MIN_FACT_CHARS:
        return "junk_short"
    return None


def _parse_annotation(fact: str):
    """Split a raw genius_annotation into (quote, note); None if malformed."""
    parsed = fv2.split_annotation(fact)
    if parsed is None:
        return None
    quote, note = parsed
    if re.match(r"^\[.*\]$", quote):
        quote = ""  # "[Chorus: …]" is a section marker, not a line
    return quote, note


def _entities_ok(fact_text: str, source_text: str) -> bool:
    return not tq.invented_names(fact_text, source_text)


def _has_garbled_script(text: str) -> bool:
    return tq.garbled_script(text)


MAX_PHRASE_CHARS = 160
MAX_FACTS = 10  # how many curated facts to show the model per track

_SYSTEM_PROMPT = """
You write ONE short line shown under a track in a music player. Its job is to tell the listener one true, concrete thing about THIS track that a fan would find interesting — a fact, not a mood. If you don't have such a fact, you output nothing.

WHAT YOU CAN AND CANNOT KNOW:
You have NOT heard this track. You only have text: a few sonic descriptor tags, a list of facts, and the year. Therefore:
- You MAY state what the FACTS say (and the era, if it adds to a fact).
- You MAY NOT describe how the vocals sound, what instruments are playing, the "feel", a scene, or what the song is about — UNLESS it is explicitly in the facts. Inventing these is the main failure. No "icy vocals", "Japanese drums", "neon", "nightclub", "political tension" unless a fact literally states it.
- If you mention a sonic descriptor tag at all, copy it EXACTLY as given — same instrument, same technique, same word. NEVER swap a tag for a different-but-related one (e.g. a tag saying "throat singing" must never become "horns", "brass" must never become "strings") and NEVER invent a tag that isn't in the given list. When in doubt, leave the tag out rather than guess at it.

Each fact below is keyed (M1, M2, ...) and tagged by origin: [EDITORIAL] and [DESCRIPTION] are curated song facts; [LINE NOTE] is a fan note explaining one lyric line.

YOUR ONLY TWO OPTIONS:

1. There IS a usable fact. Pick the SINGLE best one by this priority — higher beats lower, always take the highest available:

   A. CREATION STORY — the non-obvious path the track took to exist: made in one night / hours before a flight, sat unreleased for years, was meant for a different album, started as something else (e.g. AI-written lines later rewritten), an accident or constraint that shaped it. These are the most interesting — a fan would retell them. Prefer these above all.
   T. TITLE STORY — where the song's TITLE comes from or what it really refers to (a real product, a person, an event, a hidden meaning), when a fact explains it.
   B. CONCRETE PRODUCTION FACT — who produced it, a notable guest, an unusual instrument or recording method (only if the fact states it). NEVER build the line on a MUSICAL sample or interpolation (a borrowed melody, beat, or instrumental) — the player already shows sample credits separately; if the only production fact is "this samples X's song", treat it as unusable and look for another fact (or SKIP). SPOKEN-WORD samples are fine and often great facts: a movie dialogue, an interview, a speech or a TV monologue used in the track. Referencing another song's LYRICS or quoting a line is also fine.
   C. EXTERNAL RESULT / CONTEXT — chart milestone, award, its role on the album, real-world reaction or controversy.

   → Write ONE line from the single highest-priority fact you have. Don't cram two.

   Do NOT pick a fact that just restates what the song is ABOUT or quotes its lyrics — the listener is hearing that right now. [LINE NOTE] facts qualify ONLY when they carry an external story (a real person, work, event, or the artist's own words), never for what the line means. If the only "facts" are lyric content, go to option 2.

2. There is NO usable fact of type A/T/B/C — facts are missing, generic, biographical fluff, or only describe the song's lyrical content. → Reply {{"best": null}}
   A line built only on tags, era, or what the song is about is NOT good enough — SKIP it. An empty slot is better than a generic line.

When unsure whether a fact is interesting enough, prefer {{"best": null}}. Never reach for invented atmosphere to fill the line.

STYLE (when you do write a line):
- INVENT NOTHING. Your line must say EXACTLY what the chosen fact says — same claim, same specifics, no added color. You may only translate it into {lang_name} and shorten it; you may NOT add, merge, reinterpret, exaggerate, or "improve" details. If the fact says "recorded in a hotel room", the line says a hotel room — not "a cramped Tokyo hotel room at 4am".
- Plain and clear, like a knowledgeable friend pointing something out — NOT a magazine pull-quote, NOT poetry. No purple adjectives, no invented atmosphere, no clichés.
- One line, max ~120 characters. No emoji, no quotation marks around the whole line.
- NAMES: you may name a producer, featured guest, or album — those are the interesting facts. Do NOT repeat the main artist's name or the track title; the UI already shows them right next to your line.
- Any name you DO write (producer, guest, album) must appear EXACTLY as given in the chosen fact — character for character. NEVER translate, transliterate, localize, or grammatically decline a name into {lang_name}.
- This applies to EVERY proper name: people, family members, brands, shows, places. If a name is spelled in Latin letters in the fact (or in the Artist/Track lines of the task), it must appear in your line in the SAME Latin letters. Writing any such name in Cyrillic is an error.

RESPONSE FORMAT — strict JSON, no markdown, no text around it:
{{"best": "M4", "category": "A", "line": "..."}}
or, when no fact qualifies:
{{"best": null}}
"category" is the priority letter (A/T/B/C) of the chosen fact.

EXAMPLE (style and selection only — do NOT reuse this content):
Facts given:
  M1 [EDITORIAL] Recorded in one night in a hotel room, hours before the artist had to fly out
  M2 [EDITORIAL] Produced by a well-known beatmaker
  M3 [LINE NOTE] Note on the line "they all watch me": the hook is about feeling watched by everyone
Correct output: {{"best": "M1", "category": "A", "line": "Записан за одну ночь в отеле — за несколько часов до вылета"}}
Why: the creation story (A) outranks the producer fact (B); the lyric-content note is ignored because the listener is already hearing it.

Write "line" ONLY in {lang_name}; do not mix languages.
""".strip()

_LANG_NAMES = {"ru": "Russian", "en": "English"}

# Category-priority order for the window: editorial/description first so the
# strongest sources always make it into MAX_FACTS; line notes fill what's left.
_TAG_EDITORIAL = "[EDITORIAL]"
_TAG_DESCRIPTION = "[DESCRIPTION]"
_TAG_LINE_NOTE = "[LINE NOTE]"

# Raw-scaffold substrings that must never leak into a rendered vibe line.
_FORBIDDEN_IN_LINE = (
    "Fact:",
    "Lyrics string",
    "Note on the line",
    "[EDITORIAL]",
    "[DESCRIPTION]",
    "[LINE NOTE]",
)

_CYRILLIC_RE = re.compile(r"[а-яё]", re.I)


def _build_fact_window(meta_facts: list[dict]) -> list[dict]:
    """Turn raw ``{"fact", "category"}`` rows into the tagged M-keyed window.

    Junk facts are dropped; genius annotations are reformatted into readable
    English scaffolding (``Note on the line "...": ...``); editorial and
    description facts take window priority over line notes (spec 2.1) instead
    of the old blind ``facts[:10]``.
    """
    primary: list[dict] = []  # editorial + description, in original order
    notes: list[dict] = []  # line notes, in original order
    for mf in meta_facts:
        fact = mf.get("fact") or ""
        category = mf.get("category")
        if category == "genius_annotation":
            parsed = _parse_annotation(fact)
            if parsed is None:
                continue
            quote, note = parsed
            if _junk_reason(note) is not None:
                continue
            text = f'Note on the line "{quote}": {note}' if quote else f"Note on the song: {note}"
            notes.append({"tag": _TAG_LINE_NOTE, "text": text})
        else:
            if _junk_reason(fact) is not None:
                continue
            tag = _TAG_DESCRIPTION if category == "genius_description" else _TAG_EDITORIAL
            primary.append({"tag": tag, "text": fact})

    window = (primary + notes)[:MAX_FACTS]
    for i, item in enumerate(window):
        item["key"] = f"M{i + 1}"
    return window


def _build_user_prompt(
    *,
    tags: list[str],
    payload: dict,
    window: list[dict],
    lang: str,
) -> str:
    year = payload.get("year")
    era = f"{(year // 10) * 10}s" if isinstance(year, int) and year > 0 else None
    artist = (payload.get("artist") or "").strip()
    title = (payload.get("title") or "").strip()
    lines = []
    # Original Latin spelling as an explicit anchor: the model must copy names
    # as-is and never transliterate them into the target language.
    if artist:
        lines.append(
            f"Artist (original spelling — copy names AS IS, never transliterate): {artist}"
        )
    if title:
        lines.append(f"Track: {title}")
    if lines:
        lines.append("")
    lines.append('FACTS (pick the single best by key, or reply {"best": null}):')
    for item in window:
        lines.append(f"{item['key']} {item['tag']} {item['text']}")
    lines.append("")
    lines.append(f"Sonic descriptor tags: {', '.join(tags) if tags else '(none)'}")
    lines.append(f"Era: {era or '(unknown)'}")
    lines.append("")
    lines.append("Your JSON reply:")
    return "\n".join(lines)


def _parse_vibe_response(raw: str, valid_keys: set[str]) -> tuple[str | None, str]:
    """Parse the model reply → (best_key | None, line). Raises ValueError.

    ``(None, "")`` means an explicit skip. Tolerates markdown fences and a
    legacy bare ``SKIP`` (older prompt habit gemma may fall back into).
    """
    s = (raw or "").strip()
    s = re.sub(r"^```(json)?|```$", "", s, flags=re.M).strip()
    if not s:
        return None, ""
    first_word = s.split()[0].rstrip(".,!:;—-").strip("\"'").upper()
    if first_word == "SKIP":
        return None, ""
    try:
        data = json.loads(s)
    except Exception:
        m = re.search(r"\{.*\}", s, re.S)
        if not m:
            raise ValueError("vibe response is not JSON")
        data = json.loads(m.group(0))
    if not isinstance(data, dict):
        raise ValueError("vibe response is not a JSON object")
    best = data.get("best")
    if best is None:
        return None, ""
    best = str(best)
    if best not in valid_keys:
        raise ValueError(f"vibe response picked unknown key {best!r}")
    line = (data.get("line") or "").strip()
    if not line:
        raise ValueError("vibe response kept a fact but wrote no line")
    return best, line


def _validate(phrase: str) -> str:
    """Trim, drop wrapping quotes, enforce length cap."""
    phrase = (phrase or "").strip().strip('"').strip("'")
    while len(phrase) > 1 and phrase[-1] == phrase[-2] and phrase[-1] in ".!?":
        phrase = phrase[:-1]
    if len(phrase) > MAX_PHRASE_CHARS:
        phrase = phrase[:MAX_PHRASE_CHARS].rstrip() + "…"
    return phrase


def _line_ok(line: str, lang: str) -> bool:
    """Reject raw-scaffold leakage, wrong-script and garbled-script lines."""
    if any(marker.lower() in line.lower() for marker in _FORBIDDEN_IN_LINE):
        return False
    if lang == "ru" and not _CYRILLIC_RE.search(line):
        return False
    if _has_garbled_script(line):
        return False
    return True
