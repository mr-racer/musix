from fastapi import APIRouter

from musix.api.deps import Auth, Session
from musix.contexts.handoff import schemas as S
from musix.contexts.handoff import service

router = APIRouter(tags=["handoff"])


@router.get("/devices/active", response_model=list[S.ActiveDevice])
async def active_devices(p: Auth, s: Session) -> list[S.ActiveDevice]:
    """Who can take the music now (the «Слушать на…» picker)."""
    return await service.active(s, p.account_id, p.device_id)


@router.get("/playback/session", response_model=S.SessionOut)
async def playback_session(p: Auth, s: Session) -> S.SessionOut:
    """The account's last playback state: a device taking over, or one continuing where the
    music stopped, starts from here."""
    return await service.session(s, p.account_id)


@router.post("/playback/transfer", status_code=202)
async def transfer(body: S.TransferIn, p: Auth, s: Session) -> None:
    await service.transfer(s, p.account_id, p.device_id, body.to_device, body.play)
    await s.commit()
