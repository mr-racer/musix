import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

from musix.infra.tables import metadata

U = UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)

taste_profile = sa.Table(
    "taste_profile",
    metadata,
    sa.Column("account_id", U, primary_key=True),
    sa.Column("long_positives", JSONB, nullable=False),
    sa.Column("genre_tolerance", sa.Integer, nullable=False),
    sa.Column("listens_seen", sa.BigInteger, nullable=False),
    sa.Column("updated_at", TS, nullable=False),
    sa.Column("vibes", JSONB, nullable=False, server_default="[]"),
    sa.Column("wave", JSONB),
)
taste_maps = sa.Table(
    "taste_maps",
    metadata,
    sa.Column("account_id", U, primary_key=True),
    sa.Column("data", JSONB, nullable=False),
    sa.Column("updated_at", TS, nullable=False),
)
stream_genres = sa.Table(
    "stream_genres",
    metadata,
    sa.Column("account_id", U, primary_key=True),
    sa.Column("genres", ARRAY(sa.Text), nullable=False),
    sa.Column("centroids", sa.LargeBinary, nullable=False),
    sa.Column("adjacency_threshold", sa.Float, nullable=False),
    sa.Column("energy_p40", sa.Float),
    sa.Column("energy_p60", sa.Float),
    sa.Column("updated_at", TS, nullable=False),
)
colisten_vectors = sa.Table(
    "colisten_vectors",
    metadata,
    sa.Column("account_id", U, primary_key=True),
    sa.Column("track_ids", ARRAY(U), nullable=False),
    sa.Column("vectors", sa.LargeBinary, nullable=False),
    sa.Column("dim", sa.Integer, nullable=False),
    sa.Column("updated_at", TS, nullable=False),
)
