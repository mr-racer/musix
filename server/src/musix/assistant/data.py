"""The assistant's reads of the account's library and of the knowledge base, with v1's
return shapes (MetadataDB, track_store, library_catalog loaders).

Sync psycopg on purpose: v1's catalog, facts and pack readers are sync and run in
worker threads; one connection per thread, opened lazily. `collection_name` in the
copied code IS the account id (a uuid string) — every query here filters by it, so
nothing outside the account's own tracks can surface (the v1 visibility rule, now a
join). World knowledge about a song or an artist is readable only through a live
track of the account."""

from __future__ import annotations

import json
import re
import threading
import uuid
from typing import Any

import psycopg

_local = threading.local()
_conninfo: str | None = None

TRACK_COLS = """
    t.id::text AS track_id, t.title, t.title_display, t.artist_display AS artist, al.title AS album,
    t.year, t.genre, coalesce(t.duration_ms, 0) / 1000.0 AS duration_sec, mf.path AS file_path,
    t.cover_image_id AS cover_art_path, pa.slug AS primary_artist_slug,
    (SELECT json_agg(a.name ORDER BY ta.role <> 'main', ta.position) FROM track_artists ta
       JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = t.id)::text AS artists,
    (SELECT json_agg(a.slug ORDER BY ta.role <> 'main', ta.position) FROM track_artists ta
       JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = t.id)::text AS artist_slugs
"""
TRACK_FROM = """
    FROM tracks t JOIN media_files mf ON mf.id = t.media_file_id
    LEFT JOIN albums al ON al.id = t.album_id LEFT JOIN artists pa ON pa.id = t.primary_artist_id
"""
OWNS_SONG = "EXISTS (SELECT 1 FROM tracks o WHERE o.account_id = %(a)s AND o.song_id = s.id AND o.deleted_at IS NULL)"
OWNS_ARTIST = """EXISTS (SELECT 1 FROM track_artists ota JOIN tracks o ON o.id = ota.track_id
    WHERE ota.artist_id = ar.id AND o.account_id = %(a)s AND o.deleted_at IS NULL)"""


def configure(conninfo: str) -> None:
    global _conninfo
    _conninfo = conninfo


_open: list[psycopg.Connection[Any]] = []
_open_lock = threading.Lock()


def _conn() -> psycopg.Connection[Any]:
    c = getattr(_local, "conn", None)
    if c is None or c.closed:
        if _conninfo is None:
            raise RuntimeError("assistant data layer not configured")
        c = psycopg.connect(_conninfo, autocommit=True)
        _local.conn = c
        with _open_lock:
            _open.append(c)
    return c


def close_all() -> None:
    """End of a turn: every worker thread's connection is closed (the next turn opens
    fresh ones — a turn takes seconds, a connect takes a millisecond)."""
    with _open_lock:
        conns, _open[:] = list(_open), []
    for c in conns:
        try:
            c.close()
        except Exception:  # noqa: BLE001
            pass


def rows(sql: str, params: dict[str, Any]) -> list[tuple[Any, ...]]:
    with _conn().cursor() as cur:
        cur.execute(sql, params)  # type: ignore[arg-type]
        return list(cur.fetchall())


