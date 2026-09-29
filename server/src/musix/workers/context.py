"""Per-worker-process resources: settings and one DB pool (statement_timeout 5 min)."""

from __future__ import annotations

from functools import cache

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from musix.infra import db
from musix.settings import Settings


@cache
def settings() -> Settings:
    return Settings()


@cache
def sessionmaker() -> async_sessionmaker[AsyncSession]:
    return db.make_sessionmaker(db.make_engine(settings(), statement_timeout_ms=300_000))
