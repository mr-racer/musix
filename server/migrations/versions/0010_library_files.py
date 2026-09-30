"""Each account's own index of the files on disk it registered.

`media_files.path` is ONE canonical path per content. An account whose copy of the same
bytes lives elsewhere (another folder, another account's library) could not be matched
by it, so every scan re-hashed that file. The scan now reads this table: (account,
path, size, mtime) → the media file. It is also what a later scan compares to notice a
file removed from the account's folder.

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-30
"""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE library_files (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        path text NOT NULL,
        size_bytes bigint NOT NULL,
        mtime double precision,
        media_file_id uuid NOT NULL REFERENCES media_files(id),
        seen_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, path)
    );
    CREATE INDEX library_files_media_idx ON library_files (media_file_id);
    INSERT INTO library_files (account_id, path, size_bytes, mtime, media_file_id)
    SELECT DISTINCT ON (t.account_id, m.path) t.account_id, m.path, m.size_bytes, m.mtime, m.id
    FROM tracks t JOIN media_files m ON m.id = t.media_file_id
    WHERE m.storage = 'reference';
    """)


def downgrade() -> None:
    op.execute("DROP TABLE library_files")
