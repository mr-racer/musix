import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from musix.infra.tables import metadata

U = UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)

media_files = sa.Table(
    "media_files",
    metadata,
    sa.Column("id", U, primary_key=True, server_default=sa.text("uuidv7()")),
    sa.Column("sha256", sa.Text, nullable=False, unique=True),
    sa.Column("storage", sa.Text, nullable=False),
    sa.Column("path", sa.Text, nullable=False),
    sa.Column("size_bytes", sa.BigInteger, nullable=False),
    sa.Column("mtime", sa.Float),
    sa.Column("container", sa.Text),
    sa.Column("codec", sa.Text),
    sa.Column("sample_rate", sa.Integer),
    sa.Column("bit_depth", sa.Integer),
    sa.Column("channels", sa.Integer),
    sa.Column("bitrate_kbps", sa.Integer),
    sa.Column("duration_ms", sa.Integer),
    sa.Column("lufs_integrated", sa.Float),
    sa.Column("true_peak_dbtp", sa.Float),
    sa.Column("loudness_range", sa.Float),
    sa.Column("credits", JSONB),
    # intel (migration 0009): content-level, computed once per sha256
    sa.Column("axes", JSONB),
    sa.Column("sonic_tags", JSONB),
    sa.Column("envelope", sa.LargeBinary),
    sa.Column("intel_state", sa.Text, nullable=False, server_default="pending"),
    sa.Column("intel_error", sa.Text),
    sa.Column("state", sa.Text, nullable=False, server_default="hashed"),
    sa.Column("error", sa.Text),
    sa.Column("created_at", TS, server_default=sa.func.now()),
)
renditions = sa.Table(
    "renditions",
    metadata,
    sa.Column("media_file_id", U, sa.ForeignKey("media_files.id"), primary_key=True),
    sa.Column("tier", sa.Text, primary_key=True),
    sa.Column("path", sa.Text, nullable=False),
    sa.Column("codec", sa.Text, nullable=False),
    sa.Column("bitrate_kbps", sa.Integer),
    sa.Column("size_bytes", sa.BigInteger, nullable=False),
    sa.Column("created_at", TS, server_default=sa.func.now()),
)
images = sa.Table(
    "images",
    metadata,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("kind", sa.Text, nullable=False),
    sa.Column("width", sa.Integer),
    sa.Column("height", sa.Integer),
    sa.Column("variants", JSONB, nullable=False, server_default=sa.text("'{}'")),
    sa.Column("palette", JSONB),
    sa.Column("blurhash", sa.Text),
    sa.Column("created_at", TS, server_default=sa.func.now()),
)
lyrics = sa.Table(
    "lyrics",
    metadata,
    sa.Column("media_file_id", U, sa.ForeignKey("media_files.id"), primary_key=True),
    sa.Column("text", sa.Text, nullable=False),
    sa.Column("source", sa.Text, nullable=False),
    sa.Column("language", sa.Text),
    sa.Column("synced_lrc", sa.Text),
    sa.Column("sanitized_at", TS),
)
artists = sa.Table(
    "artists",
    metadata,
    sa.Column("id", U, primary_key=True, server_default=sa.text("uuidv7()")),
    sa.Column("slug", sa.Text, nullable=False, unique=True),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("sort_name", sa.Text),
    sa.Column("mbid", sa.Text),
    sa.Column("image_id", sa.Text, sa.ForeignKey("images.id")),
    sa.Column("cutout_id", sa.Text, sa.ForeignKey("images.id")),
)
songs = sa.Table(
    "songs",
    metadata,
    sa.Column("id", U, primary_key=True, server_default=sa.text("uuidv7()")),
    sa.Column("slug", sa.Text, nullable=False, unique=True),
    sa.Column("title", sa.Text, nullable=False),
    sa.Column("primary_artist_id", U, sa.ForeignKey("artists.id")),
    sa.Column("mbid", sa.Text),
)
albums = sa.Table(
    "albums",
    metadata,
    sa.Column("id", U, primary_key=True, server_default=sa.text("uuidv7()")),
    sa.Column("title", sa.Text, nullable=False),
    sa.Column("norm_title", sa.Text, nullable=False),
    sa.Column("album_artist_id", U, sa.ForeignKey("artists.id")),
    sa.Column("year", sa.Integer),
    sa.Column("cover_image_id", sa.Text, sa.ForeignKey("images.id")),
)
tracks = sa.Table(
    "tracks",
    metadata,
    sa.Column("id", U, primary_key=True, server_default=sa.text("uuidv7()")),
    sa.Column("account_id", U, sa.ForeignKey("accounts.id"), nullable=False),
    sa.Column("media_file_id", U, sa.ForeignKey("media_files.id"), nullable=False),
    sa.Column("song_id", U, sa.ForeignKey("songs.id")),
    sa.Column("album_id", U, sa.ForeignKey("albums.id")),
    sa.Column("title", sa.Text, nullable=False),
    sa.Column("title_display", sa.Text),
    sa.Column("artist_display", sa.Text, nullable=False, server_default=""),
    sa.Column("disc_no", sa.Integer),
    sa.Column("track_no", sa.Integer),
    sa.Column("year", sa.Integer),
    sa.Column("genre", sa.Text),
    sa.Column("duration_ms", sa.Integer),
    sa.Column("cover_image_id", sa.Text, sa.ForeignKey("images.id")),
    sa.Column("added_at", TS, server_default=sa.func.now()),
    sa.Column("updated_at", TS, server_default=sa.func.now()),
    sa.Column("deleted_at", TS),
)
track_artists = sa.Table(
    "track_artists",
    metadata,
    sa.Column("track_id", U, sa.ForeignKey("tracks.id"), primary_key=True),
    sa.Column("artist_id", U, sa.ForeignKey("artists.id"), primary_key=True),
    sa.Column("role", sa.Text, primary_key=True),
    sa.Column("position", sa.Integer, nullable=False),
)
uploads = sa.Table(
    "uploads",
    metadata,
    sa.Column("id", U, primary_key=True, server_default=sa.text("uuidv7()")),
    sa.Column("account_id", U, sa.ForeignKey("accounts.id"), nullable=False),
    sa.Column("sha256", sa.Text, nullable=False),
    sa.Column("size_bytes", sa.BigInteger, nullable=False),
    sa.Column("offset_bytes", sa.BigInteger, nullable=False, server_default="0"),
    sa.Column("filename", sa.Text, nullable=False),
    sa.Column("state", sa.Text, nullable=False, server_default="receiving"),
    sa.Column("error", sa.Text),
    sa.Column("created_at", TS, server_default=sa.func.now()),
    sa.Column("updated_at", TS, server_default=sa.func.now()),
)
jobs = sa.Table(
    "jobs",
    metadata,
    sa.Column("id", U, primary_key=True, server_default=sa.text("uuidv7()")),
    sa.Column("account_id", U, sa.ForeignKey("accounts.id"), nullable=False),
    sa.Column("kind", sa.Text, nullable=False),
    sa.Column("state", sa.Text, nullable=False, server_default="running"),
    sa.Column("total", sa.Integer, nullable=False, server_default="0"),
    sa.Column("done", sa.Integer, nullable=False, server_default="0"),
    sa.Column("created_at", TS, server_default=sa.func.now()),
    sa.Column("updated_at", TS, server_default=sa.func.now()),
)
