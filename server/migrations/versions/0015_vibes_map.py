"""«Вайбики» ride on taste_profile (the same debounced job computes them); the «Сонар
вкуса» map is a nightly job's output, read as is by the stats tab.

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-30
"""

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    ALTER TABLE taste_profile ADD COLUMN vibes jsonb NOT NULL DEFAULT '[]';
    CREATE TABLE taste_maps (
        account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
    );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE taste_maps; ALTER TABLE taste_profile DROP COLUMN vibes")
