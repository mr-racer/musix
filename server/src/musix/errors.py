"""Domain errors, mapped once to RFC 9457 problem+json (spec §2).

Contexts raise these; nothing raises HTTPException.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.routing import Match


class DomainError(Exception):
    status = 500
    title = "Internal error"

    def __init__(self, detail: str = "", **extra: Any) -> None:
        super().__init__(detail)
        self.detail = detail
        self.extra = extra


class Unavailable(DomainError):
    """A dependency (the model host, a source) cannot answer right now: retry later."""

    status, title = 503, "Service unavailable"


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


def problem(
    status: int,
    title: str,
    detail: str = "",
    headers: dict[str, str] | None = None,
    **extra: Any,
) -> JSONResponse:
    body = {
        "type": "about:blank",
        "title": title,
        "status": status,
        **({"detail": detail} if detail else {}),
        **extra,
    }
    return JSONResponse(
        body, status_code=status, media_type="application/problem+json", headers=headers
    )


def install(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain(_: Request, e: DomainError) -> JSONResponse:
        return problem(e.status, e.title, e.detail, **e.extra)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, e: StarletteHTTPException) -> JSONResponse:
        headers = dict(e.headers or {})
        if e.status_code == 405:  # Starlette's Allow names one route's methods, not the path's
            headers["Allow"] = ", ".join(_allowed(request))
        return problem(
            e.status_code, str(e.detail) if e.status_code != 404 else "Not found", headers=headers
        )

    @app.exception_handler(DBAPIError)
    async def _db(_: Request, e: DBAPIError) -> JSONResponse:
        # SQLSTATE class 22 = data the database cannot hold (NUL in text, out-of-range
        # numbers): the client's fault. Anything else stays a 500.
        if str(getattr(e.orig, "sqlstate", None) or getattr(e.orig, "pgcode", "")).startswith("22"):
            return problem(
                400, "Invalid request", "a value cannot be stored (e.g. a NUL character)"
            )
        raise e

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, e: RequestValidationError) -> JSONResponse:
        return problem(
            422,
            "Validation failed",
            errors=[{"loc": list(x["loc"]), "msg": x["msg"]} for x in e.errors()],
        )


def _allowed(request: Request) -> list[str]:
    return sorted(
        m
        for m in ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE")
        if any(
            r.matches({**request.scope, "method": m})[0] == Match.FULL for r in request.app.routes
        )
    )


PROBLEM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "description": "RFC 9457 problem details",
    "required": ["type", "title", "status"],
    "properties": {
        "type": {"type": "string"},
        "title": {"type": "string"},
        "status": {"type": "integer"},
        "detail": {"type": "string"},
        "errors": {
            "type": "array",
            "description": "422 only: what failed validation",
            "items": {
                "type": "object",
                "required": ["loc", "msg"],
                "properties": {
                    "loc": {
                        "type": "array",
                        "items": {"anyOf": [{"type": "string"}, {"type": "integer"}]},
                    },
                    "msg": {"type": "string"},
                },
            },
        },
    },
    # other members (e.g. `offset` on an upload conflict) may appear: clients ignore them
}
_ERRORS = {
    "400": "Invalid request",
    "401": "Not authenticated",
    "403": "Forbidden",
    "404": "Not found",
    "409": "Conflict",
    "422": "Validation failed",
    "429": "Rate limited",
}


def document(app: FastAPI) -> dict[str, Any]:
    """The OpenAPI document with every error as the problem+json it really is (FastAPI
    documents 422 as its own HTTPValidationError, which this app never sends)."""
    if app.openapi_schema:
        return app.openapi_schema
    from fastapi.openapi.utils import get_openapi

    doc = get_openapi(title=app.title, version=app.version, routes=app.routes)
    schemas = doc.setdefault("components", {}).setdefault("schemas", {})
    schemas["Problem"] = PROBLEM_SCHEMA
    for name in ("HTTPValidationError", "ValidationError"):
        schemas.pop(name, None)
    ref = {"application/problem+json": {"schema": {"$ref": "#/components/schemas/Problem"}}}
    for path in doc.get("paths", {}).values():
        for op in path.values():
            responses = op.setdefault("responses", {})
            for code, desc in _ERRORS.items():
                responses[code] = {"description": desc, "content": ref}
    app.openapi_schema = doc
    return doc
