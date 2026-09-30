"""Per-worker-process resources: settings and one DB pool (statement_timeout 5 min)."""

from __future__ import annotations

from functools import cache

from qdrant_client import AsyncQdrantClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.infra import db, secrets, vectors
from musix.infra.llm import Llm
from musix.infra.ml_client import MlClient
from musix.settings import Settings


@cache
def settings() -> Settings:
    return Settings()


@cache
def sessionmaker() -> async_sessionmaker[AsyncSession]:
    return db.make_sessionmaker(db.make_engine(settings(), statement_timeout_ms=300_000))


@cache
def ml() -> MlClient:
    """The worker's ml client: long reads (a bulk CLAP pass queues behind interactive work)."""
    return MlClient(settings().ml_url, read_timeout=900.0)


_qdrant: AsyncQdrantClient | None = None


async def qdrant() -> AsyncQdrantClient:
    global _qdrant
    if _qdrant is None:
        _qdrant = vectors.client(settings().qdrant_url)
    return _qdrant


@cache
def llm() -> Llm:
    s = settings()
    return Llm(
        sessionmaker(),
        secrets.fernet_only(s.secrets_dir),
        s.llm_base_url,
        s.llm_model,
        s.llm_api_key,
    )
