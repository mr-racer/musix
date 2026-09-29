"""Listening: append-only listen events + per-track stats kept in the same transaction,
огонёк/вода signals, playlists with fractional-index positions (spec §3, §9).

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-29
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE listen_events (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        client_event_id uuid NOT NULL UNIQUE,
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
        session_id text NOT NULL,
        track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        started_at timestamptz NOT NULL,
        played_ms integer NOT NULL CHECK (played_ms >= 0),
        duration_ms integer,
        end_reason text NOT NULL CHECK (end_reason IN ('completed', 'skipped', 'stopped', 'error')),
        skipped_early boolean NOT NULL DEFAULT false,
        interacted boolean,
        influence boolean NOT NULL DEFAULT true,
        source text,
        context_type text CHECK (context_type IN ('stream', 'album', 'playlist', 'search', 'artist', 'queue', 'legacy')),
        context_id text
    );
    CREATE INDEX listen_events_started_brin ON listen_events USING brin (started_at);
    CREATE INDEX listen_events_account_started_idx ON listen_events (account_id, started_at DESC);
    CREATE INDEX listen_events_track_idx ON listen_events (track_id);
    CREATE INDEX listen_events_device_idx ON listen_events (device_id);
    CREATE TABLE account_track_stats (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        plays integer NOT NULL DEFAULT 0, completes integer NOT NULL DEFAULT 0, skips integer NOT NULL DEFAULT 0,
        total_played_ms bigint NOT NULL DEFAULT 0,
        first_played_at timestamptz, last_played_at timestamptz,
        PRIMARY KEY (account_id, track_id)
    );
    CREATE INDEX account_track_stats_track_idx ON account_track_stats (track_id);
    CREATE TABLE taste_signals (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        client_event_id uuid NOT NULL UNIQUE,
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        session_id text,
        track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK (kind IN ('fire', 'water')),
        created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX taste_signals_account_track_idx ON taste_signals (account_id, track_id, created_at DESC);
    CREATE INDEX taste_signals_track_idx ON taste_signals (track_id);
    CREATE TABLE playlists (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name text NOT NULL, description text, cover_image_id text REFERENCES images(id),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
    );
    CREATE INDEX playlists_account_idx ON playlists (account_id);
    CREATE INDEX playlists_cover_idx ON playlists (cover_image_id);
    CREATE TABLE playlist_items (
        playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        item_id uuid NOT NULL,
        track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        position text COLLATE "C" NOT NULL,
        added_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
        PRIMARY KEY (playlist_id, item_id)
    );
    CREATE INDEX playlist_items_order_idx ON playlist_items (playlist_id, position) WHERE deleted_at IS NULL;
    CREATE INDEX playlist_items_track_idx ON playlist_items (track_id);
    """)


def downgrade() -> None:
    op.execute(
        "DROP TABLE playlist_items, playlists, taste_signals, account_track_stats, listen_events"
    )
