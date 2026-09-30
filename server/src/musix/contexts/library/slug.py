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


def song_slug(text: str) -> str:
    """v1 app/services/song_facts_service._slugify, verbatim: the song half of the key the
    knowledge base (and songfacts.com's URLs) use. NOT `slugify` above — v1 keeps three
    slugifiers apart on purpose; this one keeps & and ., drops commas, ?, ! and a
    trailing "(…)", so "Song (Remix)" shares the song's facts."""
    # Unicode dash variants → ASCII hyphen
    cleaned_title = re.sub(r"[‐‑‒–—―−]", "-", text)
    cleaned_title = re.sub(
        "['`,?!''‚‛„‟′″ʼ«»]",
        "",
        cleaned_title,
    )
    brackets_delete_pattern = r"^(.+?)\s*\(.+"
    cleaned_title = re.sub(brackets_delete_pattern, r"\1", cleaned_title)

    return "-".join(cleaned_title.lower().split())


def song_key(artist: str, title: str) -> str:
    """v1 `get_song_facts_key`: the PRIMARY performer + the title, both via `song_slug`."""
    from musix.contexts.library import artist_split

    return f"{song_slug(artist_split.primary_artist(artist) or artist)}-{song_slug(title)}"
