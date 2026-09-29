"""Content (shared by sha256), the canonical catalog, per-account library, uploads, jobs
(spec §3). Tag-derived metadata lives in `tracks` only.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-29
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE media_files (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        sha256 text NOT NULL UNIQUE,
        storage text NOT NULL CHECK (storage IN ('managed', 'reference')),
        path text NOT NULL,
        size_bytes bigint NOT NULL,
        mtime double precision,
        container text, codec text, sample_rate integer, bit_depth integer, channels integer,
        bitrate_kbps integer, duration_ms integer,
        lufs_integrated real, true_peak_dbtp real, loudness_range real,
        state text NOT NULL DEFAULT 'hashed'
            CHECK (state IN ('hashed', 'probed', 'registered', 'media_done', 'failed')),
        error text,
        created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX media_files_path_idx ON media_files (path);
    CREATE TABLE renditions (
        media_file_id uuid NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
        tier text NOT NULL CHECK (tier IN ('economy', 'high', 'lossless_compat')),
        path text NOT NULL, codec text NOT NULL, bitrate_kbps integer, size_bytes bigint NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (media_file_id, tier)
    );
    CREATE TABLE images (
        id text PRIMARY KEY,
        kind text NOT NULL CHECK (kind IN ('cover', 'artist', 'artist_cutout')),
        width integer, height integer,
        variants jsonb NOT NULL DEFAULT '{}', palette jsonb, blurhash text,
        created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE lyrics (
        media_file_id uuid PRIMARY KEY REFERENCES media_files(id) ON DELETE CASCADE,
        text text NOT NULL, source text NOT NULL, language text, synced_lrc text,
        sanitized_at timestamptz
    );
    CREATE TABLE artists (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        slug text NOT NULL UNIQUE, name text NOT NULL, sort_name text, mbid text,
        image_id text REFERENCES images(id), cutout_id text REFERENCES images(id)
    );
    CREATE INDEX artists_image_idx ON artists (image_id);
    CREATE INDEX artists_cutout_idx ON artists (cutout_id);
    CREATE TABLE songs (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        slug text NOT NULL UNIQUE, title text NOT NULL,
        primary_artist_id uuid REFERENCES artists(id), mbid text
    );
    CREATE INDEX songs_primary_artist_idx ON songs (primary_artist_id);
    CREATE TABLE albums (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        title text NOT NULL, norm_title text NOT NULL,
        album_artist_id uuid REFERENCES artists(id), year integer,
        cover_image_id text REFERENCES images(id)
    );
    CREATE UNIQUE INDEX albums_identity_uq ON albums (album_artist_id, norm_title, coalesce(year, 0));
    CREATE INDEX albums_cover_idx ON albums (cover_image_id);
    CREATE TABLE tracks (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        media_file_id uuid NOT NULL REFERENCES media_files(id),
        song_id uuid REFERENCES songs(id), album_id uuid REFERENCES albums(id),
        title text NOT NULL, title_display text, artist_display text NOT NULL DEFAULT '',
        disc_no integer, track_no integer, year integer, genre text, duration_ms integer,
        cover_image_id text REFERENCES images(id),
        added_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        UNIQUE (account_id, media_file_id)
    );
    CREATE INDEX tracks_media_file_idx ON tracks (media_file_id);
    CREATE INDEX tracks_song_idx ON tracks (song_id);
    CREATE INDEX tracks_album_idx ON tracks (album_id);
    CREATE INDEX tracks_cover_idx ON tracks (cover_image_id);
    CREATE INDEX tracks_account_added_idx ON tracks (account_id, added_at DESC) WHERE deleted_at IS NULL;
    CREATE TABLE track_artists (
        track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        artist_id uuid NOT NULL REFERENCES artists(id),
        role text NOT NULL CHECK (role IN ('main', 'feat')),
        position integer NOT NULL,
        PRIMARY KEY (track_id, artist_id, role)
    );
    CREATE INDEX track_artists_artist_idx ON track_artists (artist_id);
    CREATE TABLE uploads (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        sha256 text NOT NULL, size_bytes bigint NOT NULL, offset_bytes bigint NOT NULL DEFAULT 0,
        filename text NOT NULL,
        state text NOT NULL DEFAULT 'receiving'
            CHECK (state IN ('receiving', 'verifying', 'done', 'failed')),
        error text,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX uploads_account_idx ON uploads (account_id);
    CREATE TABLE jobs (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        kind text NOT NULL, state text NOT NULL DEFAULT 'running'
            CHECK (state IN ('running', 'done', 'failed')),
        total integer NOT NULL DEFAULT 0, done integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX jobs_account_idx ON jobs (account_id);
    """)


def downgrade() -> None:
    op.execute(
        "DROP TABLE jobs, uploads, track_artists, tracks, albums, songs, artists, lyrics, images, "
        "renditions, media_files"
    )
