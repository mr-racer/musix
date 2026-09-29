import uuid

from fastapi import APIRouter, Response

from musix.api.deps import Auth, Keys, Owner, Session
from musix.contexts.identity import schemas as S
from musix.contexts.identity import service

router = APIRouter(tags=["identity"])


@router.post("/auth/setup", response_model=S.Tokens, status_code=201)
async def setup(body: S.SetupIn, s: Session, k: Keys) -> S.Tokens:
    return await service.setup(s, k, body)


@router.post("/auth/login", response_model=S.Tokens)
async def login(body: S.LoginIn, s: Session, k: Keys) -> S.Tokens:
    return await service.login(s, k, body)


@router.post("/auth/register", response_model=S.Tokens, status_code=201)
async def register(body: S.RegisterIn, s: Session, k: Keys) -> S.Tokens:
    return await service.register(s, k, body)


@router.post("/auth/refresh", response_model=S.Tokens)
async def refresh(body: S.RefreshIn, s: Session, k: Keys) -> S.Tokens:
    return await service.refresh(s, k, body.refresh_token)


@router.post("/auth/logout", status_code=204)
async def logout(p: Auth, s: Session) -> Response:
    await service.revoke_device(s, p.account_id, p.device_id)
    return Response(status_code=204)


@router.get("/devices", response_model=list[S.DeviceOut])
async def devices(p: Auth, s: Session) -> list[S.DeviceOut]:
    return await service.list_devices(s, p.account_id, p.device_id)


@router.delete("/devices/{device_id}", status_code=204)
async def delete_device(device_id: uuid.UUID, p: Auth, s: Session) -> Response:
    await service.revoke_device(s, p.account_id, device_id)
    return Response(status_code=204)


@router.post("/invites", response_model=S.InviteOut, status_code=201)
async def create_invite(p: Owner, s: Session) -> S.InviteOut:
    return await service.create_invite(s, p.account_id)


@router.get("/invites", response_model=list[S.InviteOut])
async def list_invites(p: Owner, s: Session) -> list[S.InviteOut]:
    return await service.list_invites(s, p.account_id)


@router.delete("/invites/{code}", status_code=204)
async def revoke_invite(code: str, p: Owner, s: Session) -> Response:
    await service.revoke_invite(s, p.account_id, code)
    return Response(status_code=204)


@router.get("/settings", response_model=S.SettingsIO)
async def get_settings(p: Auth, s: Session) -> S.SettingsIO:
    return S.SettingsIO(value=await service.get_settings(s, p.account_id))


@router.put("/settings", response_model=S.SettingsIO)
async def put_settings(body: S.SettingsIO, p: Auth, s: Session) -> S.SettingsIO:
    return S.SettingsIO(value=await service.put_settings(s, p.account_id, body.value))
