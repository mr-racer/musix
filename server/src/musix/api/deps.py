"""Shared request dependencies: the session and the authenticated principal."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from musix.contexts.identity.security import Principal, verify_access
from musix.errors import Forbidden, Unauthorized
from musix.infra.secrets import Secrets

_bearer = HTTPBearer(auto_error=False)


async def session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as s:
        yield s


def secrets(request: Request) -> Secrets:
    return request.app.state.secrets  # type: ignore[no-any-return]


async def principal(
    request: Request, cred: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
) -> Principal:
    if cred is None:
        raise Unauthorized("missing bearer token")
    return verify_access(request.app.state.secrets, cred.credentials)


async def owner(p: Annotated[Principal, Depends(principal)]) -> Principal:
    if p.role != "owner":
        raise Forbidden("owner only")
    return p


Session = Annotated[AsyncSession, Depends(session)]
Auth = Annotated[Principal, Depends(principal)]
Owner = Annotated[Principal, Depends(owner)]
Keys = Annotated[Secrets, Depends(secrets)]
