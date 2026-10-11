"""Achievements of the library's statistics (the owner's brief of 2026-10-11): what each
account has earned, once, with the day; and per account the UTC offset its clients last
reported (rules count local days) and when its history was first counted (that first count
is silent, so nobody gets five pop-ups at once).

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-11
"""

from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE account_achievements (
            account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            code text NOT NULL,
            earned_at timestamptz NOT NULL DEFAULT now(),
            note text,
            PRIMARY KEY (account_id, code)
        )
    """)
    op.execute("""
        CREATE TABLE account_achievement_state (
            account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
            tz_minutes int NOT NULL DEFAULT 180,
            seeded_at timestamptz
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE account_achievement_state")
    op.execute("DROP TABLE account_achievements")
