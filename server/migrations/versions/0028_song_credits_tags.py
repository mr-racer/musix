"""Who plays what on a record and how listeners tag it, from the Genius song page the
knowledge job already reads (2026-10-18). Samples and interpolations from the same page go
to song_relations (source 'genius'); these two tables hold what song_relations can't: a
person under several roles (Mike Dean: bass, guitar, keyboards on «Power») and tags.
Global knowledge keyed by song, like facts and song_relations (0016).

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-18
"""

from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    -- role as Genius writes it: Guitar, Cello, Handclaps, Vocal Samples, Strings Arranger…
    CREATE TABLE song_credits (
        song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        role text NOT NULL,
        name text NOT NULL,
        artist_id uuid REFERENCES artists(id) ON DELETE SET NULL,
        source text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (song_id, source, role, name)
    );
    CREATE INDEX song_credits_artist_idx ON song_credits (artist_id);

    -- pos keeps the source's order; primary = the source's main genre for this song
    CREATE TABLE song_tags (
        song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        source text NOT NULL,
        tag text NOT NULL,
        pos smallint NOT NULL,
        is_primary boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (song_id, source, tag)
    );
    CREATE INDEX song_tags_tag_idx ON song_tags (lower(tag));
    """)


def downgrade() -> None:
    op.execute("DROP TABLE song_tags, song_credits")
