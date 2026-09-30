from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request, Response

from musix.api.deps import Auth, Session
from musix.contexts.screens.router import _ctx
from musix.contexts.stream import schemas as S
from musix.contexts.stream import service

router = APIRouter(prefix="/stream", tags=["stream"])


@router.get("/next", response_model=S.StreamOut)
async def next_chunk(
    p: Auth,
    request: Request,
    session_id: Annotated[str, Query(alias="sessionId", min_length=1, max_length=64)],
    n: Annotated[int, Query(ge=1, le=10)] = 3,
    lang: Literal["ru", "en"] = "ru",
    tz_offset_minutes: Annotated[int, Query(alias="tzOffsetMinutes", ge=-720, le=840)] = 0,
) -> S.StreamOut:
    return await service.next_chunk(
        _ctx(request, p), request.app.state.qdrant, session_id, n, lang, tz_offset_minutes
    )


@router.get("/presets", response_model=list[S.PresetOut])
async def presets(p: Auth, s: Session) -> list[S.PresetOut]:
    return [S.PresetOut.model_validate(r) for r in (await service.presets(s)).values()]


@router.put("/settings", response_model=S.StreamSettings)
async def settings(body: S.StreamSettings, p: Auth, s: Session) -> S.StreamSettings:
    return await service.put_settings(s, p.account_id, body)


@router.post("/feedback", status_code=204)
async def feedback(body: S.FeedbackIn, p: Auth, s: Session) -> Response:
    await service.feedback(s, p.account_id, body)
    return Response(status_code=204)


@router.post("/autoplay", response_model=S.AutoplayOut)
async def autoplay(body: S.AutoplayIn, p: Auth, request: Request) -> S.AutoplayOut:
    c = _ctx(request, p)
    ids = await service.autoplay(c, request.app.state.qdrant, body)
    ts = await c.tracks(ids)
    return S.AutoplayOut(tracks=ts, images=await c.images([t.cover_image_id for t in ts]))
