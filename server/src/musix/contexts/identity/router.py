import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Cookie, Request, Response

from musix.api.deps import Auth, Keys, Owner, Session
from musix.contexts.identity import schemas as S
from musix.contexts.identity import security as sec
from musix.contexts.identity import service
from musix.errors import Unauthorized, problem
from musix.infra import llm

router = APIRouter(tags=["identity"])

# The web keeps its refresh token where script cannot read it: an HttpOnly cookie scoped
# to the auth routes. The access token stays in the page's memory; a reload refreshes once.
COOKIE = "mx_rt"
COOKIE_PATH = "/api/v2/auth"
WebCookie = Annotated[str | None, Cookie(alias=COOKIE, include_in_schema=False)]


def _for(platform: str, tokens: S.Tokens, response: Response) -> S.Tokens:
    if platform != "web":
        return tokens
    response.set_cookie(
        COOKIE,
        tokens.refresh_token or "",
        max_age=int(sec.REFRESH_TTL.total_seconds()),
        path=COOKIE_PATH,
        secure=True,
        httponly=True,
        samesite="strict",
    )
    return tokens.model_copy(update={"refresh_token": None})


@router.post("/auth/setup", response_model=S.Tokens, status_code=201)
async def setup(body: S.SetupIn, s: Session, k: Keys, response: Response) -> S.Tokens:
    return _for(body.device.platform, await service.setup(s, k, body), response)


@router.post("/auth/login", response_model=S.Tokens)
async def login(body: S.LoginIn, s: Session, k: Keys, response: Response) -> S.Tokens:
    return _for(body.device.platform, await service.login(s, k, body), response)


@router.post("/auth/register", response_model=S.Tokens, status_code=201)
async def register(body: S.RegisterIn, s: Session, k: Keys, response: Response) -> S.Tokens:
    return _for(body.device.platform, await service.register(s, k, body), response)


@router.post("/auth/refresh", response_model=S.Tokens, responses={401: {}})
async def refresh(
    s: Session,
    k: Keys,
    response: Response,
    cookie: WebCookie = None,
    body: S.RefreshIn | None = None,
) -> Any:
    """Native clients send `refreshToken`; the web sends no body and its cookie is read."""
    if body is not None and body.refresh_token:
        return await service.refresh(s, k, body.refresh_token)
    if not cookie:
        raise Unauthorized("no refresh token")
    try:
        return _for("web", await service.refresh(s, k, cookie), response)
    except Unauthorized as e:  # a dead cookie is dropped, so the page stops presenting it
        out = problem(e.status, e.title, e.detail)
        out.delete_cookie(COOKIE, path=COOKIE_PATH, secure=True, httponly=True, samesite="strict")
        return out


@router.post("/auth/logout", status_code=204)
async def logout(p: Auth, s: Session) -> Response:
    await service.revoke_device(s, p.account_id, p.device_id)
    out = Response(status_code=204)
    out.delete_cookie(COOKIE, path=COOKIE_PATH, secure=True, httponly=True, samesite="strict")
    return out


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


@router.get("/admin/llm", response_model=S.LlmSettingsOut)
async def get_llm(p: Owner, s: Session, keys: Keys, request: Request) -> S.LlmSettingsOut:
    """The instance's LLM endpoint (the key only as `hasKey`)."""
    st = request.app.state.settings
    env_key = st.llm_api_key.get_secret_value() if st.llm_api_key else None
    cfg = await llm.config(s, keys.fernet, st.llm_base_url, st.llm_model, env_key)
    return S.LlmSettingsOut.model_validate(cfg.public_view())


@router.put("/admin/llm", response_model=S.LlmSettingsOut)
async def put_llm(
    body: S.LlmSettingsIn, p: Owner, s: Session, keys: Keys, request: Request
) -> S.LlmSettingsOut:
    import sqlalchemy as sa
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from musix.contexts.identity.models import instance_settings

    IS = instance_settings.c
    cur: dict[str, Any] = await s.scalar(sa.select(IS.value).where(IS.key == "llm")) or {}
    new = {**cur, "baseUrl": body.base_url or None, "model": body.model or None}
    if body.api_key is not None:
        new["apiKeyEnc"] = llm.encrypt_key(keys.fernet, body.api_key) if body.api_key else None
    await s.execute(
        pg_insert(instance_settings)
        .values(key="llm", value=new)
        .on_conflict_do_update(
            index_elements=["key"], set_={"value": new, "updated_at": sa.func.now()}
        )
    )
    await s.commit()
    return await get_llm(p, s, keys, request)
