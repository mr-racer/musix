import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from musix.infra.tables import metadata

U = UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)

listen_events = sa.Table(
    "listen_events",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("client_event_id", U, nullable=False, unique=True),
    sa.Column("account_id", U, nullable=False),
    sa.Column("device_id", U),
    sa.Column("session_id", sa.Text, nullable=False),
    sa.Column("track_id", U, nullable=False),
    sa.Column("started_at", TS, nullable=False),
    sa.Column("played_ms", sa.Integer, nullable=False),
    sa.Column("duration_ms", sa.Integer),
    sa.Column("end_reason", sa.Text, nullable=False),
    sa.Column("skipped_early", sa.Boolean, nullable=False),
    sa.Column("interacted", sa.Boolean),
    sa.Column("influence", sa.Boolean, nullable=False),
    sa.Column("source", sa.Text),
    sa.Column("context_type", sa.Text),
    sa.Column("context_id", sa.Text),
)
account_track_stats = sa.Table(
    "account_track_stats",
    metadata,
    sa.Column("account_id", U, primary_key=True),
    sa.Column("track_id", U, primary_key=True),
    sa.Column("plays", sa.Integer, nullable=False),
    sa.Column("completes", sa.Integer, nullable=False),
    sa.Column("skips", sa.Integer, nullable=False),
    sa.Column("total_played_ms", sa.BigInteger, nullable=False),
    sa.Column("first_played_at", TS),
    sa.Column("last_played_at", TS),
)
taste_signals = sa.Table(
    "taste_signals",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("client_event_id", U, nullable=False, unique=True),
    sa.Column("account_id", U, nullable=False),
    sa.Column("session_id", sa.Text),
    sa.Column("track_id", U, nullable=False),
    sa.Column("kind", sa.Text, nullable=False),
    sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
)
