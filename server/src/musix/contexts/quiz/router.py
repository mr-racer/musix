import hashlib
import hmac
import mimetypes
import time
import uuid
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

from musix.api.deps import Auth, Session
from musix.contexts.media.delivery import load_images, sign
from musix.contexts.quiz import schemas as S
from musix.contexts.quiz import service
from musix.errors import Conflict, NotFound, Unauthorized
from musix.quiz.errors import AlreadyAnswered, NoRoundAvailable, RoundNotFound

router = APIRouter(prefix="/quiz", tags=["quiz"])
# <audio> sends no Authorization header: the snippet route checks a signature instead
public = APIRouter(prefix="/quiz", tags=["quiz"])
AUDIO_TTL = int(service.ROUND_TTL_SEC) + 60


def _audio(
    request: Request, account_id: uuid.UUID, round_id: uuid.UUID, option_id: str | None = None
) -> str:
    st = request.app.state
    path = f"/api/v2/quiz/rounds/{round_id}/audio/{account_id}" + (
        f"/{option_id}" if option_id else ""
    )
    return str(st.settings.public_base_url) + sign(st.secrets.media_hmac, path, AUDIO_TTL)


@router.get("/modes", response_model=list[S.QuizMode])
async def modes(p: Auth, s: Session) -> Any:
    """Every mode with its pool size; an unavailable one is listed, not hidden."""
    return await service.list_modes(s, p.account_id)


@router.post("/rounds", response_model=S.RoundOut)
async def create_round(body: S.RoundIn, p: Auth, s: Session, request: Request) -> Any:
    try:
        built = await service.build_round(s, p.account_id, body.mode, body.snippet_sec)
    except NoRoundAvailable as e:
        raise Conflict(str(e)) from e  # a thin library is a normal state, said in plain words
    rid = built["round_id"]
    if built["option_audio"]:
        for o in built["options"]:
            o["audioUrl"] = _audio(request, p.account_id, rid, o.get("option_id"))
    built["audio_url"] = _audio(request, p.account_id, rid) if built["has_audio"] else None
    prompt = (built.get("meta") or {}).get("prompt") or {}
    covers = [o.get("cover_art_path") for o in built["options"]] + [prompt.get("cover_art_path")]
    built["images"] = await _images(request, s, covers)
    return built


async def _images(request: Request, s: Any, ids: list[Any]) -> dict[str, Any]:
    st = request.app.state
    wanted = [i for i in ids if isinstance(i, str) and i]
    return await load_images(s, str(st.settings.public_base_url), st.secrets.media_hmac, wanted)


@router.post("/rounds/{round_id}/answer", response_model=S.AnswerOut)
async def answer(
    round_id: uuid.UUID, body: S.AnswerIn, p: Auth, s: Session, request: Request
) -> Any:
    """Single-use. Writes no listen and no signal (I-1/I-2)."""
    try:
        out = await service.submit_answer(
            s, p.account_id, round_id, body.model_dump(exclude_none=True)
        )
    except RoundNotFound as e:
        raise NotFound("round") from e
    except AlreadyAnswered as e:
        raise Conflict("round already answered") from e
    out["images"] = await _images(request, s, [out["truth"].get("cover_art_path")])
    return out


def _check(request: Request, e: int, sig: str) -> None:
    secret = request.app.state.secrets.media_hmac
    want = hmac.new(secret, f"{request.url.path}{e}".encode(), hashlib.sha256).hexdigest()
    if e < time.time() or not hmac.compare_digest(want, sig):
        raise Unauthorized("bad or expired audio signature")


async def _serve(
    s: Any, account_id: uuid.UUID, round_id: uuid.UUID, option_id: str | None
) -> FileResponse:
    try:
        path = await service.round_audio(s, account_id, round_id, option_id)
    except RoundNotFound as e:
        raise NotFound("round") from e
    # no filename: "Artist - Title.flac" in Content-Disposition would give the answer away (v1)
    return FileResponse(
        path, media_type=mimetypes.guess_type(path)[0] or "application/octet-stream"
    )


@public.get("/rounds/{round_id}/audio/{account_id}", include_in_schema=False)
async def round_audio(
    round_id: uuid.UUID, account_id: uuid.UUID, e: int, s: str, db: Session, request: Request
) -> Any:
    _check(request, e, s)
    return await _serve(db, account_id, round_id, None)


@public.get("/rounds/{round_id}/audio/{account_id}/{option_id}", include_in_schema=False)
async def option_audio(
    round_id: uuid.UUID,
    account_id: uuid.UUID,
    option_id: str,
    e: int,
    s: str,
    db: Session,
    request: Request,
) -> Any:
    _check(request, e, s)
    return await _serve(db, account_id, round_id, option_id)
