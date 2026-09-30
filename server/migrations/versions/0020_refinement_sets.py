"""v1's legacy refined-fact sets (pre-facts_v2, one JSON list per subject and language),
kept verbatim by the migrator: v1 read them after facts_v2's items and before the raw
facts, and so does v2 — until knowledge:refine gives the subject items.

Revision ID: 0020
Revises: 0019
Create Date: 2026-09-30
"""

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE fact_refinement_sets (
        subject_kind text NOT NULL CHECK (subject_kind IN ('song', 'artist')),
        subject_id uuid NOT NULL,
        lang text NOT NULL,
        payload jsonb NOT NULL,  -- [{"text", "confirmed"?}, ...]
        generated_at timestamptz,
        PRIMARY KEY (subject_kind, subject_id, lang)
    );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE fact_refinement_sets")
