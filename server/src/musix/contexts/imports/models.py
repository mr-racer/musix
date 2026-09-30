import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from musix.infra.tables import metadata

U = UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)

yandex_links = sa.Table(
    "yandex_links",
    metadata,
    sa.Column("account_id", U, primary_key=True),
    sa.Column("token_enc", sa.Text, nullable=False),
    sa.Column("yandex_uid", sa.Text),
    sa.Column("login", sa.Text),
    sa.Column("expires_at", TS),
    sa.Column("linked_at", TS, nullable=False, server_default=sa.func.now()),
)
yandex_auth = sa.Table(
    "yandex_auth",
    metadata,
    sa.Column("id", U, primary_key=True, server_default=sa.text("uuidv7()")),
    sa.Column("account_id", U, nullable=False),
    sa.Column("device_code_enc", sa.Text, nullable=False),
    sa.Column("user_code", sa.Text, nullable=False),
    sa.Column("verification_url", sa.Text, nullable=False),
    sa.Column("status", sa.Text, nullable=False, server_default="pending"),
    sa.Column("reason", sa.Text),
    sa.Column("expires_at", TS, nullable=False),
    sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
)
yandex_imports = sa.Table(
    "yandex_imports",
    metadata,
    sa.Column("account_id", U, primary_key=True),
    sa.Column("yandex_track_id", sa.Text, primary_key=True),
    sa.Column("status", sa.Text, nullable=False),
    sa.Column("reason", sa.Text),
    sa.Column("media_file_id", U),
    sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
)
