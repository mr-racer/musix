"""Ingest intelligence: sonic axes/tags and the energy envelope on media_files (content
level: computed once per sha256), the chain's state, and the shared per-source token
buckets and breakers every worker obeys.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-30
"""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    ALTER TABLE media_files
        ADD COLUMN axes jsonb,
        ADD COLUMN sonic_tags jsonb,
        ADD COLUMN envelope bytea,
        ADD COLUMN intel_state text NOT NULL DEFAULT 'pending'
            CHECK (intel_state IN ('pending', 'lyrics', 'indexed', 'failed')),
        ADD COLUMN intel_error text;
    CREATE INDEX media_files_intel_state_idx ON media_files (intel_state) WHERE intel_state <> 'indexed';
    CREATE TABLE rate_buckets (
        source text PRIMARY KEY,
        tokens double precision NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE source_health (
        source text PRIMARY KEY,
        failures integer NOT NULL DEFAULT 0,
        open_until timestamptz,
        last_error text
    );
    """)


def downgrade() -> None:
    op.execute("""
    DROP TABLE source_health, rate_buckets;
    ALTER TABLE media_files DROP COLUMN intel_error, DROP COLUMN intel_state,
        DROP COLUMN envelope, DROP COLUMN sonic_tags, DROP COLUMN axes;
    """)
