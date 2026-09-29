"""Screens: credits read from tags at ingest (the player context shows them), and the
`Idempotency-Key` store for mutating POSTs (spec §6).

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-30
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    ALTER TABLE media_files ADD COLUMN credits jsonb;
    CREATE TABLE idempotency_keys (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        key text NOT NULL,
        request_hash bytea NOT NULL,
        status integer,
        headers jsonb,
        body bytea,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, key)
    );
    CREATE INDEX idempotency_keys_created_brin ON idempotency_keys USING brin (created_at);
    """)


def downgrade() -> None:
    op.execute("DROP TABLE idempotency_keys; ALTER TABLE media_files DROP COLUMN credits")
