using Dapper;

namespace Musix.Core.Store;

public sealed record AlbumRow(string Id, string Title, long? Year, string? Cover, string Artist, long N, long Added);
public sealed record ArtistRow(string Id, string Name, string? Image, long N);
public sealed record TrackRow(string Id, string Title, string Artist, string? Album, long DurationMs, string? Cover, long? TrackNo);
public sealed record PlaylistRow(string Id, string Name, string? Cover, long N);
public sealed record AlbumHead(string Title, long? Year, string? Cover, string? ArtistId, string? Artist);
public sealed record PlaylistHead(string Name, string? Description, string? Cover);

/// <summary>
/// The screens' reads from the /sync mirror. Every column is aliased to its record's
/// parameter name, because Dapper fills a record by matching constructor parameters to
/// column names, not by position. Unaliased columns (`cover_image_id`, `count(t.id)`)
/// threw on the first row, and that was the Windows crash on opening the library
/// (2026-10-01). An empty mirror never showed it.
/// </summary>
public sealed class Mirror(Db db)
{
    private const string TrackCols = "t.id, t.title, t.artist, t.album, t.duration_ms, t.cover_image_id AS cover, t.track_no";

    /// <summary>Albums with this account's track count. <paramref name="sort"/>: added (default), title or year.</summary>
    public IReadOnlyList<AlbumRow> Albums(string sort = "added")
    {
        var orderBy = sort switch { "title" => "a.title COLLATE NOCASE", "year" => "a.year DESC, a.title", _ => "added DESC" };
        return db.Conn.Query<AlbumRow>($"""
            SELECT a.id, a.title, a.year, a.cover_image_id AS cover, coalesce(ar.name, min(t.artist), '') AS artist,
                   count(t.id) AS n, max(t.added_at) AS added
            FROM albums a JOIN tracks t ON t.album_id = a.id LEFT JOIN artists ar ON ar.id = a.album_artist_id
            GROUP BY a.id ORDER BY {orderBy}
            """).ToList();
    }

    public IReadOnlyList<ArtistRow> Artists() => db.Conn.Query<ArtistRow>("""
        SELECT ar.id, ar.name, ar.image_id AS image, count(ta.track_id) AS n
        FROM artists ar JOIN track_artists ta ON ta.artist_id = ar.id GROUP BY ar.id ORDER BY n DESC
        """).ToList();

    public IReadOnlyList<TrackRow> Tracks() =>
        db.Conn.Query<TrackRow>($"SELECT {TrackCols} FROM tracks t ORDER BY t.added_at DESC").ToList();

    /// <summary>Tracks by id, in the order given; ids not in the mirror are skipped.</summary>
    public IReadOnlyList<TrackRow> Tracks(IReadOnlyList<string> ids)
    {
        var byId = db.Conn.Query<TrackRow>($"SELECT {TrackCols} FROM tracks t WHERE t.id IN @ids", new { ids }).ToDictionary(t => t.Id);
        return ids.Where(byId.ContainsKey).Select(id => byId[id]).ToList();
    }

    public IReadOnlyList<PlaylistRow> Playlists() => db.Conn.Query<PlaylistRow>(
        "SELECT id, name, cover_image_id AS cover, item_count AS n FROM playlists ORDER BY updated_at DESC").ToList();

    public AlbumHead? Album(string id) => db.Conn.QuerySingleOrDefault<AlbumHead>("""
        SELECT a.title, a.year, a.cover_image_id AS cover, a.album_artist_id AS artist_id, ar.name AS artist
        FROM albums a LEFT JOIN artists ar ON ar.id = a.album_artist_id WHERE a.id = @id
        """, new { id });

    public IReadOnlyList<TrackRow> AlbumTracks(string id) => db.Conn.Query<TrackRow>(
        $"SELECT {TrackCols} FROM tracks t WHERE t.album_id = @id ORDER BY t.disc_no, t.track_no, t.sort_title", new { id }).ToList();

    public string? ArtistImage(string id) =>
        db.Conn.QuerySingleOrDefault<string?>("SELECT image_id FROM artists WHERE id = @id", new { id });

    public IReadOnlyList<AlbumRow> ArtistAlbums(string id, string name) => db.Conn.Query<AlbumRow>("""
        SELECT a.id, a.title, a.year, a.cover_image_id AS cover, @name AS artist, count(t.id) AS n, max(t.added_at) AS added
        FROM albums a JOIN tracks t ON t.album_id = a.id WHERE a.album_artist_id = @id GROUP BY a.id ORDER BY a.year DESC
        """, new { id, name }).ToList();

    public IReadOnlyList<string> ArtistTrackIds(string id) => db.Conn.Query<string>("""
        SELECT t.id FROM tracks t JOIN track_artists ta ON ta.track_id = t.id WHERE ta.artist_id = @id ORDER BY t.album, t.disc_no, t.track_no
        """, new { id }).ToList();

    public PlaylistHead? Playlist(string id) => db.Conn.QuerySingleOrDefault<PlaylistHead>(
        "SELECT name, description, cover_image_id AS cover FROM playlists WHERE id = @id", new { id });

    public IReadOnlyList<TrackRow> PlaylistTracks(string id) => db.Conn.Query<TrackRow>($"""
        SELECT {TrackCols} FROM playlist_items i JOIN tracks t ON t.id = i.track_id WHERE i.playlist_id = @id ORDER BY i.position
        """, new { id }).ToList();
}
