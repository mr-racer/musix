import datetime as dt
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request, Response
from procrastinate.exceptions import AlreadyEnqueued
from pydantic import Field

from musix.api.deps import Auth, Keys, Session
from musix.contexts.imports import yandex
from musix.errors import Conflict, Invalid
from musix.schemas import Model

router = APIRouter(prefix="/imports/yandex", tags=["imports"])


class LinkOut(Model):
    linked: bool
    login: str | None
    linked_at: dt.datetime | None


class AuthOut(Model):
    session_id: uuid.UUID
    status: str  # pending | authorized | expired | error
    user_code: str
    verification_url: str
    expires_at: dt.datetime
    reason: str | None


class SourceOut(Model):
    source: Any  # "likes" | {"kind": N}
    title: str
    track_count: int
    cover: str | None
    playlist_id: uuid.UUID | None = None  # the MusiX playlist made for it by an import
    synced_at: dt.datetime | None = None  # its last import


class YandexTrackOut(Model):
    id: str
    title: str
    artists: list[str]
    album: str | None
    duration_ms: int | None
    cover: str | None
    available: bool
    imported: bool  # this account has it (from Yandex, or the same song otherwise)
    # imported | new | failed (a network error: the next import tries again) |
    # unavailable (Yandex refused it) | removed (imported, then deleted here: pickable again)
    state: Literal["imported", "new", "failed", "unavailable", "removed"]
    reason: str | None = None
    track_id: uuid.UUID | None = None  # the MusiX track, when `imported`
    in_playlist: bool = False  # already placed in the source's MusiX playlist


class ImportIn(Model):
    sources: list[Any] = Field(min_length=1, max_length=50)  # "likes" | {"kind": N}
    # only these Yandex track ids from the sources (the web's track picker); None = all
    tracks: list[str] | None = Field(default=None, max_length=20_000)


class ImportAccepted(Model):
    job_id: str


@router.get("", response_model=LinkOut)
async def link(p: Auth, s: Session) -> Any:
    return await yandex.link_status(s, p.account_id)


@router.delete("", status_code=204)
async def unlink(p: Auth, s: Session) -> Response:
    await yandex.unlink(s, p.account_id)
    return Response(status_code=204)


@router.post("/auth", response_model=AuthOut, status_code=201)
async def start_auth(p: Auth, s: Session, keys: Keys) -> Any:
    """Device flow: show `userCode` at `verificationUrl`, then poll the session."""
    return await yandex.start_auth(s, keys.fernet, p.account_id)


@router.get("/auth/{session_id}", response_model=AuthOut)
async def poll_auth(session_id: uuid.UUID, p: Auth, s: Session, keys: Keys) -> Any:
    """One token check per call; poll every couple of seconds while `pending`."""
    return await yandex.poll_auth(s, keys.fernet, p.account_id, session_id)


@router.get("/sources", response_model=list[SourceOut])
async def sources(p: Auth, s: Session, keys: Keys) -> Any:
    """«Мне нравится» first, then the account's playlists."""
    return await yandex.sources(s, keys.fernet, p.account_id)


class FreshOut(Model):
    source: Any  # "likes" | {"kind": N}
    fresh: int  # what a top-up would bring
    track_count: int


@router.get("/fresh", response_model=list[FreshOut])
async def fresh(p: Auth, s: Session, keys: Keys) -> Any:
    """The mirrored sources' new songs: the «+N» of «Обновить из Яндекса» in the library."""
    return await yandex.fresh(s, keys.fernet, p.account_id)


@router.get("/tracks", response_model=list[YandexTrackOut])
async def tracks(
    p: Auth,
    s: Session,
    keys: Keys,
    source: Annotated[str, Query(description='"likes" or a playlist kind', max_length=20)],
) -> Any:
    """One source's tracks, in its order, for picking what to import."""
    if source == "likes":
        src: Any = "likes"
    elif source.isdigit():
        src = {"kind": int(source)}
    else:
        raise Invalid('source must be "likes" or a playlist kind')
    return await yandex.source_tracks(s, keys.fernet, p.account_id, src)


@router.post("/import", response_model=ImportAccepted, status_code=202)
async def start_import(body: ImportIn, p: Auth, s: Session, request: Request) -> Any:
    """Downloads into the library and into one MusiX playlist per source; progress as
    `job.progress` / `job.done` events (`state: "error"` when the job itself failed).
    One import per account at a time: `lock` keeps a second from running beside the
    first (they would fetch the same tracks), `queueing_lock` refuses a third (409)."""
    if not (await yandex.link_status(s, p.account_id))["linked"]:
        raise yandex.NotLinked("yandex account not linked")
    for src in body.sources:
        yandex.source_key(src)
    job = f"yandex:{uuid.uuid4().hex[:12]}"
    lock = f"imports:yandex:{p.account_id}"
    try:
        await request.app.state.queue.configure_task(
            "imports:yandex", lock=lock, queueing_lock=lock
        ).defer_async(
            account_id=str(p.account_id), job=job, sources=body.sources, tracks=body.tracks
        )
    except AlreadyEnqueued as e:
        raise Conflict("an import is already waiting for this account") from e
    return ImportAccepted(job_id=job)
