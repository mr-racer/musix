"""The text a track is embedded from — v1 `qdrant_payload.build_text_for_embedding`,
unchanged, because v1's vectors are migrated as they are and a query must meet
documents embedded the same way."""

from __future__ import annotations

import re

_PARA_SPLIT = re.compile(r"\n\s*\n")


def unique_paragraphs(lyrics: str) -> list[str]:
    """Paragraphs with duplicates dropped, in SOURCE order (a chorus repeated six times
    must not weigh six times, and the verses must keep their order). Duplicates match on
    a folded key; the first occurrence is kept as written."""
    text = (lyrics or "").replace("\r\n", "\n").replace("\r", "\n")
    seen: dict[str, str] = {}
    for para in _PARA_SPLIT.split(text):
        para = para.strip()
        if not para:
            continue
        key = " ".join(para.split()).casefold()
        seen.setdefault(key, para)
    return list(seen.values())


def text_for_embedding(
    title: str | None, artist: str | None, album: str | None, genre: str | None, lyrics: str | None
) -> str:
    parts = []
    if title:
        parts.append(f"title: {title}")
    if artist:
        parts.append(f"artist: {artist}")
    if album:
        parts.append(f"album: {album}")
    if genre:
        parts.append(f"genre: {genre}")
    body = "\n\n".join(unique_paragraphs(lyrics or ""))
    if len(body) > 20:
        parts.append(body)
    return " | ".join(parts)
