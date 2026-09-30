"""The `ml` service's HTTP surface. Internal: only the api and the workers call it (the
public, token-guarded face for external RAG is the api's /api/v2/models).

Shapes are borrowed, not invented (as v1 `models_public`): OpenAI for embeddings, with
the asymmetric Octen addressed by NAME (`octen-query` / `octen-document`, one set of
weights); Cohere for rerank; Qdrant's {indices, values} for sparse. `X-Priority:
interactive|bulk` picks the queue lane."""

from __future__ import annotations

import base64
import os
import time
from pathlib import Path
from typing import Annotated, Any, Literal

import numpy as np
from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, Gauge, Histogram, generate_latest
from pydantic import BaseModel, Field

from musix_ml import models
from musix_ml.errors import ModelError
from musix_ml.executor import PriorityExecutor

DENSE_ALIASES = {"octen-query": True, "octen-document": False}
SPARSE_DIM = 280_524  # MILCO: 30522 SPLADE-v3 pivot + 250002 XLM-R source view
MAX_INPUTS, MAX_CHARS = 256, 2_000_000
MEDIA_ROOTS = [
    Path(p)
    for p in os.environ.get("ML_MEDIA_ROOTS", "/mnt/data/music:/mnt/data/musix-v2-media").split(":")
]
Priority = Annotated[Literal["interactive", "bulk"], Header(alias="X-Priority")]

LATENCY = Histogram("musix_ml_seconds", "ml request latency", ["op", "priority"])
QUEUE = Gauge("musix_ml_queue_depth", "jobs waiting for the executor")


class Texts(BaseModel):
    input: str | list[str]

    def texts(self) -> list[str]:
        t = [self.input] if isinstance(self.input, str) else list(self.input)
        if not t:
            raise HTTPException(422, "input is empty")
        if len(t) > MAX_INPUTS or sum(len(x) for x in t) > MAX_CHARS:
            raise HTTPException(413, f"at most {MAX_INPUTS} inputs / {MAX_CHARS} chars: split it")
        return t


class EmbeddingIn(Texts):
    model: str = "octen-document"
    encoding_format: Literal["float", "base64"] = "float"


class SparseIn(Texts):
    is_query: bool = False


class RerankIn(BaseModel):
    query: str
    documents: list[str] = Field(max_length=256)
    top_n: int | None = Field(default=None, ge=1)
    return_documents: bool = False


class AudioIn(BaseModel):
    path: str


def create_app() -> FastAPI:
    app = FastAPI(title="MusiX ml", openapi_url=None)
    ex = PriorityExecutor()

    @app.exception_handler(ModelError)
    async def _model_error(_: Request, e: ModelError) -> JSONResponse:
        headers = (
            {"Retry-After": "5" if e.status == 429 else "30"} if e.status in (429, 503) else {}
        )
        return JSONResponse(
            {"error": {"message": str(e), "type": e.kind, "leg": e.leg, "op": e.op}},
            status_code=e.status,
            headers=headers,
        )

    async def run(op: str, priority: str, fn: Any) -> Any:
        t = time.perf_counter()
        try:
            return await ex.run(priority, fn)
        finally:
            QUEUE.set(ex.depth())
            LATENCY.labels(op, priority).observe(time.perf_counter() - t)

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"status": "ok", **models.loaded(), "queue": ex.depth()}

    @app.get("/metrics")
    async def metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    @app.post("/v1/embeddings")
    async def embeddings(body: EmbeddingIn, priority: Priority = "interactive") -> dict[str, Any]:
        if body.model not in DENSE_ALIASES:
            raise HTTPException(400, f"model must be one of {sorted(DENSE_ALIASES)}")
        texts = body.texts()
        vecs = await run(
            "dense", priority, lambda: models.embed_text(texts, DENSE_ALIASES[body.model])
        )

        def enc(v: np.ndarray) -> Any:
            if body.encoding_format == "base64":
                return base64.b64encode(v.astype(np.float32).tobytes()).decode()
            return v.tolist()

        return {
            "object": "list",
            "model": body.model,
            "data": [
                {"object": "embedding", "index": i, "embedding": enc(v)} for i, v in enumerate(vecs)
            ],
        }

    @app.post("/v1/embeddings/sparse")
    async def sparse(body: SparseIn, priority: Priority = "interactive") -> dict[str, Any]:
        texts = body.texts()
        rows = await run("sparse", priority, lambda: models.embed_sparse(texts, body.is_query))
        return {
            "dim": SPARSE_DIM,
            "data": [{"index": i, "indices": ix, "values": v} for i, (ix, v) in enumerate(rows)],
        }

    @app.post("/v1/rerank")
    async def rerank(body: RerankIn, priority: Priority = "interactive") -> dict[str, Any]:
        scores = await run("rerank", priority, lambda: models.rerank(body.query, body.documents))
        order = sorted(range(len(scores)), key=lambda i: -scores[i])[: body.top_n or len(scores)]
        return {
            "results": [
                {
                    "index": i,
                    "relevance_score": scores[i],
                    **({"document": {"text": body.documents[i]}} if body.return_documents else {}),
                }
                for i in order
            ]
        }

    @app.post("/v1/clap/text")
    async def clap_text(body: Texts, priority: Priority = "interactive") -> dict[str, Any]:
        texts = body.texts()
        vecs = await run("clap_text", priority, lambda: models.clap_text(texts))
        return {"data": [v.tolist() for v in vecs]}

    @app.post("/v1/clap/audio")
    async def clap_audio(body: AudioIn, priority: Priority = "bulk") -> dict[str, Any]:
        p = Path(body.path)
        if (
            not p.is_absolute()
            or ".." in p.parts
            or not any(p.is_relative_to(r) for r in MEDIA_ROOTS)
        ):
            raise HTTPException(400, "path is outside the media roots")
        out = await run("clap_audio", priority, lambda: models.clap_audio(str(p)))
        if out is None:
            return {"mean": None, "chunks": []}
        mean, chunks = out
        return {"mean": mean.tolist(), "chunks": chunks.tolist()}

    @app.post("/v1/gliner/relations")
    async def gliner(body: Texts, priority: Priority = "bulk") -> dict[str, Any]:
        texts = body.texts()
        return {"data": await run("gliner", priority, lambda: models.gliner_relations(texts))}

    return app


app = create_app()
