"""Phase-1 bench fixes: «recent» walks an index instead of sorting every stats row.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-30
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX account_track_stats_recent_idx "
        "ON account_track_stats (account_id, last_played_at DESC NULLS LAST)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX account_track_stats_recent_idx")
