import datetime as dt
import uuid
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import Field

from musix.api.deps import Auth, Keys, Session
from musix.contexts.imports import yandex
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


class ImportIn(Model):
    sources: list[Any] = Field(min_length=1, max_length=50)  # "likes" | {"kind": N}


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


@router.post("/import", response_model=ImportAccepted, status_code=202)
async def start_import(body: ImportIn, p: Auth, s: Session, request: Request) -> Any:
    """Downloads into the library; progress as `job.progress` / `job.done` events."""
    await yandex.link_status(s, p.account_id)
    job = f"yandex:{uuid.uuid4().hex[:12]}"
    await request.app.state.queue.configure_task(
        "imports:yandex", queueing_lock=f"imports:yandex:{p.account_id}"
    ).defer_async(account_id=str(p.account_id), job=job, sources=body.sources)
    return ImportAccepted(job_id=job)
