"""The artist page's Apple Music images are images of their own kinds (they get a 2048 px step,
`contexts/media/images.HERO_KINDS`); 0003's check allowed only cover/artist/artist_cutout, and the
first Apple fetches on prod failed on it (2026-10-17).

Revision ID: 0027
Revises: 0026
Create Date: 2026-10-17
"""

from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE images DROP CONSTRAINT images_kind_check")
    op.execute(
        "ALTER TABLE images ADD CONSTRAINT images_kind_check CHECK (kind IN"
        " ('cover', 'artist', 'artist_cutout', 'artist_photo', 'artist_wide', 'artist_logo'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE images DROP CONSTRAINT images_kind_check")
    op.execute(
        "ALTER TABLE images ADD CONSTRAINT images_kind_check"
        " CHECK (kind IN ('cover', 'artist', 'artist_cutout'))"
    )
