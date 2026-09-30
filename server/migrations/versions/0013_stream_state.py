"""«Поток» state (phase 2 §6.1, stream spec §3.2), maintained off the request path.

- The recommender's own outcome counters, in the SAME transaction as the listen insert
  (the listen CTE): `listens` (every event), `fulls` (≥ 85 % heard, not a skip) and
  `quick_skips` (< 30 s, or < 25 % of a track under 2 min) — per track, per primary
  artist, per genre. The definitions live in ONE place, `musix.recsys.outcome`, which
  the CTE mirrors in SQL (a parity test holds them together).
- `tracks.primary_artist_id`: the artist the recommender and the lyrics lookups mean.
- Job outputs: `taste_profile` (long-term positives, genre tolerance), `stream_genres`
  (genre centroids in CLAP + the adjacency threshold), `colisten_vectors` (PPMI-SVD).
The session is NOT a row: it is read from the account's last ≤ 50 listens at request
time — one indexed query, and a listen is reflected the moment it commits.

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-30
"""

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

# mirrors musix.recsys.outcome (and the listen CTE)
DUR = "coalesce(nullif(e.duration_ms, 0), t.duration_ms)"
QSKIP = f"(CASE WHEN {DUR} > 0 AND {DUR} < 120000 THEN e.played_ms < 0.25 * {DUR} ELSE e.played_ms < 30000 END)"
FULL = f"(NOT {QSKIP} AND {DUR} > 0 AND e.played_ms >= 0.85 * {DUR})"


def upgrade() -> None:
    op.execute("""
    ALTER TABLE tracks ADD COLUMN primary_artist_id uuid REFERENCES artists(id);
    UPDATE tracks t SET primary_artist_id = ta.artist_id
    FROM track_artists ta WHERE ta.track_id = t.id AND ta.role = 'main' AND ta.position = 0;
    CREATE INDEX tracks_primary_artist_idx ON tracks (primary_artist_id);

    ALTER TABLE account_track_stats
        ADD COLUMN listens integer NOT NULL DEFAULT 0,
        ADD COLUMN fulls integer NOT NULL DEFAULT 0,
        ADD COLUMN quick_skips integer NOT NULL DEFAULT 0;
    CREATE TABLE account_artist_stats (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        artist_id uuid NOT NULL REFERENCES artists(id),
        listens integer NOT NULL DEFAULT 0, fulls integer NOT NULL DEFAULT 0,
        quick_skips integer NOT NULL DEFAULT 0, last_heard_at timestamptz,
        PRIMARY KEY (account_id, artist_id)
    );
    CREATE INDEX account_artist_stats_artist_idx ON account_artist_stats (artist_id);
    CREATE TABLE account_genre_stats (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        genre text NOT NULL,
        listens integer NOT NULL DEFAULT 0, fulls integer NOT NULL DEFAULT 0,
        quick_skips integer NOT NULL DEFAULT 0,
        PRIMARY KEY (account_id, genre)
    );
    CREATE TABLE taste_profile (
        account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        long_positives jsonb NOT NULL DEFAULT '[]',
        genre_tolerance integer NOT NULL DEFAULT 6,
        listens_seen bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE stream_genres (
        account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        genres text[] NOT NULL,
        centroids bytea NOT NULL,
        adjacency_threshold double precision NOT NULL,
        energy_p40 double precision, energy_p60 double precision,
        updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE colisten_vectors (
        account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        track_ids uuid[] NOT NULL,
        vectors bytea NOT NULL,
        dim integer NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX taste_signals_account_created_idx ON taste_signals (account_id, created_at);
    """)
    # the new counters from the events already there
    op.execute(f"""
    WITH o AS (
        SELECT e.account_id, e.track_id, t.primary_artist_id AS artist_id,
               coalesce(nullif(t.genre, ''), 'Other') AS genre, e.started_at,
               {QSKIP} AS qskip, {FULL} AS full_
        FROM listen_events e JOIN tracks t ON t.id = e.track_id
    ),
    tr AS (
        UPDATE account_track_stats s SET listens = x.n, fulls = x.f, quick_skips = x.q
        FROM (SELECT account_id, track_id, count(*) n, count(*) FILTER (WHERE full_) f,
                     count(*) FILTER (WHERE qskip) q FROM o GROUP BY 1, 2) x
        WHERE s.account_id = x.account_id AND s.track_id = x.track_id
        RETURNING 1
    ),
    ar AS (
        INSERT INTO account_artist_stats
        SELECT account_id, artist_id, count(*), count(*) FILTER (WHERE full_),
               count(*) FILTER (WHERE qskip), max(started_at)
        FROM o WHERE artist_id IS NOT NULL GROUP BY 1, 2
        RETURNING 1
    )
    INSERT INTO account_genre_stats
    SELECT account_id, genre, count(*), count(*) FILTER (WHERE full_), count(*) FILTER (WHERE qskip)
    FROM o GROUP BY 1, 2
    """)  # noqa: S608 — constants


def downgrade() -> None:
    op.execute("""
    DROP INDEX taste_signals_account_created_idx;
    DROP TABLE colisten_vectors, stream_genres, taste_profile, account_genre_stats, account_artist_stats;
    ALTER TABLE account_track_stats DROP COLUMN quick_skips, DROP COLUMN fulls, DROP COLUMN listens;
    ALTER TABLE tracks DROP COLUMN primary_artist_id;
    """)
