"""Identity: accounts, devices, rotating refresh tokens, invites, instance, settings;
plus the per-account change_log every synced mutation writes (spec §3, §7).

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-29
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.execute("""
    CREATE TABLE accounts (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        email citext NOT NULL UNIQUE,
        password_hash text NOT NULL,
        role text NOT NULL CHECK (role IN ('owner', 'member')),
        display_name text,
        index_root text,
        premium boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_login_at timestamptz
    );
    CREATE TABLE devices (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name text NOT NULL,
        platform text NOT NULL CHECK (platform IN ('android', 'windows', 'web')),
        app_version text,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz
    );
    CREATE INDEX devices_account_idx ON devices (account_id);
    CREATE TABLE refresh_tokens (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        family_id uuid NOT NULL,
        token_hash bytea NOT NULL UNIQUE,
        issued_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        rotated_at timestamptz,
        revoked_at timestamptz
    );
    CREATE INDEX refresh_tokens_device_idx ON refresh_tokens (device_id);
    CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
    CREATE TABLE invites (
        code text PRIMARY KEY,
        created_by uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        consumed_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
        consumed_at timestamptz
    );
    CREATE INDEX invites_created_by_idx ON invites (created_by);
    CREATE INDEX invites_consumed_by_idx ON invites (consumed_by);
    CREATE TABLE instance (
        id boolean PRIMARY KEY DEFAULT true CHECK (id),
        mode text NOT NULL CHECK (mode IN ('personal', 'shared')),
        created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE instance_settings (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE account_settings (
        account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        value jsonb NOT NULL DEFAULT '{}',
        updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE change_log (
        seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        entity text NOT NULL,
        entity_id text NOT NULL,
        op text NOT NULL CHECK (op IN ('upsert', 'delete')),
        at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX change_log_account_seq_idx ON change_log (account_id, seq);
    """)


def downgrade() -> None:
    op.execute(
        "DROP TABLE change_log, account_settings, instance_settings, instance, invites, "
        "refresh_tokens, devices, accounts"
    )
