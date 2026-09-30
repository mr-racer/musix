"""The quiz (phase 2 spec §7): rounds, the per-mode adaptive skill, the daily streak.
Invariant I-1/I-2: nothing here writes listens or signals — a quiz snippet is not a play.

Revision ID: 0018
Revises: 0017
Create Date: 2026-09-30
"""

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE quiz_rounds (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        mode text NOT NULL,
        track_id uuid,
        spec jsonb NOT NULL,       -- options, correct_option_id, window, reveal, meta
        answer jsonb,
        correct boolean,
        score real,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        answered_at timestamptz
    );
    CREATE INDEX quiz_rounds_recent_idx ON quiz_rounds (account_id, mode, created_at DESC);

    CREATE TABLE quiz_skill (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        mode text NOT NULL,
        skill real NOT NULL,
        n_answered integer NOT NULL DEFAULT 0,
        band_lo real NOT NULL,
        band_hi real NOT NULL,
        out_of_band integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, mode)
    );

    -- v1's daily-set streak table (kept apart from the listening streak); no v1 code
    -- writes it yet, the shape is carried so the daily set lands without a migration
    CREATE TABLE quiz_streak (
        account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        current integer NOT NULL DEFAULT 0,
        best integer NOT NULL DEFAULT 0,
        last_day date
    );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE quiz_streak, quiz_skill, quiz_rounds")
