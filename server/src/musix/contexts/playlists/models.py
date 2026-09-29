import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from musix.infra.tables import metadata

U = UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)

playlists = sa.Table(
    "playlists",
    metadata,
    sa.Column("id", U, primary_key=True, server_default=sa.text("uuidv7()")),
    sa.Column("account_id", U, nullable=False),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("description", sa.Text),
    sa.Column("cover_image_id", sa.Text),
    sa.Column("created_at", TS, server_default=sa.func.now()),
    sa.Column("updated_at", TS, server_default=sa.func.now()),
    sa.Column("deleted_at", TS),
)
playlist_items = sa.Table(
    "playlist_items",
    metadata,
    sa.Column("playlist_id", U, primary_key=True),
    sa.Column("item_id", U, primary_key=True),
    sa.Column("track_id", U, nullable=False),
    sa.Column("position", sa.Text(collation="C"), nullable=False),
    sa.Column("added_at", TS, server_default=sa.func.now()),
    sa.Column("deleted_at", TS),
)
