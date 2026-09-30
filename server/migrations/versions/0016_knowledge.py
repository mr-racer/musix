"""The knowledge base (phase 2 spec §5): global, keyed by song / artist, shared by every
account. Visibility is a join — an account sees knowledge about the songs and artists it
has live tracks of; there is no fact_visibility table to keep in sync.

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-30
"""

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE facts (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        subject_kind text NOT NULL CHECK (subject_kind IN ('song', 'artist')),
        subject_id uuid NOT NULL,
        lang text NOT NULL,
        text text NOT NULL,
        category text,
        source text,
        source_url text,
        created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX facts_subject_text_uq ON facts (subject_kind, subject_id, lang, md5(text));
    CREATE INDEX facts_subject_idx ON facts (subject_kind, subject_id);

    -- facts_v2: one row per (raw fact, language), written for every classified fact,
    -- including the dropped ones (text NULL): "nothing interesting" ≠ "never processed".
    CREATE TABLE fact_refinements (
        fact_id bigint NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
        lang text NOT NULL,
        labels jsonb NOT NULL DEFAULT '[]',
        text text,
        confirmed boolean NOT NULL DEFAULT true,
        src text,
        model text,
        generated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (fact_id, lang)
    );

    CREATE TABLE artist_bios (
        artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
        lang text NOT NULL,
        text text NOT NULL,
        facets jsonb NOT NULL DEFAULT '{}',
        sources jsonb NOT NULL DEFAULT '{}',
        generated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (artist_id, lang)
    );

    -- kind: producer | label | sample | interpolation | sampled_by | interpolated_by
    CREATE TABLE song_relations (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        kind text NOT NULL,
        target_text text NOT NULL,
        target_song_id uuid REFERENCES songs(id) ON DELETE SET NULL,
        target_artist_id uuid REFERENCES artists(id) ON DELETE SET NULL,
        evidence text,
        confidence real,
        verified boolean,
        source text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX song_relations_uq ON song_relations (song_id, kind, lower(target_text));
    CREATE INDEX song_relations_target_song_idx ON song_relations (target_song_id);
    CREATE INDEX song_relations_target_artist_idx ON song_relations (target_artist_id);

    CREATE TABLE song_vibes (
        song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        lang text NOT NULL,
        phrase text NOT NULL,
        generated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (song_id, lang)
    );

    CREATE TABLE artist_aliases (
        artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
        alias text NOT NULL,
        source text NOT NULL DEFAULT 'llm',
        PRIMARY KEY (artist_id, alias)
    );

    -- the negative cache: a source that had nothing for a key is not asked again soon
    CREATE TABLE source_fetch_log (
        source text NOT NULL,
        key text NOT NULL,
        status text NOT NULL,
        fetched_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (source, key)
    );

    -- MusicBrainz verdicts for sample links, by normalized artist and title
    CREATE TABLE verification_cache (
        artist_key text NOT NULL,
        title_key text NOT NULL,
        verified boolean NOT NULL,
        score integer,
        mb_artist text,
        mb_title text,
        mbid text,
        checked_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (artist_key, title_key)
    );

    -- every LLM answer, by the hash of (model, messages, params)
    CREATE TABLE llm_cache (
        key text PRIMARY KEY,
        kind text NOT NULL,
        model text NOT NULL,
        response text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX tracks_song_live_idx ON tracks (account_id, song_id) WHERE deleted_at IS NULL;
    -- bumped by every knowledge writer: the player context's ETag reads these two PKs
    ALTER TABLE songs ADD COLUMN knowledge_at timestamptz;
    ALTER TABLE artists ADD COLUMN knowledge_at timestamptz;
    -- TheAudioDB's record (bio, mood, country, label, mbid, fetchedAt); NULL = not asked yet
    ALTER TABLE artists ADD COLUMN profile jsonb;
    -- the hero's wave phrase {phrase, source: ai|fallback, lang}, by stream:ai_texts
    ALTER TABLE taste_profile ADD COLUMN wave jsonb;
    """)


def downgrade() -> None:
    op.execute("""
    ALTER TABLE songs DROP COLUMN knowledge_at;
    ALTER TABLE artists DROP COLUMN knowledge_at, DROP COLUMN profile;
    ALTER TABLE taste_profile DROP COLUMN wave;
    DROP INDEX tracks_song_live_idx;
    DROP TABLE llm_cache, verification_cache, source_fetch_log, artist_aliases, song_vibes,
        song_relations, artist_bios, fact_refinements, facts;
    """)
