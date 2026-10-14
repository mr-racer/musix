"""«Мои данные» in the settings: the listener's own data as one zip — the listening history
and the library as CSV (opens in any spreadsheet), each playlist as M3U (opens in any player
that has the same files; the line under #EXTINF is the file's own name)."""

from __future__ import annotations

import csv
import io
import re
import uuid
import zipfile
from pathlib import PurePath

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.library.models import albums, media_files, tracks
from musix.contexts.listening.models import listen_events
from musix.contexts.playlists.models import playlist_items, playlists


def _csv(header: list[str], rows: list[list[object]]) -> bytes:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(header)
    w.writerows(rows)
    return ("﻿" + out.getvalue()).encode()  # the BOM: Excel reads it as UTF-8


async def build(s: AsyncSession, account_id: uuid.UUID) -> bytes:
    T, A, M, L = tracks.c, albums.c, media_files.c, listen_events.c
    lib = (
        await s.execute(
            sa.select(
                T.id,
                T.title,
                T.artist_display,
                A.title.label("album"),
                T.year,
                T.genre,
                T.duration_ms,
                T.added_at,
                M.path,
            )
            .outerjoin(albums, A.id == T.album_id)
            .join(media_files, M.id == T.media_file_id)
            .where(T.account_id == account_id, T.deleted_at.is_(None))
            .order_by(T.artist_display, A.title, T.disc_no, T.track_no)
        )
    ).all()
    by_id = {r.id: r for r in lib}
    history = (
        await s.execute(
            sa.select(L.started_at, L.track_id, L.played_ms, L.end_reason, L.skipped_early)
            .where(L.account_id == account_id)
            .order_by(L.started_at)
        )
    ).all()
    lists = (
        await s.execute(
            sa.select(playlists.c.id, playlists.c.name)
            .where(playlists.c.account_id == account_id, playlists.c.deleted_at.is_(None))
            .order_by(playlists.c.created_at)
        )
    ).all()
    items = (
        await s.execute(
            sa.select(playlist_items.c.playlist_id, playlist_items.c.track_id)
            .where(
                playlist_items.c.playlist_id.in_([p.id for p in lists]),
                playlist_items.c.deleted_at.is_(None),
            )
            .order_by(playlist_items.c.playlist_id, playlist_items.c.position)
        )
    ).all()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            "library.csv",
            _csv(
                ["artist", "title", "album", "year", "genre", "duration_s", "added_at", "file"],
                [
                    [
                        r.artist_display,
                        r.title,
                        r.album or "",
                        r.year or "",
                        r.genre or "",
                        round((r.duration_ms or 0) / 1000),
                        r.added_at.isoformat() if r.added_at else "",
                        PurePath(r.path).name,
                    ]
                    for r in lib
                ],
            ),
        )
        z.writestr(
            "history.csv",
            _csv(
                ["started_at", "artist", "title", "album", "played_s", "end", "skipped"],
                [
                    [
                        h.started_at.isoformat(),
                        *(
                            (t.artist_display, t.title, t.album or "")
                            if (t := by_id.get(h.track_id))
                            else ("", "", "")
                        ),
                        round(h.played_ms / 1000),
                        h.end_reason,
                        "yes" if h.skipped_early else "",
                    ]
                    for h in history
                ],
            ),
        )
        seen: set[str] = set()
        for p in lists:
            name = re.sub(r'[\\/:*?"<>|]+', "_", p.name).strip() or "playlist"
            while name.lower() in seen:
                name += "_"
            seen.add(name.lower())
            lines = ["#EXTM3U", f"#PLAYLIST:{p.name}"]
            for it in items:
                if it.playlist_id != p.id or (t := by_id.get(it.track_id)) is None:
                    continue
                lines.append(
                    f"#EXTINF:{round((t.duration_ms or 0) / 1000)},{t.artist_display} - {t.title}"
                )
                lines.append(PurePath(t.path).name)
            z.writestr(f"playlists/{name}.m3u", "\n".join(lines) + "\n")
    return buf.getvalue()
