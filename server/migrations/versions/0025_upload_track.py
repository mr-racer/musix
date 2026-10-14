"""An upload knows the track it became, so the library's inbox can follow one song through
the server's steps (send → sound → facts) with one status at a time (the settings round 2,
2026-10-13: «каждая песня — корректный статус, без нескольких одновременно»).

Revision ID: 0025
Revises: 0024
Create Date: 2026-10-14
"""

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE uploads ADD COLUMN track_id uuid REFERENCES tracks(id)")


def downgrade() -> None:
    op.execute("ALTER TABLE uploads DROP COLUMN track_id")
