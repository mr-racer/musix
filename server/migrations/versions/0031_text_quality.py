"""Backend editorial audit and provenance for the one-line player fact.

Revision ID: 0031
Revises: 0030
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("fact_refinements", "artist_bios", "song_vibes"):
        op.add_column(
            table,
            sa.Column("quality", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        )
    op.add_column("song_vibes", sa.Column("source_fact_id", sa.BigInteger))
    op.create_foreign_key(
        "song_vibes_source_fact",
        "song_vibes",
        "facts",
        ["source_fact_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("song_vibes_source_fact", "song_vibes", type_="foreignkey")
    op.drop_column("song_vibes", "source_fact_id")
    for table in ("song_vibes", "artist_bios", "fact_refinements"):
        op.drop_column(table, "quality")
