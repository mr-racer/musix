"""The Yandex import remembers each track's fate and mirrors the playlists (the owner's
brief of 2026-10-12); the lossy stream tiers are gone.

- `yandex_imports.status`: `downloaded` (we fetched it), `matched` (the library already
  had the song), `failed` (a network error: the next import tries again), `unavailable`
  (no rights / no full audio / no title: never tried again by a whole-source import).
  v1's `skipped` rows were mostly timeouts, so they split by reason.
- `yandex_playlists`: a Yandex source ↔ the MusiX playlist made for it;
  `yandex_playlist_tracks`: what was ever placed there, so a track the listener removed
  from the playlist is not put back by the next import.
- `playlists.origin`: `yandex` for those playlists (the clients draw the badge).
- `renditions` of the `high`/`economy` tiers are dropped (the owner: only the original,
  plus ALAC→FLAC and Dolby→AAC copies for clients that cannot play those). Their files are
  removed by the ops step, not here.

Revision ID: 0024
Revises: 0023
Create Date: 2026-10-12
"""

from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE yandex_imports DROP CONSTRAINT IF EXISTS yandex_imports_status_check;
        UPDATE yandex_imports SET status = CASE
            WHEN reason ~* '(timed out|HTTPSConnectionPool|connection|temporar)' THEN 'failed'
            ELSE 'unavailable' END
        WHERE status = 'skipped';
        ALTER TABLE yandex_imports ADD CONSTRAINT yandex_imports_status_check
            CHECK (status IN ('downloaded', 'matched', 'failed', 'unavailable'));
        ALTER TABLE yandex_imports ADD COLUMN attempts int NOT NULL DEFAULT 1;

        CREATE TABLE yandex_playlists (
            account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            source text NOT NULL,
            playlist_id uuid NOT NULL,
            title text NOT NULL,
            synced_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (account_id, source)
        );
        CREATE TABLE yandex_playlist_tracks (
            account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            source text NOT NULL,
            yandex_track_id text NOT NULL,
            placed_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (account_id, source, yandex_track_id)
        );
        ALTER TABLE playlists ADD COLUMN origin text;

        DELETE FROM renditions WHERE tier IN ('high', 'economy');
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE yandex_playlist_tracks, yandex_playlists;
        ALTER TABLE playlists DROP COLUMN origin;
        ALTER TABLE yandex_imports DROP COLUMN attempts;
        ALTER TABLE yandex_imports DROP CONSTRAINT IF EXISTS yandex_imports_status_check;
        UPDATE yandex_imports SET status = 'skipped' WHERE status IN ('failed', 'unavailable');
        UPDATE yandex_imports SET status = 'downloaded' WHERE status = 'matched';
        ALTER TABLE yandex_imports ADD CONSTRAINT yandex_imports_status_check
            CHECK (status IN ('downloaded', 'skipped'));
    """)
