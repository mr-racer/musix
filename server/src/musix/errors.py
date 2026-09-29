"""Domain errors, mapped once to RFC 9457 problem+json (spec §2).

Contexts raise these; nothing raises HTTPException.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class DomainError(Exception):
    status = 500
    title = "Internal error"

    def __init__(self, detail: str = "", **extra: Any) -> None:
        super().__init__(detail)
        self.detail = detail
        self.extra = extra


class Invalid(DomainError):
    status, title = 400, "Invalid request"


class Unauthorized(DomainError):
    status, title = 401, "Unauthorized"


class Forbidden(DomainError):
    status, title = 403, "Forbidden"


class NotFound(DomainError):
    status, title = 404, "Not found"


class Conflict(DomainError):
    status, title = 409, "Conflict"


class RateLimited(DomainError):
    status, title = 429, "Too many requests"


def problem(status: int, title: str, detail: str = "", **extra: Any) -> JSONResponse:
    body = {
        "type": "about:blank",
        "title": title,
        "status": status,
        **({"detail": detail} if detail else {}),
        **extra,
    }
    return JSONResponse(body, status_code=status, media_type="application/problem+json")


def install(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain(_: Request, e: DomainError) -> JSONResponse:
        return problem(e.status, e.title, e.detail, **e.extra)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException) -> JSONResponse:
        return problem(e.status_code, str(e.detail) if e.status_code != 404 else "Not found")

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, e: RequestValidationError) -> JSONResponse:
        return problem(
            422,
            "Validation failed",
            errors=[{"loc": list(x["loc"]), "msg": x["msg"]} for x in e.errors()],
        )
