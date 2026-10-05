import contextlib
import uuid
from pathlib import Path
from typing import Annotated, Any

import sqlalchemy as sa
from fastapi import APIRouter, Header, Query, Request, Response
from procrastinate.exceptions import AlreadyEnqueued

from musix.api import etag
from musix.api.deps import Auth, Owner, Session
from musix.contexts.library import schemas as S
from musix.contexts.library import service
from musix.contexts.library.models import jobs
from musix.errors import Invalid, NotFound
from musix.schemas import ID_LIST

router = APIRouter(tags=["library"])


def _queue(request: Request):  # type: ignore[no-untyped-def]
    return request.app.state.queue


@router.post("/library/scan", response_model=S.JobOut, status_code=202)
async def scan(body: S.ScanIn, p: Owner, s: Session, request: Request) -> S.JobOut:
    root = Path(body.path)
    if not root.is_absolute() or ".." in root.parts:  # the roots check below must mean it
        raise Invalid("path must be absolute, without '..'")
    roots = [Path(r) for r in request.app.state.settings.library_roots]
    if not any(root.is_relative_to(r) for r in roots):
        raise Invalid("path is outside the library roots", roots=[str(r) for r in roots])
    target = body.account_id or p.account_id
    # the progress row is created here, so the id the client gets is the one its
    # `job.progress` events carry
    job = await s.scalar(
        sa.insert(jobs).values(account_id=target, kind="scan", total=0).returning(jobs.c.id)
    )
    await s.commit()
    await (
        _queue(request)
        .configure_task("library:scan_folder")
        .defer_async(
            account_id=str(target),
            root=str(root),
            job_id=str(job),
            watcher=str(p.account_id) if p.account_id != target else None,
        )
    )
    return S.JobOut(job=str(job))


@router.post("/uploads", response_model=S.UploadOut, status_code=201)
async def start_upload(body: S.UploadIn, p: Auth, s: Session, request: Request) -> S.UploadOut:
    out, existing = await service.start_upload(s, p.account_id, body)
    if existing:
        await (
            _queue(request)
            .configure_task("library:register_existing")
            .defer_async(account_id=str(p.account_id), media_file_id=str(existing))
        )
    return out


@router.patch(
    "/uploads/{upload_id}",
    response_model=S.UploadOut,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/offset+octet-stream": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
        }
    },
)
async def upload_chunk(
    upload_id: uuid.UUID,
    p: Auth,
    s: Session,
    request: Request,
    upload_offset: Annotated[int, Header()],
) -> S.UploadOut:
    out = await service.append_chunk(
        s,
        Path(request.app.state.settings.media_dir),
        p.account_id,
        upload_id,
        upload_offset,
        await request.body(),
    )
    if out.state == "verifying":
        await (
            _queue(request)
            .configure_task("library:finalize_upload")
            .defer_async(upload_id=str(upload_id))
        )
    return out


@router.get("/uploads/{upload_id}", response_model=S.UploadOut)
async def get_upload(upload_id: uuid.UUID, p: Auth, s: Session) -> S.UploadOut:
    return await service.get_upload(s, p.account_id, upload_id)


@router.get("/tracks/by-hash", response_model=dict[str, uuid.UUID])
async def tracks_by_hash(
    p: Auth, s: Session, h: Annotated[str, Query(description="comma-separated sha256, ≤ 200")]
) -> dict[str, uuid.UUID]:
    """The account's live tracks by their file's content hash: how a desktop client links the
    files on its disk to the server's tracks (dedup is by content, never by name)."""
    from musix.contexts.library.models import media_files, tracks

    hexdigits = set("0123456789abcdef")
    hashes = [x for x in h.lower().split(",") if len(x) == 64 and set(x) <= hexdigits]
    if not hashes:
        return {}
    T, M = tracks.c, media_files.c
    q = (
        sa.select(M.sha256, T.id)
        .join(media_files, M.id == T.media_file_id)
        .where(T.account_id == p.account_id, T.deleted_at.is_(None), M.sha256.in_(hashes[:200]))
    )
    return {sha: tid for sha, tid in (await s.execute(q)).all()}


