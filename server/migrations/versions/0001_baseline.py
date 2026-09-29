"""Baseline: extensions and the Procrastinate queue schema.

The Procrastinate schema is a ~20 KB multi-statement script containing `%`.
asyncpg's prepared statements reject multi-statement SQL, and SQLAlchemy's
text()/exec_driver_sql may interpret placeholders, so it runs on the raw psycopg
connection, which uses the simple query protocol when given no parameters.

There is no downgrade: undoing the baseline means dropping the database.

Revision ID: 0001
Revises:
Create Date: 2026-09-29
"""

from alembic import op
from procrastinate.schema import SchemaManager

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    for ext in ("pg_trgm", "unaccent", "pg_stat_statements"):
        op.execute(f"CREATE EXTENSION IF NOT EXISTS {ext}")
    op.get_bind().connection.dbapi_connection.execute(SchemaManager.get_schema())


def downgrade() -> None:
    raise NotImplementedError("the baseline cannot be downgraded; drop the database instead")
