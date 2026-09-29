"""Alembic runs on the SYNC psycopg driver (see musix.settings for why)."""

from __future__ import annotations

from alembic import context
from sqlalchemy import create_engine, pool

from musix.settings import Settings

url = context.config.attributes.get("url") or Settings().sqlalchemy_sync_url

if context.is_offline_mode():
    context.configure(url=url, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()
