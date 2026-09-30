"""«Вайбики» names and the hero's wave phrase — v1 `recsys_ai_service`'s prompts,
validators and deterministic fallback, copied. The v1 caches keyed by a membership hash
are not needed: every LLM answer is in `llm_cache` by its prompt, so an unchanged set of
vibes costs a lookup. v1 fed the wave its «islands»; v2 has none (removed with the
portrait), so the long-term side is the listener's top artists by affinity, each as a
one-artist island — the prompt text is v1's.

The texts land in `taste_profile` (names inside `vibes`, the phrase in `wave`), which
moves /home's ETag."""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

MAX_VIBE_CHARS = 130
_LANG_NAMES = {"en": "English", "ru": "Russian"}


def _lang_name(lang: str) -> str:
    return _LANG_NAMES.get(lang, "English")


def _distinct_genres(tracks: list[dict]) -> list[str]:
    """Order-preserving distinct genre tags across an island's member tracks."""
    out: list[str] = []
    seen: set[str] = set()
    for m in tracks:
        g = (m.get("genre") or "").strip()
        if g and g.lower() not in seen:
            seen.add(g.lower())
            out.append(g)
    return out


_VIBE_NAMES_SYSTEM = """You name a music listener's current "vibes" — small short-lived clusters of tracks they keep returning to these days — for a music player. Output names in {lang_name}.

INPUT: each vibe has an id, its genre tags, and its member tracks (artist — title).

For EACH vibe write ONE name, 2-3 words, in {lang_name}:
- Name the actual sound: the genre plus one concrete quality (pace, mood, texture). A genre term is welcome.
- Plain and matter-of-fact, like a label on a shelf. No pathos, no poetry, no invented scenes or places.
- Never use artist or song names. If one were ever to appear anyway, it must stay EXACTLY as given — never translated, transliterated, localized, or grammatically declined into {lang_name}.
- Ground every word in the given tracks and genres — if the data doesn't show it, don't write it.

OUTPUT: ONLY minified JSON, no prose, no fences:
{{"vibe_names": {{"<vibe_id>": "...", ...}}}}"""


def _vibe_names_user_prompt(vibes: list[dict]) -> str:
    lines = ["CURRENT VIBES (strongest first):"]
    for i, v in enumerate(vibes, 1):
        tracks = v["tracks"]
        genres = _distinct_genres(tracks)
        members = "; ".join(f"{m['artist']} — {m['title']}" for m in tracks)
        lines.append(f"{i}. id={v['track_id']}")
        lines.append(f"   genres: {', '.join(genres) if genres else '(no genre tags)'}")
        lines.append(f"   tracks: {members}")
    return "\n".join(lines)


_VIBE_SYSTEM = """You write ONE short phrase — a "wave" tagline — describing what a listener is in the mood for right now, for a music player's "For You" hero.

Language for the output: {lang_name}.

You are given the listener's LONG-TERM taste (stable islands of tracks they love + a sound-axis profile) and their SHORT-TERM rotation (artists they've been playing/liking lately). Lead with the current mood; ground it in their lasting identity. If short-term and long-term pull apart, that tension is the interesting part — name it.

Rules:
- ONE phrase, max ~110 characters. No second sentence.
- Evocative and concrete: name the sound, the mood, the energy. NEVER filler ("eclectic", "diverse taste", "music lover", "wide range").
- No emoji, no quotes, no hashtags. Prefer describing the sound over name-dropping artists.
- HARD RULE — artist names are untouchable: if you mention an artist at all, copy the name EXACTLY as it is spelled in the input, character for character. NEVER translate, transliterate, localize or grammatically decline an artist name into {lang_name} (or any language). "Twenty One Pilots" must never become "Двадцать один пилот". This rule outranks the output-language rule: the phrase is in {lang_name}, artist names stay verbatim.
- No trailing period unless it reads naturally.

Output ONLY the phrase text — nothing else."""


