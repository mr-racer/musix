import uuid
from typing import Any

from fastapi import APIRouter, Request, Response

from musix.api import etag
from musix.api.deps import Auth, Owner, Session
from musix.contexts.sound import schemas as S
from musix.contexts.sound import service
from musix.contexts.sound.client import SoundClient
from musix.errors import NotFound

router = APIRouter(tags=["sound"])
STAGE_FPS, STAGE_STEMS = 10, "vocals,drums,bass,guitar,piano,other"


@router.get(
    "/tracks/{track_id}/sound",
    response_model=S.TrackSound,
    responses={**etag.NOT_MODIFIED, 404: {"description": "No analysis yet; `state` says why"}},
)
async def get_track_sound(
    track_id: uuid.UUID, p: Auth, s: Session, request: Request, response: Response
) -> Any:
    """The sound of a track (spec sound-engine §10): the three ratings with facets, the
    certain instruments, tempo words, echo and width, sections, moments worth hearing, where
    each part sits, and the validated «изюминка». A 404 carries `state`: pending | running |
    failed | skipped | none."""
    mf = await service.media_file_of(s, p.account_id, track_id)
    if mf is None:
        raise NotFound("no such track")
    body, state, ver = await service.track_sound(s, mf)
    if body is None:
        raise NotFound("no sound analysis for this track yet", state=state)
    tag = etag.make("sound", mf, *ver)

    async def build() -> S.TrackSound:
        return body

    return await etag.conditional(request, response, tag, build)


@router.get(
    "/tracks/{track_id}/sound/stage",
    response_class=Response,
    responses={
        200: {
            "content": {"application/octet-stream": {}},
            "description": "gzip(int8[frames][6 stems][level, pan]) at 10 fps; level in half-dB "
            "below the loudest stem frame (0..-120), pan -100..100; stems in X-Stage-Stems order",
        },
        **etag.NOT_MODIFIED,
    },
)
async def get_track_stage(track_id: uuid.UUID, p: Auth, s: Session, request: Request) -> Response:
    """The live stage frames: where each stem sits and how loud, 10 times a second."""
    mf = await service.media_file_of(s, p.account_id, track_id)
    row = await service.stage_frames(s, mf) if mf else None
    if row is None:
        raise NotFound("no stage for this track yet")
    blob, at = row
    tag = etag.make("stage", mf, at)
    headers = {
        "ETag": tag,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Stage-Fps": str(STAGE_FPS),
        "X-Stage-Stems": STAGE_STEMS,
    }
    if etag.matches(request, tag):
        return Response(status_code=304, headers=headers)
    return Response(blob, media_type="application/octet-stream", headers=headers)


@router.get("/admin/sound/status", response_model=S.SoundStatus)
async def get_sound_status(p: Owner, s: Session, request: Request) -> S.SoundStatus:
    """The engine at a glance (owner): who holds the card, the batch on ml-sound, the queue."""
    st = request.app.state.settings
    health = None
    if st.ml_sound_url:
        c = SoundClient(st.ml_sound_url, st.ml_url)
        try:
            health = await c.sound_health()
        finally:
            await c.close()
    return await service.status(s, health)
