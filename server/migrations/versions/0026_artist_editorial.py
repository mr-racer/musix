"""The artist page «Кадр» (2026-10-17): current editorial photos from Apple Music — a square
portrait, the wide 2:1 frame big artists have, the transparent logo and the page colour —
beside the AudioDB picture the rest of the app keeps («у audiodb старые картинки», the owner,
2026-10-14); and an album's original release year from MusicBrainz, because tags carry the
reissue's (Thriller 2008, The College Dropout 2007) and the discography is drawn by year.

Revision ID: 0026
Revises: 0025
Create Date: 2026-10-17
"""

from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE artists ADD COLUMN photo_id text REFERENCES images(id),"
        " ADD COLUMN wide_id text REFERENCES images(id),"
        " ADD COLUMN logo_id text REFERENCES images(id),"
        " ADD COLUMN editorial jsonb"
    )
    op.execute("ALTER TABLE albums ADD COLUMN original_year integer")


def downgrade() -> None:
    op.execute("ALTER TABLE albums DROP COLUMN original_year")
    op.execute(
        "ALTER TABLE artists DROP COLUMN editorial, DROP COLUMN logo_id,"
        " DROP COLUMN wide_id, DROP COLUMN photo_id"
    )
