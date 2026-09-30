"""Fetch song facts + producer/label credits from Genius.com.

Mirrors the shape of ``song_facts_service.py`` / ``artist_facts_service.py``:
build a URL, fetch + parse, return structured data ready for
``MetadataDB.add_song_facts_batch`` / ``MetadataDB.update_track_producer_label``.

Unlike songfacts.com (a flat bullet list), Genius carries a song description
plus per-line annotations ("referents") explaining specific lyric fragments.
Line-annotation facts are pre-formatted as
``"Lyrics string: {line}. Fact: {explanation}"`` so that
``track_chat_service.resolve_song_facts_list`` (a plain
``SELECT fact FROM song_facts``) feeds them into both the "chat about song"
and "explain this line" prompts unchanged — no prompt-building code needs to
know these facts came from Genius.
"""

from __future__ import annotations

import logging
import re
from html import unescape
from typing import TypedDict

from bs4 import BeautifulSoup

from musix.contexts.library.artist_split import normalize_artist_name, primary_artist

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 15


class GeniusParseError(Exception):
    """Raised when a Genius page can't be fetched or doesn't parse."""


# ---------------------------------------------------------------------------
# Genius URL slug
# ---------------------------------------------------------------------------


def _title_case_slug(text: str) -> str:
    """'Still D.R.E.' -> 'Still-dre'-style Genius title fragment.

    Genius slugs are Title-Case-With-Dashes: strip apostrophes/quotes/commas/
    '?'/'!' (same punctuation set as ``song_facts_service._slugify``), drop
    parenthetical suffixes, normalize dash variants, then join words with '-'.
    Only the FIRST word of the fragment is capitalized in practice on Genius
    (e.g. "Dr-dre", "Still-dre"), so we title-case just the leading word and
    lowercase the rest — matching real Genius URLs like
    ``genius.com/Dr-dre-still-dre-lyrics``.
    """
    # Genius spells the ampersand out everywhere in a slug, not just in the
    # artist part: genius.com/Coldplay-death-and-all-his-friends-lyrics. Doing
    # it here rather than at one call site keeps both halves consistent — a
    # title like "Death & All His Friends" used to build a URL Genius 404s on,
    # costing that song its description, annotations and producer credits.
    # Padded with spaces so "Me&You" splits into words too; .split() below
    # collapses the runs.
    cleaned = text.replace("&", " and ")
    cleaned = re.sub(r"[‐‑‒–—―−]", "-", cleaned)
    cleaned = re.sub("['`,?!''‚‛„‟′″ʼ«».]", "", cleaned)
    cleaned = re.sub(r"\s*\(.+?\)\s*", " ", cleaned)
    words = cleaned.split()
    return "-".join(w.lower() for w in words)


def build_genius_url(artist: str, title: str) -> str:
    """Build the Genius lyrics-page URL for a (primary artist, title) pair.

    Feat./collab artists are dropped (Genius pages are keyed by primary
    performer); ``&`` becomes ``and`` in both halves (see ``_title_case_slug``).
    """
    artist_primary = primary_artist(normalize_artist_name(artist))
    artist_slug = _title_case_slug(artist_primary)
    title_slug = _title_case_slug(normalize_artist_name(title))
    # Genius capitalizes only the very first word of the whole slug.
    combined = f"{artist_slug}-{title_slug}"
    if combined:
        combined = combined[0].upper() + combined[1:]
    return f"https://genius.com/{combined}-lyrics"


# ---------------------------------------------------------------------------
# Low-level fetch (adapted from parse_genius.py, routed through get_proxy())
# ---------------------------------------------------------------------------


