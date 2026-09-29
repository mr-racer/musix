"""Async SQLAlchemy engine (asyncpg) and a readiness probe."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from musix.settings import Settings


def make_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(settings.sqlalchemy_async_url, pool_pre_ping=True, pool_size=5)


async def ping(engine: AsyncEngine) -> None:
    """Raise if Postgres is unreachable."""
    async with engine.connect() as conn:
        await conn.execute(sa.text("select 1"))
