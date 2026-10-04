"""The 16-band spectrum of a media file (design refresh spec §6.2): the player draws a
frequency curve above the seek line from it. The 4-band `envelope` stays for installed apps.

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-04
"""

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE media_files ADD COLUMN spectrum bytea")


def downgrade() -> None:
    op.execute("ALTER TABLE media_files DROP COLUMN spectrum")
