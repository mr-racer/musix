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
) -> S.SearchOut:
    st = request.app.state
    want = set(sections.split(","))
    return await service.search(_ctx(request, p), st.qdrant, st.ml, q.strip(), limit, want)