def _unescape_js_string(s: str) -> str:
    result = []
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c == "\\" and i + 1 < n:
            nc = s[i + 1]
            if nc == '"':
                result.append('"')
                i += 2
                continue
            elif nc == "'":
                result.append("'")
                i += 2
                continue
            elif nc == "\\":
                result.append("\\")
                i += 2
                continue
            elif nc == "n":
                result.append("\n")
                i += 2
                continue
            elif nc == "r":
                result.append("\r")
                i += 2
                continue
            elif nc == "t":
                result.append("\t")
                i += 2
                continue
            elif nc == "b":
                result.append("\b")
                i += 2
                continue
            elif nc == "f":
                result.append("\f")
                i += 2
                continue
            elif nc == "/":
                result.append("/")
                i += 2
                continue
            elif nc == "x" and i + 3 < n:
                try:
                    result.append(chr(int(s[i + 2 : i + 4], 16)))
                    i += 4
                    continue
                except ValueError:
                    pass
            elif nc == "u" and i + 5 < n:
                try:
                    result.append(chr(int(s[i + 2 : i + 6], 16)))
                    i += 6
                    continue
                except ValueError:
                    pass
            result.append(nc)
            i += 2
            continue
        else:
            result.append(c)
            i += 1
    return "".join(result)


def _parse_preloaded_state(html: str) -> dict:
    import json as _json

    soup = BeautifulSoup(html, "html.parser")
    for script in soup.find_all("script"):
        if script.string and "__PRELOADED_STATE__" in script.string:
            match = re.search(
                r"window\.__PRELOADED_STATE__\s*=\s*JSON\.parse\('(.+?)'\);\s*\n",
                script.string,
                re.DOTALL,
            )
            if match:
                raw = _unescape_js_string(match.group(1))
                return _json.loads(raw)
    raise GeniusParseError("no __PRELOADED_STATE__ on page")


def parse_page(html: str) -> dict:
    """v2: the page is fetched by the runner (httpx + the `genius` bucket); a 404 is
    its answer, not an exception here."""
    return _parse_preloaded_state(html)


def _resolve_song_id(data: dict) -> str:
    song_page = data.get("songPage", {})
    song_ref = song_page.get("song")
    if isinstance(song_ref, dict):
        return str(song_ref.get("id", ""))
    if song_ref is not None:
        return str(song_ref)
    songs = data.get("entities", {}).get("songs", {})
    if songs:
        return next(iter(songs))
    return ""


def _extract_description(data: dict, song_id: str) -> str | None:
    songs = data.get("entities", {}).get("songs", {})
    song = songs.get(song_id, {}) if song_id else {}
    desc = song.get("descriptionPreview") or data.get("songPage", {}).get("description")
    if not desc:
        return None
    return re.sub(r"\s+", " ", desc).strip() or None


def _extract_producers(data: dict, song_id: str) -> list[str]:
    entities = data.get("entities", {})
    artists = entities.get("artists", {})
    songs = entities.get("songs", {})
    song = songs.get(song_id, {}) if song_id else {}

    names: list[str] = []
    for aid in song.get("producerArtists", []):
        artist = artists.get(str(aid), {})
        name = artist.get("name")
        if name:
            names.append(name)

    if not names:
        producer_keywords = {"producer", "production"}
        for perf in song.get("customPerformances", []):
            label = perf.get("label", "")
            if any(k in label.lower() for k in producer_keywords):
                for aid in perf.get("artists", []):
                    name = artists.get(str(aid), {}).get("name")
                    if name:
                        names.append(name)

    seen = set()
    deduped = []
    for n in names:
        if n not in seen:
            seen.add(n)
            deduped.append(n)
    return deduped


def _extract_label(data: dict, html: str) -> str | None:
    soup = BeautifulSoup(html, "html.parser")
    for label_el in soup.find_all(True, class_=lambda c: c and "Credit__Label" in str(c)):
        text = label_el.get_text(strip=True)
        if text == "Label":
            sibling = label_el.find_next_sibling()
            if not sibling:
                return None
            # Multiple labels render as adjacent <span> links joined by bare
            # "," / "&" text nodes with no surrounding whitespace — get_text
            # would otherwise glue them together (e.g. "Labelа,Labelb&Labelc").
            val = sibling.get_text(strip=True)
            val = re.sub(r"\s*,\s*", ", ", val)
            val = re.sub(r"\s*&\s*", " & ", val)
            return val.strip() or None
    return None


