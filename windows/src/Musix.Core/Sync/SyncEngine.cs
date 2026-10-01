using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.Sqlite;
using Musix.Core.Api;
using Musix.Core.Store;

namespace Musix.Core.Sync;

/// <summary>
/// Mirrors the account into SQLite from `/sync` (spec §1, Android `SyncEngine`). The first
/// run pages a snapshot; after it, deltas by cursor. The cursor is saved with each page in
/// the page's own transaction, so a crash resumes exactly there; changes are state-based
/// (the entity as it is now), so a replayed page is harmless. A snapshot stamps a new
/// generation and, on its last page, sweeps older ones — what the server deleted while this
/// PC had no cursor. A refused cursor (400/422) restarts from a snapshot.
/// </summary>
public sealed class SyncEngine(MusixHttp api, Db db)
{
    public const string Cursor = "sync.cursor", Gen = "sync.gen", Settings = "settings";
    private const string SnapshotMark = "snap:";
    private readonly SemaphoreSlim gate = new(1, 1);

    public sealed record Result(int Pages, int Changes, bool Full);

    public async Task<Result> SyncAsync(int limit = 1000, CancellationToken ct = default)
    {
        await gate.WaitAsync(ct);
        try
        {
            var cursor = db.Kv(Cursor);
            var full = cursor is null || cursor.StartsWith(SnapshotMark);
            var gen = long.TryParse(db.Kv(Gen), out var g) ? g : 0;
            if (cursor is null) db.PutKv(Gen, (++gen).ToString());
            int pages = 0, changes = 0;
            while (true)
            {
                JsonNode? page;
                try
                {
                    var q = cursor is null ? "" : $"cursor={Uri.EscapeDataString(cursor[(cursor.StartsWith(SnapshotMark) ? SnapshotMark.Length : 0)..])}&";
                    page = await api.GetJsonAsync($"api/v2/sync?{q}limit={limit}", ct);
                }
                catch (ApiError e) when (e.Status is 400 or 422 && cursor is not null)
                {
                    gen++;  // the cursor is refused: start over with a fresh snapshot
                    db.InTx(tx => { db.DelKv(Cursor, tx); db.PutKv(Gen, gen.ToString(), tx); });
                    cursor = null;
                    full = true;
                    continue;
                }
                var list = page?["changes"]?.AsArray() ?? [];
                var next = page?["cursor"]?.GetValue<string>() ?? throw new ApiError(500, "sync: no cursor");
                var more = page?["hasMore"]?.GetValue<bool>() ?? false;
                // a snapshot cursor keeps its mark until the snapshot's last page: the sweep must
                // not run after a crash mid-snapshot resumes as a delta
                var snapshotting = full && more;
                db.InTx(tx =>
                {
                    Apply(list, gen, tx);
                    if (full && !more) Sweep(gen, tx);
                    db.PutKv(Cursor, snapshotting ? SnapshotMark + next : next, tx);
                });
                pages++;
                changes += list.Count;
                cursor = snapshotting ? SnapshotMark + next : next;
                if (!more) break;
            }
            return new Result(pages, changes, full);
        }
        finally { gate.Release(); }
    }

