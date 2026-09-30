"""Catalog search also matches the RAW title: a listener pastes "Junya, Pt. 2 (ft.
Playboi Carti & Ty Dolla $ign)" as well as the display title without the feat part.

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-30
"""

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX tracks_raw_title_key_trgm ON tracks "
        "USING gin (musix_key(title) gin_trgm_ops) WHERE deleted_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX tracks_raw_title_key_trgm")
