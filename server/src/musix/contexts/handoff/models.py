import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from musix.infra.tables import metadata

U = UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)

device_online = sa.Table(
    "device_online",
    metadata,
    sa.Column("device_id", U, primary_key=True),
    sa.Column("account_id", U, nullable=False),
    sa.Column("can_play", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("seen_at", TS, nullable=False, server_default=sa.func.now()),
)
playback_sessions = sa.Table(
    "playback_sessions",
    metadata,
    sa.Column("account_id", U, primary_key=True),
    sa.Column("device_id", U),
    sa.Column("state", JSONB, nullable=False),
    sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
)
