"""Process configuration: one `Settings` object, read from `MUSIX_*` env vars.

The database is configured by ONE libpq DSN. The three drivers that talk to it
each want a different spelling of it, and deriving them here keeps a single
source of truth:

- SQLAlchemy async (the app): ``postgresql+asyncpg://``
- SQLAlchemy sync (Alembic): ``postgresql+psycopg://``. The Procrastinate schema
  is a multi-statement script that asyncpg's prepared statements reject.
- Procrastinate's ``PsycopgConnector(conninfo=...)``: the plain libpq form.
"""

from __future__ import annotations

import re

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_SCHEME = re.compile(r"^postgres(?:ql)?(?:\+[a-z0-9_]+)?://")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MUSIX_", env_file=".env", extra="ignore")

    database_url: str = "postgresql://musix:musix@localhost:18432/musix"
    qdrant_url: str = "http://localhost:18333"
    ml_url: str = "http://127.0.0.1:18002"  # the model host (v2/ml)
    models_token: str | None = None  # MUSIX_MODELS_TOKEN: /api/v2/models for external RAG
    log_level: str = "INFO"
    otlp_endpoint: str | None = None
    secrets_dir: str = "/var/lib/musix/secrets"
    media_dir: str = "/mnt/data/musix-v2-media"
    public_base_url: str = "http://127.0.0.1:18080"
    rendition_budget_gb: int = 150
    library_roots: list[str] = ["/mnt/data/music"]  # the only folders /library/scan may walk
    llm_base_url: str | None = None  # OpenAI-compatible; the admin's instance setting wins

    @field_validator("database_url")
    @classmethod
    def _must_be_postgres(cls, v: str) -> str:
        if not _SCHEME.match(v):
            raise ValueError("database_url must be a postgresql:// DSN")
        return v

    @property
    def procrastinate_conninfo(self) -> str:
        return _SCHEME.sub("postgresql://", self.database_url, count=1)

    @property
    def sqlalchemy_async_url(self) -> str:
        return _SCHEME.sub("postgresql+asyncpg://", self.database_url, count=1)

    @property
    def sqlalchemy_sync_url(self) -> str:
        return _SCHEME.sub("postgresql+psycopg://", self.database_url, count=1)
