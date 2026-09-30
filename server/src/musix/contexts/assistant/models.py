import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from musix.infra.tables import metadata

U = UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)

web_pages = sa.Table(
    "web_pages",
    metadata,
    sa.Column("url", sa.Text, primary_key=True),
    sa.Column("page", JSONB, nullable=False),
    sa.Column("fetched_at", TS, nullable=False),
)
assistant_turns = sa.Table(
    "assistant_turns",
    metadata,
    sa.Column("id", U, primary_key=True, server_default=sa.text("uuidv7()")),
    sa.Column("account_id", U, nullable=False),
    sa.Column("kind", sa.Text, nullable=False),
    sa.Column("request", JSONB, nullable=False),
    sa.Column("status", sa.Text, nullable=False, server_default="queued"),
    sa.Column("result", JSONB),
    sa.Column("error", sa.Text),
    sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
    sa.Column("finished_at", TS),
)