def _get_referent_links(data: dict) -> dict:
    html = data["songPage"]["lyricsData"]["body"]["html"]
    soup = BeautifulSoup(html, "html.parser")
    links = {}
    for a in soup.find_all("a", attrs={"data-id": True}):
        rid = a["data-id"]
        href = a["href"]
        full_url = "https://genius.com" + href if href.startswith("/") else href
        links[rid] = full_url
    return links


def _clean_annotation_text(text: str) -> str:
    """Strip markdown/HTML down to readable plain text for an LLM prompt."""
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)  # [text](url) -> text
    text = re.sub(r"[*_`]{1,3}", "", text)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def parse_referent(html: str, referent_id: str) -> tuple[str, str] | None:
    """Returns (fragment_text, annotation_text) or None if unavailable. v2: the page
    comes from the runner."""
    import json as _json

    soup = BeautifulSoup(html, "html.parser")

    def _meta(prop: str):
        tag = soup.find("meta", attrs={"property": prop})
        return tag.get("content") if tag else None

    fragment = _meta("rap_genius:referent")
    body = _meta("rap_genius:body")
    if fragment and body:
        return fragment, _clean_annotation_text(body)

    target_script = None
    for script in soup.find_all("script"):
        if script.string and "__PRELOADED_STATE__" in script.string:
            target_script = script.string
            break
    if not target_script:
        return None

    match = re.search(
        r"window\.__PRELOADED_STATE__\s*=\s*JSON\.parse\('(.+?)'\);\s*\n",
        target_script,
        re.DOTALL,
    )
    if not match:
        return None
    try:
        raw = _unescape_js_string(match.group(1))
        page_data = _json.loads(raw)
        entities = page_data.get("entities", {})
        referents_map = entities.get("referents", {})
        annotations_map = entities.get("annotations", {})
        referent_info = referents_map.get(referent_id)
        frag = fragment or (referent_info.get("fragment") if referent_info else None)
        ann_ids = referent_info.get("annotations", []) if referent_info else []
        if not frag or not ann_ids:
            return None
        ann = annotations_map.get(str(ann_ids[0]))
        if not ann:
            return None
        ann_text = ann.get("body", {}).get("markdown") or ann.get("body", {}).get("html")
        if not ann_text:
            return None
        return frag, _clean_annotation_text(ann_text)
    except (ValueError, KeyError):
        return None


def referent_urls(data: dict) -> list[tuple[str, str]]:
    """(referent id, page url) in lyric order, deduplicated — what v1's
    `_fetch_all_annotations` walked; the runner fetches them through the bucket."""
    links = _get_referent_links(data)
    referent_ids = data["songPage"]["lyricsData"]["referents"]
    unique_ids = list(dict.fromkeys(str(r) for r in referent_ids))
    return [(rid, links.get(rid, f"https://genius.com/{rid}")) for rid in unique_ids]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


class GeniusSongData(TypedDict):
    url: str
    description: str | None
    annotations: list[tuple[str, str]]
    producers: list[str]
    label: str | None


def song_data(
    url: str, html: str, data: dict, annotations: list[tuple[str, str]]
) -> GeniusSongData:
    """v1 `fetch_song_data` minus the network. Raises GeniusParseError on failure."""
    song_id = _resolve_song_id(data)
    if not song_id:
        raise GeniusParseError(f"could not resolve song id at {url}")
    return {
        "url": url,
        "description": _extract_description(data, song_id),
        "annotations": annotations,
        "producers": _extract_producers(data, song_id),
        "label": _extract_label(data, html),
    }


def build_song_facts(parsed: GeniusSongData) -> list[tuple[str, str]]:
    """Returns list of (fact_text, category) ready for add_song_facts_batch."""
    facts: list[tuple[str, str]] = []
    if parsed["description"]:
        facts.append((parsed["description"], "genius_description"))
    for fragment, annotation in parsed["annotations"]:
        fact = f"Lyrics string: {fragment.strip()}. Fact: {annotation.strip()}"
        facts.append((fact, "genius_annotation"))
    return facts


def build_producer_label(parsed: GeniusSongData) -> tuple[str | None, str | None]:
    producer = ", ".join(parsed["producers"]) if parsed["producers"] else None
    return producer, parsed["label"]
