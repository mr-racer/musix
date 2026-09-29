import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import BYTEA, CITEXT, JSONB, UUID

from musix.infra.tables import metadata

accounts = sa.Table(
    "accounts",
    metadata,
    sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuidv7()")),
    sa.Column("email", CITEXT, nullable=False, unique=True),
    sa.Column("password_hash", sa.Text, nullable=False),
    sa.Column("role", sa.Text, nullable=False),
    sa.Column("display_name", sa.Text),
    sa.Column("index_root", sa.Text),
    sa.Column("premium", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("last_login_at", sa.DateTime(timezone=True)),
)
devices = sa.Table(
    "devices",
    metadata,
    sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuidv7()")),
    sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("accounts.id"), nullable=False),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("platform", sa.Text, nullable=False),
    sa.Column("app_version", sa.Text),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("revoked_at", sa.DateTime(timezone=True)),
)
refresh_tokens = sa.Table(
    "refresh_tokens",
    metadata,
    sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuidv7()")),
    sa.Column("device_id", UUID(as_uuid=True), sa.ForeignKey("devices.id"), nullable=False),
    sa.Column("family_id", UUID(as_uuid=True), nullable=False),
    sa.Column("token_hash", BYTEA, nullable=False, unique=True),
    sa.Column("issued_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("rotated_at", sa.DateTime(timezone=True)),
    sa.Column("revoked_at", sa.DateTime(timezone=True)),
)
invites = sa.Table(
    "invites",
    metadata,
    sa.Column("code", sa.Text, primary_key=True),
    sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("accounts.id"), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("consumed_by", UUID(as_uuid=True), sa.ForeignKey("accounts.id")),
    sa.Column("consumed_at", sa.DateTime(timezone=True)),
)
instance = sa.Table(
    "instance",
    metadata,
    sa.Column("id", sa.Boolean, primary_key=True, server_default=sa.true()),
    sa.Column("mode", sa.Text, nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
)
account_settings = sa.Table(
    "account_settings",
    metadata,
    sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("accounts.id"), primary_key=True),
    sa.Column("value", JSONB, nullable=False, server_default=sa.text("'{}'")),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
)
