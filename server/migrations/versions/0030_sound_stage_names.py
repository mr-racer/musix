"""The stage's own names (2026-10-25, the owner's per-stem review): which parts stand on the
live stage and under what name, with the moments a new part comes in inside a stem. A part the
evidence cannot name is left out («лучше неуверенное скипнуть, чем ложное дать»), so the stage
list is not the profile's `stems` (the parts the «Звук» window describes).

Revision ID: 0030
Revises: 0029
Create Date: 2026-10-25
"""

from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE sound_profiles ADD COLUMN stage jsonb NOT NULL DEFAULT '[]'::jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE sound_profiles DROP COLUMN stage")