    private void Apply(JsonArray changes, long gen, SqliteTransaction tx)
    {
        var c = db.Conn;
        foreach (var ch in changes)
        {
            if (ch is null) continue;
            var entity = ch["entity"]!.GetValue<string>();
            var id = ch["id"]!.GetValue<string>();
            var data = ch["data"] as JsonObject;
            if (ch["op"]?.GetValue<string>() == "delete" || data is null) { Delete(entity, id, tx); continue; }
            switch (entity)
            {
                case "image":
                    c.Execute("""
                        INSERT INTO images(id, blurhash, width, height, palette_json, urls_json, gen) VALUES (@id, @b, @w, @h, @p, @u, @gen)
                        ON CONFLICT(id) DO UPDATE SET blurhash = excluded.blurhash, width = excluded.width, height = excluded.height,
                          palette_json = excluded.palette_json, urls_json = excluded.urls_json, gen = excluded.gen
                        """, new { id, b = S(data, "blurhash"), w = I(data, "width"), h = I(data, "height"),
                        p = data["palette"]?.ToJsonString(), u = data["urls"]?.ToJsonString() ?? "{}", gen }, tx);
                    break;
                case "artist":
                    c.Execute("""
                        INSERT INTO artists(id, name, sort_name, image_id, gen) VALUES (@id, @n, @s, @i, @gen)
                        ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort_name = excluded.sort_name, image_id = excluded.image_id, gen = excluded.gen
                        """, new { id, n = S(data, "name") ?? "", s = S(data, "sortName"), i = S(data, "imageId"), gen }, tx);
                    break;
                case "album":
                    c.Execute("""
                        INSERT INTO albums(id, title, year, album_artist_id, cover_image_id, gen) VALUES (@id, @t, @y, @a, @cv, @gen)
                        ON CONFLICT(id) DO UPDATE SET title = excluded.title, year = excluded.year, album_artist_id = excluded.album_artist_id,
                          cover_image_id = excluded.cover_image_id, gen = excluded.gen
                        """, new { id, t = S(data, "title") ?? "", y = I(data, "year"), a = S(data, "albumArtistId"), cv = S(data, "coverImageId"), gen }, tx);
                    break;
                case "track":
                    var title = S(data, "titleDisplay") ?? S(data, "title") ?? "";
                    var artists = data["artists"] as JsonArray ?? [];
                    c.Execute("""
                        INSERT INTO tracks(id, title, sort_title, artist, artists_json, album_id, album, year, genre, duration_ms, track_no,
                          disc_no, cover_image_id, added_at, gen)
                        VALUES (@id, @title, @sort, @artist, @aj, @albumId, @album, @year, @genre, @dur, @no, @disc, @cover, @added, @gen)
                        ON CONFLICT(id) DO UPDATE SET title = excluded.title, sort_title = excluded.sort_title, artist = excluded.artist,
                          artists_json = excluded.artists_json, album_id = excluded.album_id, album = excluded.album, year = excluded.year,
                          genre = excluded.genre, duration_ms = excluded.duration_ms, track_no = excluded.track_no, disc_no = excluded.disc_no,
                          cover_image_id = excluded.cover_image_id, added_at = excluded.added_at, gen = excluded.gen
                        """, new
                    {
                        id, title, sort = SortKey(title), artist = S(data, "artistDisplay") ?? "",
                        aj = new JsonArray(artists.Select(a => (JsonNode)new JsonObject { ["id"] = S(a!, "id"), ["name"] = S(a!, "name") }).ToArray()).ToJsonString(),
                        albumId = S(data, "albumId"), album = S(data, "album"), year = I(data, "year"), genre = S(data, "genre"),
                        dur = I(data, "durationMs") ?? 0, no = I(data, "trackNo"), disc = I(data, "discNo"), cover = S(data, "coverImageId"),
                        added = DateTimeOffset.TryParse(S(data, "addedAt"), out var at) ? at.ToUnixTimeMilliseconds() : 0, gen,
                    }, tx);
                    c.Execute("DELETE FROM track_artists WHERE track_id = @id", new { id }, tx);
                    for (var i = 0; i < artists.Count; i++)
                        c.Execute("INSERT INTO track_artists(track_id, artist_id, ord) VALUES (@id, @a, @i)", new { id, a = S(artists[i]!, "id"), i }, tx);
                    break;
                case "playlist":
                    c.Execute("""
                        INSERT INTO playlists(id, name, description, cover_image_id, item_count, created_at, updated_at, gen)
                        VALUES (@id, @n, @d, @cv, @cnt, @ca, @ua, @gen)
                        ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, cover_image_id = excluded.cover_image_id,
                          item_count = excluded.item_count, created_at = excluded.created_at, updated_at = excluded.updated_at, gen = excluded.gen
                        """, new { id, n = S(data, "name") ?? "", d = S(data, "description"), cv = S(data, "coverImageId"), cnt = I(data, "itemCount") ?? 0,
                        ca = Ms(S(data, "createdAt")), ua = Ms(S(data, "updatedAt")), gen }, tx);
                    break;
                case "playlistItem":
                    c.Execute("""
                        INSERT INTO playlist_items(item_id, playlist_id, track_id, position, added_at, gen) VALUES (@id, @pl, @t, @pos, @at, @gen)
                        ON CONFLICT(item_id) DO UPDATE SET playlist_id = excluded.playlist_id, track_id = excluded.track_id,
                          position = excluded.position, added_at = excluded.added_at, gen = excluded.gen
                        """, new { id = S(data, "itemId") ?? id, pl = S(data, "playlistId"), t = S(data, "trackId"), pos = S(data, "position") ?? "",
                        at = Ms(S(data, "addedAt")), gen }, tx);
                    break;
                case "signalState":
                    c.Execute("""
                        INSERT INTO signals(track_id, kind, created_at, gen) VALUES (@t, @k, @at, @gen)
                        ON CONFLICT(track_id) DO UPDATE SET kind = excluded.kind, created_at = excluded.created_at, gen = excluded.gen
                        """, new { t = S(data, "trackId") ?? id, k = S(data, "kind") ?? "", at = Ms(S(data, "createdAt")), gen }, tx);
                    break;
                case "settings":
                    db.PutKv(Settings, data["value"]?.ToJsonString() ?? "{}", tx);
                    break;
                // an entity this build does not know (a newer server): left to the next build
            }
        }
    }

