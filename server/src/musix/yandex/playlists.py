"""List a user's import sources and resolve a source into full Track objects.

Two source kinds:
  - "likes"      → the user's «Мне нравится» (``users_likes_tracks``), which has no
                   ``kind`` so it is exposed as a synthetic source.
  - {"kind": N}  → a regular user playlist (``users_playlists``).

``resolve_tracks`` returns *full* ``Track`` objects (batched via ``client.tracks``)
so the downloader has download-info + metadata in hand.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

LIKES_TITLE = "Мне нравится"


def _cover_uri(obj) -> str | None:
    cover = getattr(obj, "cover", None)
    uri = getattr(cover, "uri", None) if cover else None
    return f"https://{uri.replace('%%', '400x400')}" if uri else None


def list_sources(client) -> list[dict]:
    """Return selectable import sources: «Мне нравится» first, then playlists."""
    sources: list[dict] = []

    # Likes — count is the length of the TrackShort list.
    try:
        likes = client.users_likes_tracks()
        likes_count = len(likes.tracks) if likes and likes.tracks else 0
        sources.append(
            {
                "source": "likes",
                "title": LIKES_TITLE,
                "track_count": likes_count,
                "cover": None,
            }
        )
    except Exception:
        logger.warning("[yandex/playlists] failed to read likes", exc_info=True)

    # Regular playlists.
    try:
        for pl in client.users_playlists_list() or []:
            sources.append(
                {
                    "source": {"kind": pl.kind},
                    "title": pl.title,
                    "track_count": pl.track_count or 0,
                    "cover": _cover_uri(pl),
                }
            )
    except Exception:
        logger.warning("[yandex/playlists] failed to list playlists", exc_info=True)

    return sources


def track_row(t) -> dict:
    """One track for the import picker (the web lists a source's tracks to choose from)."""
    album = (t.albums or [None])[0]
    uri = getattr(t, "cover_uri", None)
    return {
        "id": str(t.id),
        "title": t.title or "",
        "artists": [a.name for a in (t.artists or []) if getattr(a, "name", None)],
        "album": getattr(album, "title", None),
        "duration_ms": getattr(t, "duration_ms", None),
        "cover": f"https://{uri.replace('%%', '200x200')}" if uri else None,
        "available": getattr(t, "available", True) is not False,
    }


def _short_to_id(ts) -> str | int | None:
    """Best id for ``client.tracks`` from a TrackShort (prefer 'track:album')."""
    tid = getattr(ts, "track_id", None) or getattr(ts, "id", None)
    return tid


BATCH = 200  # one `client.tracks` call for a 3000-track «Мне нравится» timed out (prod, v1 data)


def _tracks_with_retry(client, ids: list, tries: int = 3) -> list:
    import time

    from yandex_music.exceptions import NetworkError

    for attempt in range(tries):
        try:
            return client.tracks(ids) or []
        except NetworkError:  # TimedOutError is one; UnauthorizedError is not retried
            if attempt == tries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
    return []


def _resolve_short_list(client, shorts: list) -> list:
    """Batch-fetch full Track objects for a list of TrackShort, order-preserving."""
    ids = [i for i in (_short_to_id(ts) for ts in shorts) if i is not None]
    out: list = []
    for i in range(0, len(ids), BATCH):
        out.extend(_tracks_with_retry(client, ids[i : i + BATCH]))
    return out


def resolve_source(client, source) -> tuple[str, list]:
    """(title, full ``Track`` objects in the source's order) for "likes" | {"kind": N}."""
    if source == "likes":
        likes = client.users_likes_tracks()
        shorts = list(likes.tracks) if likes and likes.tracks else []
        return LIKES_TITLE, _resolve_short_list(client, shorts)

    if isinstance(source, dict) and "kind" in source:
        playlist = client.users_playlists(source["kind"])
        if isinstance(playlist, list):
            playlist = playlist[0] if playlist else None
        shorts = list(playlist.tracks) if playlist and playlist.tracks else []
        title = (getattr(playlist, "title", None) or "").strip() or "Плейлист из Яндекса"
        return title, _resolve_short_list(client, shorts)

    raise ValueError(f"unknown import source: {source!r}")


def resolve_tracks(client, source) -> list:
    """Return full ``Track`` objects for ``source`` ("likes" | {"kind": N})."""
    return resolve_source(client, source)[1]