def dicts(sql: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    with _conn().cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(sql, params)  # type: ignore[arg-type]
        return list(cur.fetchall())


def _acct(collection_name: str) -> uuid.UUID:
    return uuid.UUID(str(collection_name))


# ── the library catalog (v1 library_catalog loaders) ──────────────────────────


def catalog_tracks(collection_name: str) -> list[tuple[Any, ...]]:
    """v1 track_metadata columns: track_id, title, artist, artists, artist_slugs,
    primary_artist_slug, album, year, cover_art_path, duration, file_path."""
    return rows(
        f"""SELECT t.id::text, t.title, t.artist_display,
            (SELECT json_agg(a.name ORDER BY ta.role <> 'main', ta.position) FROM track_artists ta
               JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = t.id)::text,
            (SELECT json_agg(a.slug ORDER BY ta.role <> 'main', ta.position) FROM track_artists ta
               JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = t.id)::text,
            pa.slug, al.title, t.year, t.cover_image_id, coalesce(t.duration_ms, 0) / 1000.0, mf.path
            {TRACK_FROM} WHERE t.account_id = %(a)s AND t.deleted_at IS NULL""",
        {"a": _acct(collection_name)},
    )


def catalog_songs(collection_name: str) -> list[tuple[Any, ...]]:
    """(song slug, title, artist slug) of the account's songs."""
    return rows(
        f"""SELECT s.slug, s.title, ar.slug FROM songs s LEFT JOIN artists ar ON ar.id = s.primary_artist_id
            WHERE {OWNS_SONG}""",
        {"a": _acct(collection_name)},
    )


def catalog_artists(collection_name: str) -> list[tuple[Any, ...]]:
    """(slug, name) of every artist on the account's tracks."""
    return rows(
        f"SELECT ar.slug, ar.name FROM artists ar WHERE {OWNS_ARTIST}",
        {"a": _acct(collection_name)},
    )


# ── facts (v1 MetadataFactSource / get_*_facts_rich / track chat) ─────────────


def _subject(kind: str) -> tuple[str, str]:
    return ("songs s", OWNS_SONG) if kind == "song" else ("artists ar", OWNS_ARTIST)


def raw_facts(collection_name: str, kind: str, slug: str) -> list[tuple[Any, ...]]:
    """(id, text, source, category) — v1 `_raw`."""
    table, owns = _subject(kind)
    alias = table.split()[1]
    return rows(
        f"""SELECT f.id, f.text, f.source, f.category FROM facts f JOIN {table} ON {alias}.id = f.subject_id
            WHERE f.subject_kind = %(k)s AND {alias}.slug = %(slug)s AND {owns} ORDER BY f.id""",
        {"a": _acct(collection_name), "k": kind, "slug": slug},
    )


def refined_facts(collection_name: str, kind: str, slug: str, lang: str) -> list[str]:
    """facts_v2 texts in `lang`, `other` excluded — v1 `_refined` over refined_fact_items."""
    table, owns = _subject(kind)
    alias = table.split()[1]
    got = rows(
        f"""SELECT r.text FROM fact_refinements r JOIN facts f ON f.id = r.fact_id
            JOIN {table} ON {alias}.id = f.subject_id
            WHERE f.subject_kind = %(k)s AND {alias}.slug = %(slug)s AND r.lang = %(lang)s
              AND r.text IS NOT NULL AND NOT (r.labels ? 'other') AND {owns} ORDER BY f.id""",
        {"a": _acct(collection_name), "k": kind, "slug": slug, "lang": lang},
    )
    return [str(t).strip() for (t,) in got if t and str(t).strip()]


def facts_rich(collection_name: str, kind: str, slug: str) -> list[dict[str, Any]]:
    return [
        {"fact": text, "source": source or "", "category": category or ""}
        for _, text, source, category in raw_facts(collection_name, kind, slug)
    ]


def song_facts_any(song_slug: str) -> list[str]:
    """v1 track chat's direct read (the track is the caller's own, checked upstream)."""
    got = rows(
        "SELECT f.text FROM facts f JOIN songs s ON s.id = f.subject_id WHERE f.subject_kind = 'song' "
        "AND s.slug = %(slug)s AND f.lang = 'en' ORDER BY f.id",
        {"slug": song_slug},
    )
    return [t for (t,) in got if t]


# ── relations (v1 get_sample_links / get_song_relations_*) ─────────────────────


def _split(text: str) -> tuple[str, str]:
    artist, _, song = text.partition(" — ")
    return (artist, song) if song else ("", text)


def sample_links(collection_name: str, src_slug: str) -> dict[str, list[dict[str, Any]]]:
    """v1 `get_sample_links`: facts_v2 links of this song, both directions, plus the
    account's own songs whose links point here. A target's slug is given only when the
    account owns that song (v1: dst_slug was resolved against the library)."""
    a = _acct(collection_name)
    own = dicts(
        f"""SELECT r.kind, r.target_text, r.evidence,
                   (SELECT s2.slug FROM songs s2 WHERE s2.id = r.target_song_id AND EXISTS
                      (SELECT 1 FROM tracks o WHERE o.account_id = %(a)s AND o.song_id = s2.id
                       AND o.deleted_at IS NULL)) AS slug
            FROM song_relations r JOIN songs s ON s.id = r.song_id
            WHERE s.slug = %(slug)s AND r.source = 'facts' AND {OWNS_SONG} ORDER BY r.id""",
        {"a": a, "slug": src_slug},
    )
    back = dicts(
        f"""SELECT s.title, ar.name AS artist, s.slug, r.kind, r.evidence FROM song_relations r
            JOIN songs t ON t.id = r.target_song_id JOIN songs s ON s.id = r.song_id
            LEFT JOIN artists ar ON ar.id = s.primary_artist_id
            WHERE t.slug = %(slug)s AND r.source = 'facts' AND r.kind IN ('sample', 'interpolation')
              AND {OWNS_SONG} ORDER BY r.id""",
        {"a": a, "slug": src_slug},
    )
    samples, sampled_by = [], []
    for r in own:
        artist, song = _split(r["target_text"])
        relation = (
            "interpolation" if r["kind"] in ("interpolation", "interpolated_by") else "sample"
        )
        entry = {
            "song": song or None,
            "artist": artist or None,
            "slug": r["slug"],
            "relation": relation,
            "evidence": r["evidence"],
        }
        (samples if r["kind"] in ("sample", "interpolation") else sampled_by).append(entry)
    seen = {(e["song"] or "", e["artist"] or "") for e in sampled_by}
    for r in back:
        if (r["title"] or "", r["artist"] or "") in seen:
            continue
        sampled_by.append(
            {
                "song": r["title"],
                "artist": r["artist"],
                "slug": r["slug"],
                "relation": r["kind"],
                "evidence": r["evidence"],
            }
        )
    return {"samples": samples, "sampled_by": sampled_by}


def _relations(slugs: list[str]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for r in dicts(
        """SELECT s.slug, r.kind, r.target_text, r.source FROM song_relations r JOIN songs s ON s.id = r.song_id
           WHERE s.slug = ANY(%(s)s) ORDER BY r.source <> 'genius', r.id""",
        {"s": slugs},
    ):
        out.setdefault(r["slug"], []).append(r)
    return out


def song_relations_raw(slugs: list[str]) -> dict[str, dict[str, list[dict[str, str]]]]:
    """v1 `get_song_relations_raw`: the GLiNER2+LLM extraction's samples, split."""
    out: dict[str, dict[str, list[dict[str, str]]]] = {}
    for slug, rs in _relations(slugs).items():
        rel: dict[str, list[dict[str, str]]] = {"samples": [], "sampled_by": []}
        for r in rs:
            if r["source"] != "extract" or r["kind"] not in ("sample", "sampled_by"):
                continue
            artist, song = _split(r["target_text"])
            rel["samples" if r["kind"] == "sample" else "sampled_by"].append(
                {"song": song, "artist": artist}
            )
        if rel["samples"] or rel["sampled_by"]:
            out[slug] = rel
    return out


def _dedup_key(name: str) -> str:
    return re.sub(r"[\W_]+", "", name.casefold())


def song_relations_bulk(slugs: list[str]) -> dict[str, dict[str, Any]]:
    """v1 `get_song_relations_bulk`: producer (Genius first, then the extraction,
    deduped), label, and "Artist — Song" samples / sampled_by."""
    out: dict[str, dict[str, Any]] = {}
    for slug, rs in _relations(slugs).items():
        producers: list[str] = []
        seen: set[str] = set()
        label = None
        samples, sampled_by = [], []
        for r in rs:
            if r["kind"] == "producer" and _dedup_key(r["target_text"]) not in seen:
                seen.add(_dedup_key(r["target_text"]))
                producers.append(r["target_text"])
            elif r["kind"] == "label" and label is None:
                label = r["target_text"]
            elif r["kind"] in ("sample", "interpolation") and r["source"] == "extract":
                samples.append(r["target_text"])
            elif r["kind"] in ("sampled_by", "interpolated_by") and r["source"] == "extract":
                sampled_by.append(r["target_text"])
        if producers or label or samples or sampled_by:
            out[slug] = {
                "producer": ", ".join(producers) or None,
                "label": label,
                "samples": samples or None,
                "sampled_by": sampled_by or None,
            }
    return out


# ── tracks (v1 track_store) ───────────────────────────────────────────────────


def _track_row(r: dict[str, Any]) -> dict[str, Any]:
    for k in ("artists", "artist_slugs"):
        r[k] = json.loads(r[k]) if r.get(k) else []
    r["duration"] = r["duration_sec"] = float(r.get("duration_sec") or 0.0)
    return r


def get_track(collection_name: str, track_id: str) -> dict[str, Any] | None:
    try:
        tid = uuid.UUID(str(track_id))
    except ValueError:
        return None
    got = dicts(
        f"SELECT {TRACK_COLS} {TRACK_FROM} WHERE t.id = %(t)s AND t.account_id = %(a)s AND t.deleted_at IS NULL",
        {"t": tid, "a": _acct(collection_name)},
    )
    return _track_row(got[0]) if got else None


def find_track_by_title_artist(
    collection_name: str, title: str, artist: str | None, limit: int = 1
) -> list[dict[str, Any]]:
    """v1 `track_store.find_track_by_title_artist`: case-insensitive title, and the
    artist among the track's participants when given."""
    got = dicts(
        f"""SELECT {TRACK_COLS} {TRACK_FROM}
            WHERE t.account_id = %(a)s AND t.deleted_at IS NULL
              AND (lower(t.title) = lower(%(title)s) OR lower(coalesce(t.title_display, '')) = lower(%(title)s))
              AND (%(artist)s::text IS NULL OR lower(t.artist_display) LIKE '%%' || lower(%(artist)s) || '%%'
                   OR EXISTS (SELECT 1 FROM track_artists ta JOIN artists x ON x.id = ta.artist_id
                              WHERE ta.track_id = t.id AND lower(x.name) = lower(%(artist)s)))
            ORDER BY t.id LIMIT %(n)s""",
        {"a": _acct(collection_name), "title": title, "artist": artist, "n": limit},
    )
    return [_track_row(r) for r in got]


def tracks_by_ids(
    collection_name: str, ids: list[str], *, with_lyrics: bool = False
) -> dict[str, dict[str, Any]]:
    good = []
    for i in ids:
        try:
            good.append(uuid.UUID(str(i)))
        except ValueError:
            continue
    lyr = ", ly.text AS lyrics" if with_lyrics else ""
    join = " LEFT JOIN lyrics ly ON ly.media_file_id = t.media_file_id" if with_lyrics else ""
    got = dicts(
        f"SELECT {TRACK_COLS}{lyr} {TRACK_FROM}{join} WHERE t.id = ANY(%(ids)s) AND t.account_id = %(a)s AND t.deleted_at IS NULL",
        {"ids": good, "a": _acct(collection_name)},
    )
    return {r["track_id"]: _track_row(r) for r in got}


def artist_image(collection_name: str, slug: str) -> str | None:
    """The artist's image id, when the account has a track by them."""
    got = rows(
        f"SELECT coalesce(ar.image_id, ar.cutout_id) FROM artists ar WHERE ar.slug = %(slug)s AND {OWNS_ARTIST}",
        {"a": _acct(collection_name), "slug": slug},
    )
    return got[0][0] if got else None


def artist_id(slug: str) -> str | None:
    got = rows("SELECT id::text FROM artists WHERE slug = %(s)s", {"s": slug})
    return got[0][0] if got else None


def fuzzy_tracks(collection_name: str, query: str, limit: int = 3) -> list[dict[str, Any]]:
    """v1 `catalog_search_service.search_catalog_tracks` for the playlist resolver:
    title similarity over the account's tracks (the same folded key the catalog
    search indexes), best first."""
    return dicts(
        """SELECT t.id::text AS track_id, t.title, t.artist_display AS artist, t.year
           FROM tracks t WHERE t.account_id = %(a)s AND t.deleted_at IS NULL
             AND musix_key(coalesce(t.title_display, t.title)) %% musix_key(%(q)s)
           ORDER BY similarity(musix_key(coalesce(t.title_display, t.title)), musix_key(%(q)s)) DESC, t.id
           LIMIT %(n)s""",
        {"a": _acct(collection_name), "q": query, "n": limit},
    )


# ── the discoveries rail (v1 discoveries_service readers) ──────────────────────


def light_points(collection_name: str) -> list[tuple[str, dict[str, Any]]]:
    """v1 `qdrant_utils.light_points`: (track id, {title, artist, cover_art_path,
    primary_artist_slug}) for every live track of the account."""
    got = dicts(
        f"""SELECT t.id::text AS track_id, t.title, t.artist_display AS artist, t.cover_image_id AS cover_art_path,
                   pa.slug AS primary_artist_slug {TRACK_FROM} WHERE t.account_id = %(a)s AND t.deleted_at IS NULL""",
        {"a": _acct(collection_name)},
    )
    return [(r.pop("track_id"), r) for r in got]


def in_library_sample_links(collection_name: str) -> list[dict[str, Any]]:
    """facts_v2 links whose BOTH sides are songs of this account (two covers)."""
    return dicts(
        f"""SELECT s.slug AS src_slug, s.title AS src_title, sa_.slug AS src_artist_slug,
                   d.slug AS dst_slug, d.title AS dst_title, da.slug AS dst_artist_slug,
                   CASE WHEN r.kind = 'interpolation' THEN 'interpolation' ELSE 'sample' END AS relation, r.evidence
            FROM song_relations r JOIN songs s ON s.id = r.song_id JOIN songs d ON d.id = r.target_song_id
            LEFT JOIN artists sa_ ON sa_.id = s.primary_artist_id LEFT JOIN artists da ON da.id = d.primary_artist_id
            WHERE r.source = 'facts' AND r.kind IN ('sample', 'interpolation') AND d.id <> s.id AND {OWNS_SONG}
              AND EXISTS (SELECT 1 FROM tracks o WHERE o.account_id = %(a)s AND o.song_id = d.id AND o.deleted_at IS NULL)""",
        {"a": _acct(collection_name)},
    )


def outgoing_sample_links(collection_name: str) -> list[dict[str, Any]]:
    """facts_v2 links of the account's songs, the other side owned or not."""
    got = dicts(
        f"""SELECT s.slug AS src_slug, r.target_text, d.slug AS dst_slug,
                   CASE WHEN r.kind = 'interpolation' THEN 'interpolation' ELSE 'sample' END AS relation
            FROM song_relations r JOIN songs s ON s.id = r.song_id LEFT JOIN songs d ON d.id = r.target_song_id
            WHERE r.source = 'facts' AND r.kind IN ('sample', 'interpolation')
              AND (d.id IS NULL OR d.id <> s.id) AND {OWNS_SONG}""",
        {"a": _acct(collection_name)},
    )
    out = []
    for r in got:
        artist, song = _split(r.pop("target_text"))
        out.append({**r, "dst_title": song, "dst_artist": artist})
    return out


def artist_slugs_with_bio(collection_name: str, lang: str) -> list[str]:
    got = rows(
        f"""SELECT ar.slug FROM artist_bios b JOIN artists ar ON ar.id = b.artist_id
            WHERE b.lang = %(lang)s AND b.text <> '' AND {OWNS_ARTIST}""",
        {"a": _acct(collection_name), "lang": lang},
    )
    return [r[0] for r in got]
