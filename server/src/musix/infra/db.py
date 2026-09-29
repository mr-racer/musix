"""Async SQLAlchemy (asyncpg), one pool per process, and the session dependency.

statement_timeout is set per connection by the process that opens it (api 5 s,
workers 5 min, spec §3) — the same effect as per-role settings without managing roles.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from musix.settings import Settings


def make_engine(
    settings: Settings, *, statement_timeout_ms: int = 5000, pool_size: int = 5
) -> AsyncEngine:
    return create_async_engine(
        settings.sqlalchemy_async_url,
        pool_pre_ping=True,
        pool_size=pool_size,
        max_overflow=5,
        connect_args={
            "server_settings": {
                "statement_timeout": str(statement_timeout_ms),
                "application_name": "musix",
            }
        },
    )


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def ping(engine: AsyncEngine) -> None:
    """Raise if Postgres is unreachable."""
    async with engine.connect() as conn:
        await conn.execute(sa.text("select 1"))
