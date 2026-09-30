-- v1's schema (schema only, no data) for the tables tools/migrate reads: from sqlite_master of a v1 snapshot

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

CREATE TABLE artists (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        collection_name TEXT,
        mbid TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    , audiodb_bio TEXT, mood TEXT, country_code TEXT, country TEXT, label TEXT, cutout_path TEXT, thumb_path TEXT, audiodb_mbid TEXT, audiodb_fetched_at TIMESTAMP);

CREATE TABLE songs (
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist_slug TEXT NOT NULL REFERENCES artists(slug) ON DELETE CASCADE,
        collection_name TEXT,
        recording_mbid TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    , sonic_tags_json TEXT, sonic_class TEXT, sonic_class_confidence REAL, audio_signature TEXT, producers TEXT, label TEXT, samples_json TEXT, mbid TEXT, producers_genius TEXT);

CREATE TABLE song_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_slug TEXT NOT NULL REFERENCES songs(slug) ON DELETE CASCADE,
        lang TEXT NOT NULL DEFAULT 'en',
        fact TEXT NOT NULL,
        category TEXT,
        source TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE artist_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artist_slug TEXT NOT NULL REFERENCES artists(slug) ON DELETE CASCADE,
        lang TEXT NOT NULL DEFAULT 'en',
        fact TEXT NOT NULL,
        category TEXT,
        source TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE fact_visibility (
        kind            TEXT NOT NULL,
        slug            TEXT NOT NULL,
        collection_name TEXT NOT NULL,
        PRIMARY KEY (kind, slug, collection_name)
    );

CREATE TABLE refined_facts (
        scope           TEXT NOT NULL,         -- 'song' or 'artist'
        scope_key       TEXT NOT NULL,         -- song_slug (song) or artist_slug (artist)
        lang            TEXT NOT NULL,
        collection_name TEXT,                  -- provenance only; NOT part of key
        refined_json    TEXT NOT NULL,         -- JSON array of {"text": str}
        generated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (scope, scope_key, lang)
    );

CREATE TABLE refined_fact_items (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        scope           TEXT NOT NULL,       -- 'song' | 'artist'
        scope_key       TEXT NOT NULL,       -- song_slug | artist_slug
        lang            TEXT NOT NULL,
        origin_kind     TEXT NOT NULL,       -- 'song_facts' | 'artist_facts'
        origin_id       INTEGER NOT NULL,    -- rowid of the raw fact
        labels_json     TEXT NOT NULL,       -- ["creation","sound"]
        text            TEXT,                -- NULL for label 'other'
        confirmed       INTEGER NOT NULL DEFAULT 1,
        src             TEXT,                -- 'editorial' | 'annotation'
        collection_name TEXT,                -- provenance only
        generated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (origin_kind, origin_id, lang)
    );

CREATE TABLE artist_bios (
        artist_slug     TEXT NOT NULL,
        collection_name TEXT NOT NULL,
        lang            TEXT NOT NULL,
        bio_text        TEXT NOT NULL,
        generated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP, source_url TEXT, source_kind TEXT, grammy_wins INTEGER, grammy_nominations INTEGER, grammy_source TEXT, formed_year INTEGER, formed_place TEXT, formed_source TEXT, name_origin TEXT, name_origin_source TEXT, active_from INTEGER, active_to INTEGER, status TEXT, status_source TEXT,
        PRIMARY KEY (artist_slug, collection_name, lang)
    );

CREATE TABLE sonic_vibes (
        track_id        TEXT NOT NULL,
        collection_name TEXT NOT NULL,
        lang            TEXT NOT NULL,
        phrase          TEXT NOT NULL,
        generated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (track_id, collection_name, lang)
    );

CREATE TABLE sample_links (
        collection_name  TEXT NOT NULL,
        src_slug         TEXT NOT NULL,
        direction        TEXT NOT NULL,          -- 'source' | 'usage'
        dst_key          TEXT NOT NULL,          -- normalized "artist|title"
        dst_title        TEXT,
        dst_artist       TEXT,
        dst_slug         TEXT,                   -- songs.slug when in library
        relation         TEXT NOT NULL,          -- 'sample' | 'interpolation'
        src_year         INTEGER,
        dst_year         INTEGER,
        evidence         TEXT,
        confidence       REAL,
        created_at       TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (collection_name, src_slug, direction, dst_key)
    );

CREATE TABLE track_gems (
        collection_name  TEXT NOT NULL,
        track_id         TEXT NOT NULL,
        kind             TEXT NOT NULL,
        canonical        TEXT NOT NULL DEFAULT '',
        display          TEXT NOT NULL DEFAULT '',
        quote            TEXT NOT NULL DEFAULT '',
        detail           TEXT,
        score            REAL,
        created_at       TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (collection_name, track_id, kind, canonical)
    );

CREATE TABLE track_reactions (
        collection_name TEXT NOT NULL,
        track_id TEXT NOT NULL,
        reaction TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (collection_name, track_id)
    );

CREATE TABLE recsys_llm_texts (
        collection_name TEXT NOT NULL,
        kind            TEXT NOT NULL,
        lang            TEXT NOT NULL,
        source_hash     TEXT NOT NULL,
        content_json    TEXT NOT NULL,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (collection_name, kind, lang)
    );
