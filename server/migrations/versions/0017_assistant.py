"""The assistant (phase 2 spec §7): a turn is a job, its result a row; the page store is
a table shared across accounts (the web is public), 7 days.

Revision ID: 0017
Revises: 0016
Create Date: 2026-09-30
"""

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE web_pages (
        url text PRIMARY KEY,  -- canonical
        page jsonb NOT NULL,   -- title, markdown, source, meta, fetcher, html
        fetched_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX web_pages_fetched_idx ON web_pages (fetched_at);

    -- kind: assistant | track_chat | chat | playlist
    CREATE TABLE assistant_turns (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        kind text NOT NULL,
        request jsonb NOT NULL,
        status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error')),
        result jsonb,
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz
    );
    CREATE INDEX assistant_turns_account_idx ON assistant_turns (account_id, created_at DESC);
    """)


def downgrade() -> None:
    op.execute("DROP TABLE assistant_turns, web_pages")