def _vibe_user_prompt(profile: dict, recent: list[dict]) -> str:
    lines = ["LONG-TERM TASTE ISLANDS (strongest first):"]
    for i, isl in enumerate(profile["islands"][:10], 1):
        seen: set[tuple[str, str]] = set()
        pairs: list[str] = []
        for m in isl["tracks"][:5]:
            artist = (m.get("artist") or "—").strip()
            genre = (m.get("genre") or "").strip()
            key = (artist.lower(), genre.lower())
            if key in seen:
                continue
            seen.add(key)
            pairs.append(artist + (f" [{genre}]" if genre else ""))
        lines.append(f"{i}. weight={isl['weight']}: {'; '.join(pairs)}")
    axes = profile.get("axes")
    if axes:
        lines.append("\nSOUND AXES (z-score, + = first pole):")
        for name, ax in axes.items():
            lines.append(f"- {name}: {ax['z']} ({ax['level']})")
    if recent:
        rot = ", ".join(
            r["artist"] + (f" [{r['genre']}]" if r.get("genre") else "") for r in recent
        )
        lines.append("\nSHORT-TERM ROTATION (most recent first): " + rot)
    else:
        lines.append("\nSHORT-TERM ROTATION: (not enough recent activity)")
    lines.append("\nWrite the one-phrase wave tagline:")
    return "\n".join(lines)


def _validate_vibe(phrase: str) -> str:
    """Trim, drop wrapping quotes, keep the first line, enforce length cap."""
    phrase = (phrase or "").strip().strip('"').strip("'").strip()
    phrase = phrase.split("\n")[0].strip()
    if len(phrase) > MAX_VIBE_CHARS:
        phrase = phrase[:MAX_VIBE_CHARS].rstrip() + "…"
    return phrase


_CYRILLIC_RE = re.compile(r"[Ѐ-ӿ]")
_LATIN_RE = re.compile(r"[A-Za-z]")


def _lang_conforms(phrase: str, lang: str) -> bool:
    """Reject a reply whose script doesn't match the requested language.

    The prompt embeds raw (often Latin-script) artist/genre names inside a
    Russian instruction, and a small local model occasionally mirrors that
    dominant script instead of following ``lang`` — caching that reply would
    stick a wrong-language phrase in the DB until an unrelated cache-key
    change happens to roll a correct one. Phrases with no alphabetic
    characters at all (rare) are let through, nothing to judge.
    """
    cyrillic = len(_CYRILLIC_RE.findall(phrase))
    latin = len(_LATIN_RE.findall(phrase))
    total = cyrillic + latin
    if total == 0:
        return True
    return (cyrillic / total) >= 0.6 if lang == "ru" else (latin / total) >= 0.6


def _top_artists_from_islands(islands: list[dict], n: int = 2) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for isl in islands:
        for m in isl.get("tracks", []):
            a = (m.get("artist") or "").strip()
            if a and a.lower() not in seen:
                seen.add(a.lower())
                out.append(a)
            if len(out) >= n:
                return out
    return out


def deterministic_taste_vibe(profile: dict, recent: list[dict], lang: str) -> dict:
    """Instant, no-LLM fallback phrase from island artists + recent rotation.

    Used when AI is disabled, and as the immediate response while the AI phrase
    generates in the background. Frames a "wave" rather than naming a single
    song. Returns {"phrase", "source"}.
    """
    long_artists = _top_artists_from_islands(profile.get("islands", []), n=2)
    lead = recent[0]["artist"] if recent else (long_artists[0] if long_artists else None)
    base = long_artists[0] if long_artists else lead
    if not base:
        return {"phrase": None, "source": None}
    ru = lang == "ru"
    if lead and base and lead.lower() != base.lower():
        phrase = (
            f"Сейчас тянет к {lead} — на вашей волне вокруг {base}"
            if ru
            else f"Leaning into {lead} lately — riding your wave around {base}"
        )
    elif len(long_artists) >= 2:
        phrase = (
            f"Волна вокруг {long_artists[0]}, {long_artists[1]} и близкого по звуку"
            if ru
            else f"A wave around {long_artists[0]}, {long_artists[1]} and kindred sounds"
        )
    else:
        phrase = (
            f"Волна вокруг {base} и близкого по звуку"
            if ru
            else f"A wave around {base} and kindred sounds"
        )
    return {"phrase": _validate_vibe(phrase), "source": "fallback"}
