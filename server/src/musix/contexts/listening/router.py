import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from musix.api.deps import Auth, Session
from musix.contexts.listening import schemas as S
from musix.contexts.listening import service
from musix.errors import Invalid

router = APIRouter(tags=["listening"])


@router.post("/events/listens:batch", response_model=S.ListenBatchOut)
async def listens(body: S.ListenBatchIn, p: Auth, s: Session) -> S.ListenBatchOut:
    return await service.ingest_listens(s, p.account_id, p.device_id, body)


@router.post("/tracks/{track_id}/signals", response_model=S.SignalState)
async def add_signal(track_id: uuid.UUID, body: S.SignalIn, p: Auth, s: Session) -> S.SignalState:
    return await service.add_signal(s, p.account_id, track_id, body)


@router.get("/signals/state", response_model=S.SignalStatesOut)
async def signal_state(
    p: Auth, s: Session, track_ids: Annotated[str, Query(alias="trackIds", description="≤ 200")]
) -> S.SignalStatesOut:
    try:
        ids = [uuid.UUID(x) for x in track_ids.split(",") if x][:200]
    except ValueError as e:
        raise Invalid("trackIds must be uuids") from e
    return S.SignalStatesOut(states=await service.signal_states(s, p.account_id, ids))
