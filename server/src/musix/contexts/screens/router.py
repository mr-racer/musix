import uuid
from typing import Annotated, Any, Literal

import sqlalchemy as sa
from fastapi import APIRouter, Query, Request, Response

from musix.api import etag
from musix.api.deps import Auth
from musix.contexts.identity.security import Principal
from musix.contexts.knowledge.service import knowledge_version
from musix.contexts.screens import schemas as S
from musix.contexts.screens import service, stats, weather
from musix.contexts.stream.models import taste_maps, taste_profile
from musix.errors import Invalid, NotFound
from musix.schemas import ID_LIST

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


TzOffset = Annotated[
    int, Query(alias="tzOffsetMinutes", ge=-840, le=840, description="UTC+3 → 180")
]


def _profile_version(account_id: uuid.UUID) -> Any:
    return (
        sa.select(taste_profile.c.updated_at)
        .where(taste_profile.c.account_id == account_id)
        .scalar_subquery()
    )


@router.get("/home", response_model=S.HomeOut, responses=etag.NOT_MODIFIED)
async def home(p: Auth, request: Request, response: Response, tz: TzOffset = 0) -> Any:
    # the pulse moves with the local day; «вайбики» change when the profile job runs; the
    # sky changes with the weather (a cached reading; a stale one refreshes in the background)
    st = request.app.state
    wx = weather.peek(st.settings.weather_latlon, st.settings.proxy_url)
    shape = f"home:{tz}:{stats.local_today(tz)}:{wx.kind if wx else '-'}"
    tag, head = await etag.versioned_tag(
        request, p.account_id, shape, with_plays=True, also=(_profile_version(p.account_id),)
    )
    return await etag.conditional(
        request,
        response,
        tag,
        lambda: service.home(_ctx(request, p), head, tz, qdrant=st.qdrant, weather=wx),
    )


@router.get("/stats", response_model=S.StatsOut, responses=etag.NOT_MODIFIED)
async def stats_tab(p: Auth, request: Request, response: Response, tz: TzOffset = 0) -> Any:
    """Listening summary, rhythm and engagement (the current streak moves with the day)."""
    tag = await _tag(request, p, f"stats:{tz}:{stats.local_today(tz)}", with_plays=True)
    return await etag.conditional(request, response, tag, lambda: stats.stats(_ctx(request, p), tz))


@router.get("/stats/map", response_model=S.TasteMapOut, responses=etag.NOT_MODIFIED)
async def taste_map(p: Auth, request: Request, response: Response) -> Any:
    """«Сонар вкуса»: a separate shape — ~300 KB for a big library, rebuilt nightly."""
    at = _map_version(p.account_id)
    tag, _ = await etag.versioned_tag(request, p.account_id, "map", also=(at,))
    return await etag.conditional(request, response, tag, lambda: stats.taste_map(_ctx(request, p)))


def _map_version(account_id: uuid.UUID) -> Any:
    return (
        sa.select(taste_maps.c.updated_at)
        .where(taste_maps.c.account_id == account_id)
        .scalar_subquery()
    )


@router.get("/library/summary", response_model=S.LibrarySummaryOut, responses=etag.NOT_MODIFIED)
async def library_summary(p: Auth, request: Request, response: Response) -> Any:
    tag, head = await etag.versioned_tag(request, p.account_id, "summary", with_plays=True)
    return await etag.conditional(
        request, response, tag, lambda: service.library_summary(_ctx(request, p), head)
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
async def player_context(
    track_id: uuid.UUID,
    p: Auth,
    request: Request,
    response: Response,
    lang: Annotated[Literal["ru", "en"], Query()] = "ru",
) -> Any:
    tag, _ = await etag.versioned_tag(
        request,
        p.account_id,
        f"player:{track_id}:{lang}",
        with_plays=True,
        also=knowledge_version(p.account_id, track_id),
    )
    return await etag.conditional(
        request, response, tag, lambda: service.player_context(_ctx(request, p), track_id, lang)
    )


@router.get("/albums", response_model=list[S.AlbumOut], responses=etag.NOT_MODIFIED)
async def albums(
    p: Auth,
    request: Request,
    response: Response,
    ids: Annotated[str, Query(description="comma-separated, ≤ 200", **ID_LIST)],
) -> Any:
    parsed = _uuids(ids)
    tag = await _tag(request, p, f"albums:{sorted(parsed)}")
    return await etag.conditional(
        request, response, tag, lambda: service.albums_by_ids(_ctx(request, p), parsed)
    )


@router.get("/artists/by-slug/{slug}", response_model=S.ArtistOut)
async def artist_by_slug(slug: str, p: Auth, request: Request) -> Any:
    """The assistant names artists by slug (v1's key); clients open pages by id."""
    import sqlalchemy as sa

    from musix.contexts.library.models import artists

    c = _ctx(request, p)
    aid = await c.run(lambda s: s.scalar(sa.select(artists.c.id).where(artists.c.slug == slug)))
    found = await service.artists_by_ids(c, [aid]) if aid else []
    if not found:
        raise NotFound("artist")
    return found[0]


@router.get("/artists", response_model=list[S.ArtistOut], responses=etag.NOT_MODIFIED)
async def artists(
    p: Auth,
    request: Request,
    response: Response,
    ids: Annotated[str, Query(description="comma-separated, ≤ 200", **ID_LIST)],
) -> Any:
    parsed = _uuids(ids)
    tag = await _tag(request, p, f"artists:{sorted(parsed)}")
    return await etag.conditional(
        request, response, tag, lambda: service.artists_by_ids(_ctx(request, p), parsed)
    )
