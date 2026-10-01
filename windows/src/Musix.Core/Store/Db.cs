using Dapper;
using Microsoft.Data.Sqlite;

namespace Musix.Core.Store;

/// <summary>
/// The local store (spec §1): one SQLite file with the `/sync` mirror (rows stamped with the
/// snapshot generation that wrote them, so a finished snapshot can sweep what the server
/// deleted meanwhile), the outbox, and the index of this PC's own music. Android's Room
/// mirror, table for table.
/// </summary>
public sealed class Db : IDisposable
{
    // ё folds to е for the index (unicode61 only folds Latin diacritics); queries fold the same way
    private static string F(string col) => $"replace(replace({col}, 'ё', 'е'), 'Ё', 'Е')";

    private static readonly string Schema = $"""
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tracks (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, sort_title TEXT NOT NULL, artist TEXT NOT NULL,
            artists_json TEXT NOT NULL, album_id TEXT, album TEXT, year INTEGER, genre TEXT,
            duration_ms INTEGER NOT NULL, track_no INTEGER, disc_no INTEGER, cover_image_id TEXT,
            added_at INTEGER NOT NULL, gen INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS tracks_album ON tracks(album_id);
        CREATE TABLE IF NOT EXISTS track_artists (track_id TEXT NOT NULL, artist_id TEXT NOT NULL, ord INTEGER NOT NULL,
            PRIMARY KEY (track_id, ord));
        CREATE TABLE IF NOT EXISTS artists (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_name TEXT, image_id TEXT, gen INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS albums (id TEXT PRIMARY KEY, title TEXT NOT NULL, year INTEGER, album_artist_id TEXT,
            cover_image_id TEXT, gen INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, blurhash TEXT, width INTEGER, height INTEGER,
            palette_json TEXT, urls_json TEXT NOT NULL, gen INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, cover_image_id TEXT,
            item_count INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, gen INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS playlist_items (item_id TEXT PRIMARY KEY, playlist_id TEXT NOT NULL, track_id TEXT NOT NULL,
            position TEXT NOT NULL, added_at INTEGER NOT NULL, gen INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS playlist_items_pl ON playlist_items(playlist_id, position);
        CREATE TABLE IF NOT EXISTS signals (track_id TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at INTEGER NOT NULL, gen INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, key TEXT NOT NULL UNIQUE,
            payload TEXT NOT NULL, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT);
        CREATE TABLE IF NOT EXISTS local_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, mtime INTEGER NOT NULL,
            sha256 TEXT, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT, year INTEGER, genre TEXT, duration_ms INTEGER,
            track_no INTEGER, disc_no INTEGER, cover_path TEXT, server_track_id TEXT);
        CREATE INDEX IF NOT EXISTS local_files_sig ON local_files(size, mtime);
        CREATE VIRTUAL TABLE IF NOT EXISTS local_fts USING fts5(title, artist, album, content='local_files', content_rowid='id',
            tokenize = 'unicode61 remove_diacritics 2');
        CREATE TRIGGER IF NOT EXISTS local_ai AFTER INSERT ON local_files BEGIN
            INSERT INTO local_fts(rowid, title, artist, album) VALUES (new.id, {F("new.title")}, {F("new.artist")}, {F("new.album")}); END;
        CREATE TRIGGER IF NOT EXISTS local_ad AFTER DELETE ON local_files BEGIN
            INSERT INTO local_fts(local_fts, rowid, title, artist, album) VALUES ('delete', old.id, {F("old.title")}, {F("old.artist")}, {F("old.album")}); END;
        CREATE TRIGGER IF NOT EXISTS local_au AFTER UPDATE OF title, artist, album ON local_files BEGIN
            INSERT INTO local_fts(local_fts, rowid, title, artist, album) VALUES ('delete', old.id, {F("old.title")}, {F("old.artist")}, {F("old.album")});
            INSERT INTO local_fts(rowid, title, artist, album) VALUES (new.id, {F("new.title")}, {F("new.artist")}, {F("new.album")}); END;
        """;

    private readonly SqliteConnection conn;

    static Db() => DefaultTypeMap.MatchNamesWithUnderscores = true;  // duration_ms → DurationMs

    public Db(string path)
    {
        conn = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
        conn.Open();
        conn.Execute(Schema);
    }

    public SqliteConnection Conn => conn;

    public string? Kv(string key) => conn.QuerySingleOrDefault<string>("SELECT value FROM kv WHERE key = @key", new { key });

    public void PutKv(string key, string value, SqliteTransaction? tx = null) =>
        conn.Execute("INSERT INTO kv(key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value", new { key, value }, tx);

    public void DelKv(string key, SqliteTransaction? tx = null) => conn.Execute("DELETE FROM kv WHERE key = @key", new { key }, tx);

    /// <summary>Runs <paramref name="work"/> in one transaction: all of it lands, or none.</summary>
    public T InTx<T>(Func<SqliteTransaction, T> work)
    {
        using var tx = conn.BeginTransaction();
        var r = work(tx);
        tx.Commit();
        return r;
    }

    public void InTx(Action<SqliteTransaction> work) => InTx(tx => { work(tx); return 0; });

    public void Dispose() => conn.Dispose();
}
