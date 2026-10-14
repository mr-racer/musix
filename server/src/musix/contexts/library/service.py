"""Library use cases on the API side: grants, uploads, batch reads. Heavy work (hashing,
probing, tags) is enqueued for the worker; the API only appends upload chunks to disk."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Iterable
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.library import schemas as S
from musix.contexts.library.models import (
    albums,
    artists,
    media_files,
    track_artists,
    tracks,
    uploads,
)
from musix.errors import Conflict, Invalid, NotFound

MAX_CHUNK = 16 * 1024 * 1024


async def start_upload(
    s: AsyncSession, account_id: uuid.UUID, body: S.UploadIn
) -> tuple[S.UploadOut, uuid.UUID | None]:
    """Returns the upload and, when the content is already on the server but not in this
    account, the media file to register for it (the transfer is skipped entirely; the upload
    row, born `verifying`, lets the client follow it like any other)."""
    known = await s.scalar(
        sa.select(media_files.c.id).where(
            media_files.c.sha256 == body.sha256, media_files.c.state != "failed"
        )
    )
    if known:
        own = await s.scalar(
            sa.select(tracks.c.id).where(
                tracks.c.account_id == account_id,
                tracks.c.media_file_id == known,
                tracks.c.deleted_at.is_(None),
            )
        )
        if own:  # already in this library: nothing to do
            return S.UploadOut(exists=True, state="done", track_id=own), None
    uid = await s.scalar(
        sa.insert(uploads)
        .values(
            account_id=account_id,
            sha256=body.sha256,
            size_bytes=body.size,
            filename=body.filename,
            **({"state": "verifying", "offset_bytes": body.size} if known else {}),
        )
        .returning(uploads.c.id)
    )
    await s.commit()
    if known:
        return S.UploadOut(id=uid, exists=True, offset=body.size, state="verifying"), uuid.UUID(
            str(known)
        )
    return S.UploadOut(id=uid), None


def _append(part: Path, data: bytes) -> None:
    part.parent.mkdir(parents=True, exist_ok=True)
    with part.open("ab") as f:
        f.write(data)


async def append_chunk(
    s: AsyncSession,
    media_dir: Path,
    account_id: uuid.UUID,
    upload_id: uuid.UUID,
    offset: int,
    data: bytes,
) -> S.UploadOut:
    up = (
        await s.execute(
            sa.select(uploads)
            .where(uploads.c.id == upload_id, uploads.c.account_id == account_id)
            .with_for_update()
        )
    ).first()
    if up is None:
        raise NotFound("upload")
    if up.state != "receiving":
        raise Conflict(f"upload is {up.state}")
    if offset != up.offset_bytes:  # the client resumes from the server's offset
        raise Conflict("offset mismatch", offset=up.offset_bytes)
    if not data:
        raise Invalid("empty chunk")
    if len(data) > MAX_CHUNK or offset + len(data) > up.size_bytes:
        raise Invalid("chunk too large")
    await asyncio.to_thread(_append, media_dir / "uploads" / f"{upload_id}.part", data)
    new = offset + len(data)
    state = "verifying" if new == up.size_bytes else "receiving"
    await s.execute(
        sa.update(uploads)
        .where(uploads.c.id == upload_id)
        .values(offset_bytes=new, state=state, updated_at=sa.func.now())
    )
    await s.commit()
    return S.UploadOut(id=upload_id, offset=new, state=state)


async def get_upload(s: AsyncSession, account_id: uuid.UUID, upload_id: uuid.UUID) -> S.UploadOut:
    up = (
        await s.execute(
            sa.select(uploads).where(uploads.c.id == upload_id, uploads.c.account_id == account_id)
        )
    ).first()
    if up is None:
        raise NotFound("upload")
    return S.UploadOut(id=up.id, offset=up.offset_bytes, state=up.state)


async def upload_statuses(
    s: AsyncSession, account_id: uuid.UUID, ids: list[uuid.UUID]
) -> list[S.UploadStatus]:
    """Where each upload is now, read from the rows the pipeline already writes: the upload,
    its track's media file (`state`, `intel_state`) and the song's `knowledge_at`."""
    from musix.contexts.knowledge.models import facts
    from musix.contexts.library.models import songs

    U, T, M = uploads.c, tracks.c, media_files.c
    n_facts = (
        sa.select(sa.func.count())
        .where(facts.c.subject_kind == "song", facts.c.subject_id == T.song_id)
        .scalar_subquery()
    )
    q = (
        sa.select(
            U.id,
            U.state,
            U.error,
            U.track_id,
            M.state.label("media"),
            M.intel_state,
            songs.c.knowledge_at,
            n_facts.label("facts"),
        )
        .select_from(uploads)
        .outerjoin(tracks, T.id == U.track_id)
        .outerjoin(media_files, M.id == T.media_file_id)
        .outerjoin(songs, songs.c.id == T.song_id)
        .where(U.account_id == account_id, U.id.in_(ids))
    )
    out = []
    for r in await s.execute(q):
        st = S.UploadStatus(id=r.id, stage="send", track_id=r.track_id, facts=r.facts or 0)
        if r.state == "failed" or r.media == "failed":
            st.stage = "error"
            st.error = "mismatch" if r.error == "sha256 mismatch" else "unreadable"
        elif r.state in ("verifying", "done") and r.track_id is None:
            st.stage = "sound"
        elif r.track_id is not None:
            # a failed CLAP never holds the song: it plays without its sound map
            sounded = r.media == "media_done" and r.intel_state in ("indexed", "failed")
            st.stage = "sound" if not sounded else "facts" if r.knowledge_at is None else "done"
        out.append(st)
    return out


async def get_tracks(
    s: AsyncSession, account_id: uuid.UUID, ids: list[uuid.UUID]
) -> list[S.TrackOut]:
    """Batch read. Filtered by account at the repo level: never another account's track."""
    rows = (
        await s.execute(
            sa.select(tracks, albums.c.title.label("album_title"))
            .outerjoin(albums, albums.c.id == tracks.c.album_id)
            .where(
                tracks.c.account_id == account_id,
                tracks.c.id.in_(ids),
                tracks.c.deleted_at.is_(None),
            )
        )
    ).all()
    ta = (
        (
            await s.execute(
                sa.select(
                    track_artists.c.track_id, artists.c.id, artists.c.name, track_artists.c.role
                )
                .join(artists, artists.c.id == track_artists.c.artist_id)
                .where(track_artists.c.track_id.in_([r.id for r in rows]))
                .order_by(
                    track_artists.c.role != "main", track_artists.c.position
                )  # main first, then feat
            )
        ).all()
        if rows
        else []
    )
    by: dict[uuid.UUID, list[S.TrackArtist]] = {}
    for t in ta:
        by.setdefault(t.track_id, []).append(S.TrackArtist(id=t.id, name=t.name, role=t.role))
    return [
        S.TrackOut(
            id=r.id,
            title=r.title,
            title_display=r.title_display,
            artist_display=r.artist_display,
            artists=by.get(r.id, []),
            album_id=r.album_id,
            album=r.album_title,
            year=r.year,
            genre=r.genre,
            track_no=r.track_no,
            disc_no=r.disc_no,
            duration_ms=r.duration_ms,
            cover_image_id=r.cover_image_id,
            added_at=r.added_at,
        )
        for r in rows
    ]


