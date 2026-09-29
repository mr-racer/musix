"""Copied from v1 app/services/artist_facts_service._slugify (proven; owned here now)."""

import re
import unicodedata


def slugify(artist: str) -> str:
    """'The Weeknd' -> 'the-weeknd'

    Normalizes Unicode equivalents (NFKC, dash variants, curly quotes) before
    slug generation, so that "Guns N' Roses" and "Guns N' Roses" produce the
    same slug regardless of source metadata. Mirrors the normalization in
    artist_split.normalize_artist_name to avoid a circular import.
    """
    s = unicodedata.normalize("NFKC", artist)
    s = re.sub(r"[‐‑‒–—―−]", "-", s)
    s = s.replace("\u2018", "'").replace("\u2019", "'")
    s = s.replace("\u201b", "'").replace("\u201a", ",")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u201e", '"')
    cleaned_artist = " ".join(s.split())
    # Strip noisy punctuation (apostrophes, quotes, +, &, .)
    cleaned_artist = re.sub(
        "[+&.'`''‚‛„‟′″ʼ«»]",
        "",
        cleaned_artist,
    )
    return "-".join(cleaned_artist.lower().split())
