import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, BYTEA, JSONB, UUID

from musix.infra.tables import metadata

U = UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)

gpu_lease = sa.Table(
    "gpu_lease",
    metadata,
    sa.Column("id", sa.SmallInteger, primary_key=True),
    sa.Column("holder", sa.Text, nullable=False),
    sa.Column("changed_at", TS, nullable=False, server_default=sa.func.now()),
    sa.Column("reason", sa.Text),
)
sound_analysis = sa.Table(
    "sound_analysis",
    metadata,
    sa.Column("media_file_id", U, sa.ForeignKey("media_files.id"), primary_key=True),
    sa.Column("state", sa.Text, nullable=False, server_default="pending"),
    sa.Column("priority", sa.SmallInteger, nullable=False, server_default="0"),
    sa.Column("attempts", sa.SmallInteger, nullable=False, server_default="0"),
    sa.Column("error", sa.Text),
    sa.Column("keep_stems", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("extractor_ver", sa.SmallInteger),
    sa.Column("measures", JSONB),
    sa.Column("stage_frames", BYTEA),
    sa.Column("gpu_ms", sa.Integer),
    sa.Column("cpu_ms", sa.Integer),
    sa.Column("queued_at", TS, nullable=False, server_default=sa.func.now()),
    sa.Column("analysed_at", TS),
)
sound_profiles = sa.Table(
    "sound_profiles",
    metadata,
    sa.Column("media_file_id", U, sa.ForeignKey("media_files.id"), primary_key=True),
    sa.Column("derive_ver", sa.SmallInteger, nullable=False),
    sa.Column("space", sa.SmallInteger),
    sa.Column("tech", sa.SmallInteger),
    sa.Column("odd", sa.SmallInteger),
    sa.Column("facets", JSONB, nullable=False),
    sa.Column("evidence", JSONB, nullable=False),
    sa.Column("instruments", ARRAY(sa.Text), nullable=False, server_default="{}"),
    sa.Column("drums", sa.Text),
    sa.Column("vocals", sa.Text),
    sa.Column("vocal_share", sa.REAL),
    sa.Column("pace", sa.Text),
    sa.Column("feel", sa.Text),
    sa.Column("felt_bpm", sa.REAL),
    sa.Column("echo", sa.Text),
    sa.Column("width", sa.Text),
    sa.Column("stems", JSONB, nullable=False),
    sa.Column("traits", ARRAY(sa.Text), nullable=False, server_default="{}"),
    sa.Column("feat", ARRAY(sa.REAL), nullable=False),
    sa.Column("sections", JSONB, nullable=False),
    sa.Column("moments", JSONB, nullable=False),
    sa.Column("derived_at", TS, nullable=False, server_default=sa.func.now()),
)
sound_texts = sa.Table(
    "sound_texts",
    metadata,
    sa.Column("subject_kind", sa.Text, primary_key=True),
    sa.Column("subject_id", U, primary_key=True),
    sa.Column("kind", sa.Text, primary_key=True),
    sa.Column("lang", sa.Text, primary_key=True),
    sa.Column("state", sa.Text, nullable=False),
    sa.Column("text", sa.Text),
    sa.Column("facts", JSONB, nullable=False),
    sa.Column("facts_hash", sa.Text, nullable=False),
    sa.Column("model", sa.Text),
    sa.Column("generated_at", TS, nullable=False, server_default=sa.func.now()),
)
