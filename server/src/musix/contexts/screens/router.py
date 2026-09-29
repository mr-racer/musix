import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response

from musix.api import etag
from musix.api.deps import Auth
from musix.contexts.identity.security import Principal
from musix.contexts.screens import schemas as S
from musix.contexts.screens import service
from musix.errors import Invalid

router = APIRouter(tags=["screens"])


def _ctx(request: Request, p: Principal) -> service.Ctx:
    st = request.app.state
    return service.Ctx(
        st.sessionmaker, p.account_id, st.settings.public_base_url, st.secrets.media_hmac
    )


async def _tag(request: Request, p: Principal, shape: str, with_plays: bool = False) -> str:
    return await etag.tag_for(request, p.account_id, shape, with_plays)


def _uuids(raw: str) -> list[uuid.UUID]:
    try:
        return [uuid.UUID(x) for x in raw.split(",") if x][:200]
    except ValueError as e:
        raise Invalid("ids must be uuids") from e


@router.get("/home", response_model=S.HomeOut, responses=etag.NOT_MODIFIED)
async def home(p: Auth, request: Request, response: Response) -> Any:
    tag = await _tag(request, p, "home", with_plays=True)
    return await etag.conditional(request, response, tag, lambda: service.home(_ctx(request, p)))


@router.get("/library/summary", response_model=S.LibrarySummaryOut, responses=etag.NOT_MODIFIED)
async def library_summary(p: Auth, request: Request, response: Response) -> Any:
    tag = await _tag(request, p, "summary", with_plays=True)
    return await etag.conditional(
        request, response, tag, lambda: service.library_summary(_ctx(request, p))
    )


@router.get("/albums/{album_id}", response_model=S.AlbumPageOut, responses=etag.NOT_MODIFIED)
async def album_page(album_id: uuid.UUID, p: Auth, request: Request, response: Response) -> Any:
    tag = await _tag(request, p, f"album:{album_id}")
    return await etag.conditional(
        request, response, tag, lambda: service.album_page(_ctx(request, p), album_id)
    )


@router.get(
    "/artists/{artist_id}/page", response_model=S.ArtistPageOut, responses=etag.NOT_MODIFIED
)
async def artist_page(artist_id: uuid.UUID, p: Auth, request: Request, response: Response) -> Any:
    tag = await _tag(request, p, f"artist:{artist_id}", with_plays=True)
    return await etag.conditional(
        request, response, tag, lambda: service.artist_page(_ctx(request, p), artist_id)
    )


@router.get(
    "/player/context/{track_id}", response_model=S.PlayerContextOut, responses=etag.NOT_MODIFIED
)
async def player_context(track_id: uuid.UUID, p: Auth, request: Request, response: Response) -> Any:
    tag = await _tag(request, p, f"player:{track_id}", with_plays=True)
    return await etag.conditional(
        request, response, tag, lambda: service.player_context(_ctx(request, p), track_id)
    )


@router.get("/albums", response_model=list[S.AlbumOut], responses=etag.NOT_MODIFIED)
async def albums(
    p: Auth,
    request: Request,
    response: Response,
    ids: Annotated[str, Query(description="comma-separated, ≤ 200")],
) -> Any:
    parsed = _uuids(ids)
    tag = await _tag(request, p, f"albums:{sorted(parsed)}")
    return await etag.conditional(
        request, response, tag, lambda: service.albums_by_ids(_ctx(request, p), parsed)
    )


@router.get("/artists", response_model=list[S.ArtistOut], responses=etag.NOT_MODIFIED)
async def artists(
    p: Auth,
    request: Request,
    response: Response,
    ids: Annotated[str, Query(description="comma-separated, ≤ 200")],
) -> Any:
    parsed = _uuids(ids)
    tag = await _tag(request, p, f"artists:{sorted(parsed)}")
    return await etag.conditional(
        request, response, tag, lambda: service.artists_by_ids(_ctx(request, p), parsed)
    )
