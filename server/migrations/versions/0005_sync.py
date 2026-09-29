"""Sync: playlist item ids are the client-side key of an item, so they are unique
across playlists (a client store keys items by id alone).

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-29
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE UNIQUE INDEX playlist_items_item_uq ON playlist_items (item_id)")
    op.execute("CREATE INDEX tracks_account_album_idx ON tracks (account_id, album_id)")


def downgrade() -> None:
    op.execute("DROP INDEX tracks_account_album_idx, playlist_items_item_uq")
