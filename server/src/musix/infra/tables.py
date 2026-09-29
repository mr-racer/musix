"""Shared SQLAlchemy Core metadata. Each context declares its own tables on it
(mirroring the Alembic migrations, which are the source of truth for DDL)."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

metadata = sa.MetaData()

change_log = sa.Table(
    "change_log",
    metadata,
    sa.Column("seq", sa.BigInteger, primary_key=True),
    sa.Column("account_id", UUID(as_uuid=True), nullable=False),
    sa.Column("entity", sa.Text, nullable=False),
    sa.Column("entity_id", sa.Text, nullable=False),
    sa.Column("op", sa.Text, nullable=False),
    sa.Column("at", sa.DateTime(timezone=True), server_default=sa.func.now()),
)
