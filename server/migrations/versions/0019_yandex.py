"""The Yandex Music import (phase 2 spec §7): the account link (token Fernet-encrypted),
device-flow sessions (shared by every api worker), and the per-account record of what
was imported — a track already imported is not downloaded again; a file whose content
the server has is not stored twice (dedup by sha256, as every upload).

Revision ID: 0019
Revises: 0018
Create Date: 2026-09-30
"""

from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE yandex_links (
        account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        token_enc text NOT NULL,
        yandex_uid text,
        login text,
        expires_at timestamptz,
        linked_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE yandex_auth (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        device_code_enc text NOT NULL,
        user_code text NOT NULL,
        verification_url text NOT NULL,
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'authorized', 'expired', 'error')),
        reason text,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE yandex_imports (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        yandex_track_id text NOT NULL,
        status text NOT NULL CHECK (status IN ('downloaded', 'skipped')),
        reason text,
        media_file_id uuid,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, yandex_track_id)
    );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE yandex_imports, yandex_auth, yandex_links")