async def own_track_ids(
    s: AsyncSession, account_id: uuid.UUID, ids: Iterable[uuid.UUID]
) -> set[uuid.UUID]:
    """The subset of `ids` that are this account's tracks (other contexts check refs here)."""
    rows: Iterable[uuid.UUID] = await s.scalars(
        sa.select(tracks.c.id).where(tracks.c.account_id == account_id, tracks.c.id.in_(set(ids)))
    )
    return set(rows)


async def envelope(
    s: AsyncSession, account_id: uuid.UUID, track_id: uuid.UUID, kind: str = "envelope"
) -> tuple[str, bytes] | None:
    """(media sha, packed bands) of a live track of this account, or None. `kind` names the
    column: the 4-band `envelope` or the 16-band `spectrum`."""
    row = (
        await s.execute(
            sa.select(media_files.c.sha256, media_files.c[kind].label("blob"))
            .join(tracks, tracks.c.media_file_id == media_files.c.id)
            .where(
                tracks.c.id == track_id,
                tracks.c.account_id == account_id,
                tracks.c.deleted_at.is_(None),
            )
        )
    ).first()
    if row is None or row.blob is None:
        return None
    return row.sha256, bytes(row.blob)


async def media_file_of(
    s: AsyncSession, account_id: uuid.UUID, track_id: uuid.UUID
) -> uuid.UUID | None:
    return await s.scalar(
        sa.select(tracks.c.media_file_id).where(
            tracks.c.id == track_id,
            tracks.c.account_id == account_id,
            tracks.c.deleted_at.is_(None),
        )
    )
