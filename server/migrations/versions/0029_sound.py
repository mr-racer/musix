"""The sound engine (spec 2026-10-24-sound-engine-design §7): the GPU lease between `ml`
and `ml-sound`, and the three layers of a song's sound — raw measures (what only the GPU can
give), the derived profile the product reads, and validated LLM texts. Keyed by content
(media_file_id), like axes and the envelope, so a file several accounts own is analysed once.

Revision ID: 0029
Revises: 0028
Create Date: 2026-10-24
"""

from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    -- one row: who holds the card. Only sound:tick changes it (under an advisory lock)
    CREATE TABLE gpu_lease (
        id smallint PRIMARY KEY CHECK (id = 1),
        holder text NOT NULL CHECK (holder IN ('ml', 'sound')),
        changed_at timestamptz NOT NULL DEFAULT now(),
        reason text
    );
    INSERT INTO gpu_lease (id, holder, reason) VALUES (1, 'ml', 'migration 0029');

    -- layer 1. priority: 100 = an upload, 0..99 = backfill by plays
    CREATE TABLE sound_analysis (
        media_file_id uuid PRIMARY KEY REFERENCES media_files(id) ON DELETE CASCADE,
        state text NOT NULL DEFAULT 'pending'
            CHECK (state IN ('pending', 'running', 'done', 'failed', 'skipped')),
        priority smallint NOT NULL DEFAULT 0,
        attempts smallint NOT NULL DEFAULT 0,
        error text,
        keep_stems boolean NOT NULL DEFAULT false,
        extractor_ver smallint,
        measures jsonb,
        stage_frames bytea,
        gpu_ms integer,
        cpu_ms integer,
        queued_at timestamptz NOT NULL DEFAULT now(),
        analysed_at timestamptz
    );
    CREATE INDEX sound_analysis_pending_idx ON sound_analysis (priority DESC, queued_at)
        WHERE state = 'pending';

    -- layer 2: derive's output; words are keys, rendered at read time
    CREATE TABLE sound_profiles (
        media_file_id uuid PRIMARY KEY REFERENCES media_files(id) ON DELETE CASCADE,
        derive_ver smallint NOT NULL,
        space smallint,
        tech smallint,
        odd smallint,
        facets jsonb NOT NULL,
        evidence jsonb NOT NULL,
        instruments text[] NOT NULL DEFAULT '{}',
        drums text,
        vocals text,
        vocal_share real,
        pace text,
        feel text,
        felt_bpm real,
        echo text,
        width text,
        stems jsonb NOT NULL,
        traits text[] NOT NULL DEFAULT '{}',
        feat real[] NOT NULL,
        sections jsonb NOT NULL,
        moments jsonb NOT NULL,
        derived_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX sound_profiles_instruments_idx ON sound_profiles USING gin (instruments);
    CREATE INDEX sound_profiles_traits_idx ON sound_profiles USING gin (traits);

    -- layer 3: LLM texts, saved only after the editor pass and the code check
    CREATE TABLE sound_texts (
        subject_kind text NOT NULL CHECK (subject_kind IN ('media_file', 'album', 'artist')),
        subject_id uuid NOT NULL,
        kind text NOT NULL,
        lang text NOT NULL,
        state text NOT NULL CHECK (state IN ('ok', 'none', 'rejected')),
        text text,
        facts jsonb NOT NULL,
        facts_hash text NOT NULL,
        model text,
        generated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (subject_kind, subject_id, kind, lang)
    );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE sound_texts, sound_profiles, sound_analysis, gpu_lease")
