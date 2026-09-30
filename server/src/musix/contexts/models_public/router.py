"""The model legs for services that are not MusiX (v1 `models_public`, kept by the
owner): one copy of the weights per machine, so an external RAG stack borrows these
instead of loading its own. OpenAI / Cohere shapes, a static bearer
(`MUSIX_MODELS_TOKEN`) instead of a user JWT; no token configured = the API is off."""

import hmac
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Header, Request

from musix.errors import NotFound, Unauthorized

router = APIRouter(prefix="/models", tags=["models"])


def _token(request: Request, authorization: Annotated[str | None, Header()] = None) -> None:
    want = request.app.state.settings.models_token
    if not want:
        raise NotFound("the models API is not enabled")
    got = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(got.encode(), want.encode()):
        raise Unauthorized("bad models token")


Guard = Depends(_token)
JsonBody = Annotated[dict[str, Any], Body()]


@router.get("/v1/models", dependencies=[Guard])
async def models() -> dict[str, Any]:
    return {
        "object": "list",
        "data": [
            {"id": "octen-query", "kind": "dense", "dimensions": 1024, "side": "query"},
            {"id": "octen-document", "kind": "dense", "dimensions": 1024, "side": "document"},
            {"id": "milco-sparse", "kind": "sparse", "dimensions": 280524},
            {"id": "bge-reranker-v2-m3", "kind": "rerank"},
        ],
    }


@router.post("/v1/embeddings", dependencies=[Guard])
async def embeddings(body: JsonBody, request: Request) -> Any:
    return await request.app.state.ml.proxy("/v1/embeddings", body, "interactive")


@router.post("/v1/embeddings/sparse", dependencies=[Guard])
async def sparse(body: JsonBody, request: Request) -> Any:
    return await request.app.state.ml.proxy("/v1/embeddings/sparse", body, "interactive")


@router.post("/v1/rerank", dependencies=[Guard])
async def rerank(body: JsonBody, request: Request) -> Any:
    return await request.app.state.ml.proxy("/v1/rerank", body, "interactive")
