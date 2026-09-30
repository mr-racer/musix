import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request, Response

from musix.api import etag
from musix.api.deps import Auth
from musix.contexts.knowledge import schemas as S
from musix.contexts.knowledge import service
from musix.contexts.library.models import artists
from musix.errors import NotFound

router = APIRouter(tags=["knowledge"])
Lang = Annotated[Literal["ru", "en"], Query()]


@router.get(
    "/tracks/{track_id}/knowledge", response_model=S.TrackKnowledge, responses=etag.NOT_MODIFIED
)
async def track_knowledge(
    track_id: uuid.UUID, p: Auth, request: Request, response: Response, lang: Lang = "ru"
) -> Any:
    """Facts (song and artist), producers, labels, samples and the vibe line."""
    tag, _ = await etag.versioned_tag(
        request,
        p.account_id,
        f"knowledge:{track_id}:{lang}",
        also=service.knowledge_version(p.account_id, track_id),
    )

    async def build() -> S.TrackKnowledge:
        async with request.app.state.sessionmaker() as s:
            got = await service.track_knowledge(s, p.account_id, track_id, lang)
        if got is None:
            raise NotFound("track")
        return got

    return await etag.conditional(request, response, tag, build)


@router.get("/artists/{artist_id}/bio", response_model=S.BioOut, responses=etag.NOT_MODIFIED)
async def artist_bio(
    artist_id: uuid.UUID, p: Auth, request: Request, response: Response, lang: Lang = "ru"
) -> Any:
    import sqlalchemy as sa

    at = sa.select(artists.c.knowledge_at).where(artists.c.id == artist_id).scalar_subquery()
    tag, _ = await etag.versioned_tag(request, p.account_id, f"bio:{artist_id}:{lang}", also=(at,))

    async def build() -> S.BioOut:
        async with request.app.state.sessionmaker() as s:
            got = await service.artist_bio(s, p.account_id, artist_id, lang)
        if got is None:
            raise NotFound("bio")
        return got

    return await etag.conditional(request, response, tag, build)
