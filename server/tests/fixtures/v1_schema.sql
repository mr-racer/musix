-- v1's schema (app/resources/metadata_db.py), the tables the migrator's test fills. Schema only.

CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'member'
                        CHECK (role IN ('owner', 'member')),
        created_at    REAL NOT NULL,
        last_login_at REAL,
        premium       INTEGER NOT NULL DEFAULT 0
    , text_model_name TEXT NOT NULL DEFAULT 'jinaai/jina-embeddings-v2-small-en', clap_enabled INTEGER NOT NULL DEFAULT 1, index_root TEXT);

CREATE TABLE collection_settings (
        collection_name TEXT PRIMARY KEY,
        text_model TEXT,
        indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    , ai_enabled INTEGER NOT NULL DEFAULT 1, axis_norm_stats TEXT, stream_liked_share REAL, clap_calibration TEXT);

CREATE TABLE invites (
        code         TEXT PRIMARY KEY,
        created_by   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   REAL NOT NULL,
        expires_at   REAL NOT NULL,
        consumed_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
        consumed_at  REAL
    );

CREATE TABLE instance_settings (
        key         TEXT PRIMARY KEY,
        value       TEXT,
        updated_at  REAL NOT NULL
    );

CREATE TABLE track_metadata (
        collection_name       TEXT NOT NULL,
        track_id              TEXT NOT NULL,
        title                 TEXT NOT NULL,
        artist                TEXT NOT NULL,
        artists               TEXT,           -- JSON array
        artist_slugs          TEXT,           -- JSON array (also in join table)
        primary_artist_slug   TEXT,
        album                 TEXT,
        year                  INTEGER,
        genre                 TEXT,
        duration              REAL,
        file_path             TEXT,
        cover_art_path        TEXT,
        producer              TEXT,
        label                 TEXT,
        track_number          INTEGER,
        disc_number           INTEGER,
        bitrate_kbps          INTEGER,
        sonic_tags            TEXT,           -- JSON array
        sonic_axes            TEXT,           -- JSON object
        created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (collection_name, track_id)
    );

CREATE TABLE track_artist_slugs (
        collection_name TEXT NOT NULL,
        track_id        TEXT NOT NULL,
        artist_slug     TEXT NOT NULL,
        PRIMARY KEY (collection_name, track_id, artist_slug),
        FOREIGN KEY (collection_name, track_id)
            REFERENCES track_metadata(collection_name, track_id) ON DELETE CASCADE
    );

CREATE TABLE playback_events (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id      TEXT    NOT NULL,
        collection_name TEXT    NOT NULL,
        track_id        TEXT    NOT NULL,
        played_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        played_sec      REAL    NOT NULL,
        total_dur       REAL,
        skipped_early   INTEGER NOT NULL DEFAULT 0
    , interacted INTEGER, influence INTEGER NOT NULL DEFAULT 1, source TEXT);

CREATE TABLE taste_signals (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_name TEXT    NOT NULL,
        session_id      TEXT    NOT NULL,
        track_id        TEXT    NOT NULL,
        kind            TEXT    NOT NULL,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE playlists (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_name TEXT    NOT NULL,
        name            TEXT    NOT NULL,
        description     TEXT,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(collection_name, name)
    );

CREATE TABLE playlist_tracks (
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id    TEXT    NOT NULL,
        position    INTEGER NOT NULL,
        added_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (playlist_id, track_id)
    );

CREATE TABLE quiz_rounds (
        round_id        TEXT PRIMARY KEY,
        collection_name TEXT NOT NULL,
        mode            TEXT NOT NULL,
        track_id        TEXT,
        spec_json       TEXT NOT NULL,
        daily_date      TEXT,
        created_at      REAL NOT NULL,
        expires_at      REAL NOT NULL,
        answered_at     REAL,
        answer_json     TEXT,
        correct         INTEGER,
        score           REAL
    );

CREATE TABLE quiz_skill (
        collection_name TEXT NOT NULL,
        mode            TEXT NOT NULL,
        skill           REAL NOT NULL DEFAULT 0.5,
        n_answered      INTEGER NOT NULL DEFAULT 0,
        band_lo         REAL NOT NULL DEFAULT 60.0,
        band_hi         REAL NOT NULL DEFAULT 100.0,
        out_of_band     INTEGER NOT NULL DEFAULT 0,
        updated_at      REAL NOT NULL,
        PRIMARY KEY (collection_name, mode)
    );

CREATE TABLE yandex_imports (
        account_id       TEXT NOT NULL REFERENCES users(id),
        yandex_track_id  TEXT NOT NULL,
        upload_id        TEXT,
        track_id         TEXT,
        status           TEXT NOT NULL,
        reason           TEXT,
        imported_at      REAL NOT NULL,
        PRIMARY KEY (account_id, yandex_track_id)
    );

CREATE TABLE yandex_accounts (
        account_id  TEXT PRIMARY KEY REFERENCES users(id),
        enc_token   TEXT NOT NULL,
        yandex_uid  TEXT,
        expires_at  REAL,
        linked_at   REAL NOT NULL
    , yandex_login TEXT);
