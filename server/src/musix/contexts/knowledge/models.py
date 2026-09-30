import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from musix.infra.tables import metadata

U = UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)

facts = sa.Table(
    "facts",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("subject_kind", sa.Text, nullable=False),  # song | artist
    sa.Column("subject_id", U, nullable=False),
    sa.Column("lang", sa.Text, nullable=False),
    sa.Column("text", sa.Text, nullable=False),
    sa.Column("category", sa.Text),
    sa.Column("source", sa.Text),
    sa.Column("source_url", sa.Text),
    sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
)
fact_refinements = sa.Table(
    "fact_refinements",
    metadata,
    sa.Column("fact_id", sa.BigInteger, sa.ForeignKey("facts.id"), primary_key=True),
    sa.Column("lang", sa.Text, primary_key=True),
    sa.Column("labels", JSONB, nullable=False),
    sa.Column("text", sa.Text),
    sa.Column("confirmed", sa.Boolean, nullable=False),
    sa.Column("src", sa.Text),
    sa.Column("model", sa.Text),
    sa.Column("generated_at", TS, nullable=False, server_default=sa.func.now()),
)
artist_bios = sa.Table(
    "artist_bios",
    metadata,
    sa.Column("artist_id", U, sa.ForeignKey("artists.id"), primary_key=True),
    sa.Column("lang", sa.Text, primary_key=True),
    sa.Column("text", sa.Text, nullable=False),
    sa.Column("facets", JSONB, nullable=False),
    sa.Column("sources", JSONB, nullable=False),
    sa.Column("generated_at", TS, nullable=False, server_default=sa.func.now()),
)
song_relations = sa.Table(
    "song_relations",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("song_id", U, sa.ForeignKey("songs.id"), nullable=False),
    sa.Column("kind", sa.Text, nullable=False),
    sa.Column("target_text", sa.Text, nullable=False),
    sa.Column("target_song_id", U, sa.ForeignKey("songs.id")),
    sa.Column("target_artist_id", U, sa.ForeignKey("artists.id")),
    sa.Column("evidence", sa.Text),
    sa.Column("confidence", sa.Float),
    sa.Column("verified", sa.Boolean),
    sa.Column("source", sa.Text, nullable=False),
    sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
)
song_vibes = sa.Table(
    "song_vibes",
    metadata,
    sa.Column("song_id", U, sa.ForeignKey("songs.id"), primary_key=True),
    sa.Column("lang", sa.Text, primary_key=True),
    sa.Column("phrase", sa.Text, nullable=False),
    sa.Column("generated_at", TS, nullable=False, server_default=sa.func.now()),
)
artist_aliases = sa.Table(
    "artist_aliases",
    metadata,
    sa.Column("artist_id", U, sa.ForeignKey("artists.id"), primary_key=True),
    sa.Column("alias", sa.Text, primary_key=True),
    sa.Column("source", sa.Text, nullable=False),
)
source_fetch_log = sa.Table(
    "source_fetch_log",
    metadata,
    sa.Column("source", sa.Text, primary_key=True),
    sa.Column("key", sa.Text, primary_key=True),
    sa.Column("status", sa.Text, nullable=False),
    sa.Column("fetched_at", TS, nullable=False, server_default=sa.func.now()),
)
verification_cache = sa.Table(
    "verification_cache",
    metadata,
    sa.Column("artist_key", sa.Text, primary_key=True),
    sa.Column("title_key", sa.Text, primary_key=True),
    sa.Column("verified", sa.Boolean, nullable=False),
    sa.Column("score", sa.Integer),
    sa.Column("mb_artist", sa.Text),
    sa.Column("mb_title", sa.Text),
    sa.Column("mbid", sa.Text),
    sa.Column("checked_at", TS, nullable=False, server_default=sa.func.now()),
)
llm_cache = sa.Table(
    "llm_cache",
    metadata,
    sa.Column("key", sa.Text, primary_key=True),
    sa.Column("kind", sa.Text, nullable=False),
    sa.Column("model", sa.Text, nullable=False),
    sa.Column("response", sa.Text, nullable=False),
    sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
)
