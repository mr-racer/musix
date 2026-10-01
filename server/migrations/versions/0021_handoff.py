"""Playback handoff «Слушать на…» (phase 8 §1): who is online and able to play, and the
account's last playback state. Both live in Postgres because each api process has its own
socket hub.

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-01
"""

from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE device_online (
        device_id uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        can_play boolean NOT NULL DEFAULT false,
        seen_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX device_online_account ON device_online (account_id, seen_at);
    CREATE TABLE playback_sessions (
        account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
        state jsonb NOT NULL,  -- PlaybackState (camelCase): trackIds, index, positionMs, playing, mode…
        updated_at timestamptz NOT NULL DEFAULT now()
    );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE playback_sessions; DROP TABLE device_online")