    private void Delete(string entity, string id, SqliteTransaction tx)
    {
        var c = db.Conn;
        switch (entity)
        {
            case "track": c.Execute("DELETE FROM track_artists WHERE track_id = @id; DELETE FROM tracks WHERE id = @id", new { id }, tx); break;
            case "artist": c.Execute("DELETE FROM artists WHERE id = @id", new { id }, tx); break;
            case "album": c.Execute("DELETE FROM albums WHERE id = @id", new { id }, tx); break;
            case "image": c.Execute("DELETE FROM images WHERE id = @id", new { id }, tx); break;
            case "playlist": c.Execute("DELETE FROM playlist_items WHERE playlist_id = @id; DELETE FROM playlists WHERE id = @id", new { id }, tx); break;
            case "playlistItem": c.Execute("DELETE FROM playlist_items WHERE item_id = @id", new { id }, tx); break;
            case "signalState": c.Execute("DELETE FROM signals WHERE track_id = @id", new { id }, tx); break;
        }
    }

    private void Sweep(long gen, SqliteTransaction tx) => db.Conn.Execute("""
        DELETE FROM tracks WHERE gen < @gen;
        DELETE FROM track_artists WHERE track_id NOT IN (SELECT id FROM tracks);
        DELETE FROM artists WHERE gen < @gen;
        DELETE FROM albums WHERE gen < @gen;
        DELETE FROM images WHERE gen < @gen;
        DELETE FROM playlists WHERE gen < @gen;
        DELETE FROM playlist_items WHERE gen < @gen;
        DELETE FROM signals WHERE gen < @gen;
        """, new { gen }, tx);

    private static string? S(JsonNode n, string k) => n[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
    private static long? I(JsonNode n, string k) => n[k] is JsonValue v && v.TryGetValue<long>(out var l) ? l : null;
    private static long Ms(string? iso) => DateTimeOffset.TryParse(iso, out var t) ? t.ToUnixTimeMilliseconds() : 0;

    /// <summary>Android's sort key: case-folded, leading brackets/quotes and "the " ignored.</summary>
    public static string SortKey(string s)
    {
        var k = s.ToLowerInvariant().TrimStart('(', '[', '"', '\'', '«', ' ');
        return k.StartsWith("the ") ? k[4..] : k;
    }
}
