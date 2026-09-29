"""change_log keyed by (account_id, seq).

With the primary key on `seq` alone, `max(seq) WHERE account_id = …` (every ETag) and the
/sync delta scan planned a backward walk of the PK, filtering out every other account's
newer rows (47k of them in the phase-1 bench, 3–5 ms a call). With (account_id, seq) as
the only index holding seq, both are a single index descent.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-30
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    ALTER TABLE change_log DROP CONSTRAINT change_log_pkey;
    ALTER TABLE change_log ADD CONSTRAINT change_log_pkey PRIMARY KEY (account_id, seq);
    DROP INDEX change_log_account_seq_idx;
    """)


def downgrade() -> None:
    op.execute("""
    CREATE INDEX change_log_account_seq_idx ON change_log (account_id, seq);
    ALTER TABLE change_log DROP CONSTRAINT change_log_pkey;
    ALTER TABLE change_log ADD CONSTRAINT change_log_pkey PRIMARY KEY (seq);
    """)
