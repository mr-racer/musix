using System.Security.Cryptography;
using Dapper;
using Musix.Core.Store;

namespace Musix.Core.Local;

/// <summary>A file of this PC's library, as the index knows it.</summary>
public sealed record LocalTrack(long Id, string Path, long Size, long Mtime, string? Sha256, string Title, string Artist, string? Album,
    long? Year, string? Genre, long? DurationMs, long? TrackNo, long? DiscNo, string? CoverPath, string? ServerTrackId);

/// <summary>Reads tags and the cover; the default is TagLib#, tests swap in a fake.</summary>
public interface ITagReader
{
    LocalTags Read(string path);
}

public sealed record LocalTags(string? Title, string? Artist, string? Album, long? Year, string? Genre, long? DurationMs,
    long? TrackNo, long? DiscNo, byte[]? Cover);

public sealed class TagLibReader : ITagReader
{
    public LocalTags Read(string path)
    {
        using var f = TagLib.File.Create(path);
        var t = f.Tag;
        var artist = t.JoinedPerformers is { Length: > 0 } p ? p : t.JoinedAlbumArtists;
        return new LocalTags(Blank(t.Title), Blank(artist), Blank(t.Album), t.Year > 0 ? t.Year : null, Blank(t.FirstGenre),
            (long)f.Properties.Duration.TotalMilliseconds, t.Track > 0 ? t.Track : null, t.Disc > 0 ? t.Disc : null,
            t.Pictures is { Length: > 0 } pics ? pics[0].Data.Data : null);
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

/// <summary>
/// «На этом компьютере» (spec §3): the user's library folders, indexed into SQLite with FTS5.
/// A scan stats every file and reads tags only for new or changed ones. A file that vanished
/// from one path and appeared at another with the same size and mtime is the same file moved
/// — its row (and its hash and server link) follows it, nothing is added or re-uploaded. The
/// watcher only marks folders dirty; the reconcile does the work, debounced.
/// </summary>
public sealed class LocalLibrary(Db db, string coverDir, ITagReader? tags = null) : IDisposable
{
    public static readonly HashSet<string> Audio = new(StringComparer.OrdinalIgnoreCase)
        { ".flac", ".mp3", ".m4a", ".alac", ".aac", ".ogg", ".oga", ".opus", ".wav", ".aiff", ".aif", ".wma" };

    /// <summary>The columns in <see cref="LocalTrack"/>'s order (Dapper builds records positionally).</summary>
    private const string Cols = "id, path, size, mtime, sha256, title, artist, album, year, genre, duration_ms, track_no, disc_no, cover_path, server_track_id";

    private readonly ITagReader reader = tags ?? new TagLibReader();
    private readonly List<FileSystemWatcher> watchers = [];
    private readonly SemaphoreSlim gate = new(1, 1);
    private Timer? debounce;

    public sealed record ScanResult(int Added, int Updated, int Moved, int Removed);

    /// <summary>Walks the folders and brings the index in line with what is on disk.</summary>
    public async Task<ScanResult> ReconcileAsync(IReadOnlyList<string> folders, CancellationToken ct = default)
    {
        await gate.WaitAsync(ct);
        try { return await Task.Run(() => Reconcile(folders, ct), ct); }
        finally { gate.Release(); }
    }

    private ScanResult Reconcile(IReadOnlyList<string> folders, CancellationToken ct)
    {
        int added = 0, updated = 0, moved = 0, removed = 0;
        var c = db.Conn;
        var known = c.Query<LocalTrack>($"SELECT {Cols} FROM local_files").ToDictionary(r => r.Path, StringComparer.Ordinal);
        var onDisk = new Dictionary<string, (long Size, long Mtime)>(StringComparer.Ordinal);
        foreach (var root in folders.Where(Directory.Exists))
        {
            foreach (var p in Directory.EnumerateFiles(root, "*", new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true }))
            {
                ct.ThrowIfCancellationRequested();
                if (!Audio.Contains(System.IO.Path.GetExtension(p))) continue;
                var fi = new FileInfo(p);
                onDisk[p] = (fi.Length, new DateTimeOffset(fi.LastWriteTimeUtc).ToUnixTimeSeconds());
            }
        }
        // rows whose path is gone: candidates for a move before they count as removed
        var gone = known.Values.Where(r => !onDisk.ContainsKey(r.Path)).ToList();
        foreach (var (path, (size, mtime)) in onDisk)
        {
            if (known.TryGetValue(path, out var row))
            {
                if (row.Size == size && row.Mtime == mtime) continue;
                Write(row.Id, path, size, mtime, sha: null);  // edited in place: re-read, the hash is stale
                updated++;
                continue;
            }
            var from = gone.FirstOrDefault(r => r.Size == size && r.Mtime == mtime);
            if (from is not null)
            {
                gone.Remove(from);
                c.Execute("UPDATE local_files SET path = @path WHERE id = @id", new { path, id = from.Id });
                moved++;
                continue;
            }
            Write(null, path, size, mtime, sha: null);
            added++;
        }
        foreach (var r in gone)
        {
            c.Execute("DELETE FROM local_files WHERE id = @id", new { id = r.Id });
            removed++;
        }
        return new ScanResult(added, updated, moved, removed);
    }

    private void Write(long? id, string path, long size, long mtime, string? sha)
    {
        LocalTags t;
        try { t = reader.Read(path); }
        catch (Exception) { t = new LocalTags(null, null, null, null, null, null, null, null, null); }  // unreadable tags: the name is enough
        var cover = t.Cover is { Length: > 0 } bytes ? SaveCover(bytes) : null;
        var p = new
        {
            id, path, size, mtime, sha, title = t.Title ?? System.IO.Path.GetFileNameWithoutExtension(path), artist = t.Artist ?? "",
            album = t.Album, year = t.Year, genre = t.Genre, dur = t.DurationMs, no = t.TrackNo, disc = t.DiscNo, cover,
        };
        if (id is null)
            db.Conn.Execute("""
                INSERT INTO local_files(path, size, mtime, sha256, title, artist, album, year, genre, duration_ms, track_no, disc_no, cover_path)
                VALUES (@path, @size, @mtime, @sha, @title, @artist, @album, @year, @genre, @dur, @no, @disc, @cover)
                """, p);
        else
            db.Conn.Execute("""
                UPDATE local_files SET size = @size, mtime = @mtime, sha256 = @sha, title = @title, artist = @artist, album = @album, year = @year,
                  genre = @genre, duration_ms = @dur, track_no = @no, disc_no = @disc, cover_path = @cover, server_track_id = NULL WHERE id = @id
                """, p);
    }

    private string SaveCover(byte[] bytes)
    {
        Directory.CreateDirectory(coverDir);
        var name = Convert.ToHexStringLower(SHA256.HashData(bytes))[..32] + ".img";
        var path = System.IO.Path.Combine(coverDir, name);
        if (!File.Exists(path)) File.WriteAllBytes(path, bytes);  // content-addressed: an album's tracks share one file
        return path;
    }

    /// <summary>FTS5 over title, artist and album; every word is a prefix ("kan wes" finds Kanye West).</summary>
    public IReadOnlyList<LocalTrack> Search(string query, int limit = 50)
    {
        var words = query.Replace('ё', 'е').Replace('Ё', 'Е').Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(w => "\"" + w.Replace("\"", "\"\"") + "\"*");
        var match = string.Join(" ", words);
        if (match.Length == 0) return [];
        return db.Conn.Query<LocalTrack>($"""
            SELECT {string.Join(", ", Cols.Split(", ").Select(x => "f." + x))} FROM local_fts JOIN local_files f ON f.id = local_fts.rowid
            WHERE local_fts MATCH @match ORDER BY rank LIMIT @limit
            """, new { match, limit }).ToList();
    }

    public IReadOnlyList<LocalTrack> All() => db.Conn.Query<LocalTrack>($"SELECT {Cols} FROM local_files ORDER BY artist, album, disc_no, track_no, title").ToList();

    public LocalTrack? Get(long id) => db.Conn.QuerySingleOrDefault<LocalTrack>($"SELECT {Cols} FROM local_files WHERE id = @id", new { id });

    /// <summary>The file's content hash, computed once and kept (dedup is by content, never by name).</summary>
    public async Task<string> HashAsync(long id, CancellationToken ct = default)
    {
        var t = Get(id) ?? throw new FileNotFoundException("not in the index", id.ToString());
        if (t.Sha256 is { } known) return known;
        await using var fs = File.OpenRead(t.Path);
        var sha = Convert.ToHexStringLower(await SHA256.HashDataAsync(fs, ct));
        db.Conn.Execute("UPDATE local_files SET sha256 = @sha WHERE id = @id", new { sha, id });
        return sha;
    }

    public void Link(long id, string serverTrackId) =>
        db.Conn.Execute("UPDATE local_files SET server_track_id = @serverTrackId WHERE id = @id", new { serverTrackId, id });

    /// <summary>Watches the folders; any change schedules one reconcile <paramref name="settle"/> later.</summary>
    public void Watch(IReadOnlyList<string> folders, TimeSpan settle, Action<Task<ScanResult>> onReconcile)
    {
        StopWatching();
        debounce = new Timer(_ => onReconcile(ReconcileAsync(folders)));
        foreach (var f in folders.Where(Directory.Exists))
        {
            var w = new FileSystemWatcher(f) { IncludeSubdirectories = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size };
            void kick(object? s, EventArgs e) => debounce?.Change(settle, Timeout.InfiniteTimeSpan);
            w.Created += kick; w.Deleted += kick; w.Changed += kick; w.Renamed += kick;
            w.EnableRaisingEvents = true;
            watchers.Add(w);
        }
    }

    public void StopWatching()
    {
        foreach (var w in watchers) w.Dispose();
        watchers.Clear();
        debounce?.Dispose();
        debounce = null;
    }

    public void Dispose() => StopWatching();
}
