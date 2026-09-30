import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from musix.infra.tables import metadata

U = UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)

quiz_rounds = sa.Table(
    "quiz_rounds",
    metadata,
    sa.Column("id", U, primary_key=True, server_default=sa.text("uuidv7()")),
    sa.Column("account_id", U, nullable=False),
    sa.Column("mode", sa.Text, nullable=False),
    sa.Column("track_id", U),
    sa.Column("spec", JSONB, nullable=False),
    sa.Column("answer", JSONB),
    sa.Column("correct", sa.Boolean),
    sa.Column("score", sa.Float),
    sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
    sa.Column("expires_at", TS, nullable=False),
    sa.Column("answered_at", TS),
)
quiz_skill = sa.Table(
    "quiz_skill",
    metadata,
    sa.Column("account_id", U, primary_key=True),
    sa.Column("mode", sa.Text, primary_key=True),
    sa.Column("skill", sa.Float, nullable=False),
    sa.Column("n_answered", sa.Integer, nullable=False),
    sa.Column("band_lo", sa.Float, nullable=False),
    sa.Column("band_hi", sa.Float, nullable=False),
    sa.Column("out_of_band", sa.Integer, nullable=False),
    sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
)
