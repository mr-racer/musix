from typing import Annotated

from fastapi import APIRouter, Query, Request

from musix.api.deps import Auth, Session
from musix.contexts.sync import schemas as S
from musix.contexts.sync import service

router = APIRouter(tags=["sync"])


@router.get("/sync", response_model=S.SyncPage)
async def sync(
    p: Auth,
    s: Session,
    request: Request,
    cursor: Annotated[str | None, Query(max_length=512, pattern=r"^[A-Za-z0-9_-]+$")] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 1000,
) -> S.SyncPage:
    c = service.Ctx(
        s,
        p.account_id,
        request.app.state.settings.public_base_url,
        request.app.state.secrets.media_hmac,
    )
    return await service.page(c, cursor, limit)
