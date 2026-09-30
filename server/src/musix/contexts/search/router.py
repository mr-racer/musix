from typing import Annotated

from fastapi import APIRouter, Query, Request

from musix.api.deps import Auth
from musix.contexts.screens.router import _ctx
from musix.contexts.search import schemas as S
from musix.contexts.search import service

router = APIRouter(tags=["search"])


@router.get("/search", response_model=S.SearchOut)
async def search(
    p: Auth,
    request: Request,
    q: Annotated[str, Query(min_length=1, max_length=300)],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    sections: Annotated[
        str,
        Query(
            pattern=r"^(catalog|lyrics|sound)(,(catalog|lyrics|sound))*$",
            description="which to compute; search-as-you-type wants `catalog` only",
        ),
    ] = "catalog,lyrics,sound",
    years: Annotated[
        str | None,
        Query(pattern=r"^\d{4}s(,\d{4}s)*$", description="decades, e.g. `1990s,2000s`"),
    ] = None,
    tags: Annotated[
        str | None, Query(max_length=400, description="sonic tags, all required")
    ] = None,
) -> S.SearchOut:
    st = request.app.state
    want = set(sections.split(","))
    ys = [int(y[:4]) for y in years.split(",")] if years else None
    tg = [x.strip() for x in tags.split(",") if x.strip()] if tags else None
    return await service.search(_ctx(request, p), st.qdrant, st.ml, q.strip(), limit, want, ys, tg)


@router.get("/library/facets", response_model=S.FacetsOut)
async def facets(p: Auth, request: Request) -> S.FacetsOut:
    """The search filters' chips (v1's sonic and year facets)."""
    return await service.facets(_ctx(request, p))