@router.get("/tracks", response_model=list[S.TrackOut], responses=etag.NOT_MODIFIED)
async def get_tracks(
    p: Auth,
    s: Session,
    request: Request,
    response: Response,
    ids: Annotated[str, Query(description="comma-separated, ≤ 200", **ID_LIST)],
) -> Any:
    try:
        parsed = [uuid.UUID(x) for x in ids.split(",") if x][:200]
    except ValueError as e:
        raise Invalid("ids must be uuids") from e
    tag = await etag.tag_for(request, p.account_id, f"tracks:{sorted(parsed)}")
    return await etag.conditional(
        request, response, tag, lambda: service.get_tracks(s, p.account_id, parsed)
    )


SPECTRUM_MAGIC = b"MXS2"  # = intel.envelope.SPEC_MAGIC (numpy stays out of the API's imports)


async def _bands(kind: str, track_id: uuid.UUID, p: Auth, s: Session, request: Request) -> Response:
    """The packed bands of a track (`envelope` or `spectrum`). Immutable per media file, so
    they are cached for a year under the file's sha. A track without them yet gets a 404 and
    a low-priority job (migrated files, and files older than the spectrum, have none). A
    spectrum of the first format (no `MXS2` magic) counts as missing: it is recomputed."""
    row = await service.envelope(s, p.account_id, track_id, kind)
    if row is not None and kind == "spectrum" and row[1][:4] != SPECTRUM_MAGIC:
        row = None
    if row is None:
        mf = await service.media_file_of(s, p.account_id, track_id)
        if mf is not None:
            # already waiting (a backfill, or the previous ask 4 s ago) is the state we want:
            # the queue refuses a second job under the same lock, and that is not an error
            with contextlib.suppress(AlreadyEnqueued):
                await (
                    _queue(request)
                    .configure_task(
                        f"intel:{kind}", queueing_lock=f"intel:{kind}:{mf}", priority=-5
                    )
                    .defer_async(media_file_id=str(mf))
                )
        raise NotFound(f"no {kind} for this track yet")
    sha, blob = row
    tag = f'"{sha}"' if kind == "envelope" else f'"{sha}-{kind}2"'
    headers = {"ETag": tag, "Cache-Control": "private, max-age=31536000, immutable"}
    if request.headers.get("if-none-match") == tag:
        return Response(status_code=304, headers=headers)
    return Response(blob, media_type="application/octet-stream", headers=headers)


@router.get(
    "/tracks/{track_id}/envelope",
    response_class=Response,
    responses={
        200: {
            "content": {"application/octet-stream": {}},
            "description": "zlib(uint8 frames × 4 bands), 10 fps",
        },
        **etag.NOT_MODIFIED,
    },
)
async def get_envelope(track_id: uuid.UUID, p: Auth, s: Session, request: Request) -> Response:
    """The energy envelope (phase 4 spec §4): zlib of uint8 frames × 4 bands, 10 frames/s
    (contexts/intel/envelope). Kept for the apps already installed; the players now draw
    the spectrum."""
    return await _bands("envelope", track_id, p, s, request)


@router.get(
    "/tracks/{track_id}/spectrum",
    response_class=Response,
    responses={
        200: {
            "content": {"application/octet-stream": {}},
            "description": "zlib(uint8 frames × 16 bands), 10 fps",
        },
        **etag.NOT_MODIFIED,
    },
)
async def get_spectrum(track_id: uuid.UUID, p: Auth, s: Session, request: Request) -> Response:
    """The spectrum the players draw above the seek line (design refresh spec §6.2): zlib of
    uint8 frames × 16 log-spaced bands, 40 Hz – 12 kHz, 10 frames/s; lows first."""
    return await _bands("spectrum", track_id, p, s, request)
