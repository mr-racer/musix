using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Dapper;
using Musix.Core.Api;
using Musix.Core.Local;
using Musix.Core.Playback;
using Musix.Core.Store;
using Musix.Core.Sync;
using Musix.Core.Uploads;
using Xunit;

namespace Musix.Core.Tests;

/// <summary>Answers by path with a scripted function and records every request it saw.</summary>
internal sealed class FakeServer(Func<HttpRequestMessage, string?, (HttpStatusCode, string)> answer) : HttpMessageHandler
{
    public readonly List<(HttpMethod Method, string Path, string? Body)> Seen = [];

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
        Seen.Add((request.Method, request.RequestUri!.PathAndQuery, body));
        var (code, json) = answer(request, body);
        return new HttpResponseMessage(code) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
    }
}

internal sealed class FakeTags(Func<string, LocalTags> read) : ITagReader
{
    public LocalTags Read(string path) => read(path);
}

public sealed class CoreTests : IDisposable
{
    private readonly string dir = Directory.CreateTempSubdirectory("musix-core-").FullName;
    private readonly Db db;

    public CoreTests() => db = new Db(Path.Combine(dir, "store.db"));

    public void Dispose()
    {
        db.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(dir, recursive: true);
    }

    private static MusixHttp Api(FakeServer s) => new(new HttpClient(s), new Uri("https://musix.test/"));

    private static JsonObject Track(string id, string title) => new()
    {
        ["entity"] = "track", ["op"] = "upsert", ["id"] = id,
        ["data"] = new JsonObject
        {
            ["id"] = id, ["title"] = title, ["artistDisplay"] = "A", ["durationMs"] = 1000, ["addedAt"] = "2026-10-01T00:00:00Z",
            ["artists"] = new JsonArray(new JsonObject { ["id"] = "a1", ["name"] = "A" }),
        },
    };

    private static string Page(string cursor, params JsonObject[] changes) =>
        new JsonObject { ["changes"] = new JsonArray(changes), ["cursor"] = cursor, ["hasMore"] = false }.ToJsonString();

    [Fact]
    public async Task Sync_replays_harmlessly_and_a_new_snapshot_sweeps_what_the_server_deleted()
    {
        var snapshot = 1;
        var server = new FakeServer((r, _) =>
        {
            var q = r.RequestUri!.Query;
            if (q.Contains("cursor=c1") && snapshot == 2) return (HttpStatusCode.UnprocessableEntity, "{}");  // the cursor expired
            if (q.Contains("cursor=c1")) return (HttpStatusCode.OK, Page("c1", Track("t1", "One"), Track("t2", "Two")));  // a replayed delta
            return snapshot == 1
                ? (HttpStatusCode.OK, Page("c1", Track("t1", "One"), Track("t2", "Two")))
                : (HttpStatusCode.OK, Page("c2", Track("t1", "One")));  // t2 was deleted while we had no cursor
        });
        var sync = new SyncEngine(Api(server), db);
        await sync.SyncAsync();
        await sync.SyncAsync();  // the same rows again: a no-op
        Assert.Equal(2, db.Conn.ExecuteScalar<int>("SELECT count(*) FROM tracks"));
        Assert.Equal(2, db.Conn.ExecuteScalar<int>("SELECT count(*) FROM track_artists"));

        snapshot = 2;
        var r = await sync.SyncAsync();
        Assert.True(r.Full);
        Assert.Equal(["t1"], db.Conn.Query<string>("SELECT id FROM tracks").ToList());
        Assert.Equal("c2", db.Kv(SyncEngine.Cursor));
    }

    [Fact]
    public async Task Outbox_sends_consecutive_listens_as_one_batch_and_keeps_them_when_the_server_is_down()
    {
        var down = true;
        var server = new FakeServer((r, _) => down && r.RequestUri!.AbsolutePath.EndsWith("listens:batch")
            ? (HttpStatusCode.ServiceUnavailable, "{}") : (HttpStatusCode.OK, "{}"));
        var outbox = new Outbox.Outbox(db, Api(server));
        foreach (var i in Enumerable.Range(0, 3)) outbox.Enqueue(Outbox.Outbox.Listen, $"l{i}", new JsonObject { ["clientEventId"] = $"l{i}" });
        outbox.Enqueue(Outbox.Outbox.Signal, "s1", new JsonObject { ["trackId"] = "t1", ["kind"] = "fire", ["clientEventId"] = "s1" });

        Assert.IsType<Outbox.Outbox.Flush.Retry>(await outbox.FlushAsync());
        Assert.Equal(4, outbox.Pending);  // nothing lost, nothing reordered past the failure

        down = false;
        Assert.IsType<Outbox.Outbox.Flush.Done>(await outbox.FlushAsync());
        Assert.Equal(0, outbox.Pending);
        var batch = server.Seen.Last(s => s.Path.EndsWith("listens:batch"));
        Assert.Equal(3, JsonNode.Parse(batch.Body!)!["events"]!.AsArray().Count);
        Assert.Equal("/api/v2/tracks/t1/signals", server.Seen.Last().Path);
    }

    [Fact]
    public async Task Reconcile_follows_a_moved_file_instead_of_adding_it_again()
    {
        var music = Directory.CreateDirectory(Path.Combine(dir, "Music")).FullName;
        var a = Path.Combine(music, "song.flac");
        await File.WriteAllBytesAsync(a, new byte[4096]);
        var lib = new LocalLibrary(db, Path.Combine(dir, "covers"), new FakeTags(_ => new LocalTags("Song", "Artist", "Album", 2001, null, 180_000, 1, 1, null)));
        Assert.Equal(1, (await lib.ReconcileAsync([music])).Added);
        var id = lib.All().Single().Id;
        await lib.HashAsync(id);

        var b = Path.Combine(Directory.CreateDirectory(Path.Combine(music, "Album")).FullName, "01 Song.flac");
        File.Move(a, b);  // a move keeps size and mtime
        var r = await lib.ReconcileAsync([music]);

        Assert.Equal((0, 1, 0), (r.Added, r.Moved, r.Removed));
        var row = Assert.Single(lib.All());
        Assert.Equal((id, b), (row.Id, row.Path));
        Assert.NotNull(row.Sha256);  // the hash (and any server link) moved with it
    }

    [Fact]
    public async Task Upload_skips_a_file_the_server_already_has_and_sends_the_rest_in_chunks_at_its_offset()
    {
        var music = Directory.CreateDirectory(Path.Combine(dir, "Up")).FullName;
        await File.WriteAllBytesAsync(Path.Combine(music, "known.mp3"), Enumerable.Repeat((byte)1, 1000).ToArray());
        await File.WriteAllBytesAsync(Path.Combine(music, "new.mp3"), Enumerable.Repeat((byte)2, 1000).ToArray());
        var lib = new LocalLibrary(db, Path.Combine(dir, "covers"), new FakeTags(p => new LocalTags(Path.GetFileNameWithoutExtension(p), "A", null, null, null, null, null, null, null)));
        await lib.ReconcileAsync([music]);
        var known = lib.All().Single(f => f.Title == "known");
        var knownSha = await lib.HashAsync(known.Id);
        long offset = 0;
        var server = new FakeServer((r, body) =>
        {
            if (r.Method == HttpMethod.Post)
                return JsonNode.Parse(body!)!["sha256"]!.GetValue<string>() == knownSha
                    ? (HttpStatusCode.Created, """{"exists":true,"state":"done"}""")
                    : (HttpStatusCode.Created, """{"id":"u1","offset":0,"state":"receiving"}""");
            Assert.Equal(offset.ToString(), r.Headers.GetValues("Upload-Offset").Single());
            offset += r.Content!.Headers.ContentLength ?? 0;
            return (HttpStatusCode.OK, $$"""{"id":"u1","offset":{{offset}},"state":"{{(offset >= 1000 ? "verifying" : "receiving")}}"}""");
        });
        var up = new Uploader(Api(server), lib, chunkBytes: 400);

        Assert.Equal(UploadOutcome.AlreadyThere, await up.UploadAsync(known.Id));
        Assert.DoesNotContain(server.Seen, s => s.Method == HttpMethod.Patch);

        Assert.Equal(UploadOutcome.Sent, await up.UploadAsync(lib.All().Single(f => f.Title == "new").Id));
        Assert.Equal(3, server.Seen.Count(s => s.Method == HttpMethod.Patch));  // 400 + 400 + 200
        Assert.Equal(1000, offset);
    }

    [Fact]
    public void Stream_refills_below_two_upcoming_and_a_reaction_drops_the_stale_tail()
    {
        Assert.False(QueuePolicy.NeedsStreamRefill(count: 3, index: 0));  // two still ahead
        Assert.True(QueuePolicy.NeedsStreamRefill(count: 3, index: 1));
        Assert.True(QueuePolicy.NeedsListTopUp(count: 5, index: 4));
        Assert.Equal(new Range(3, 6), QueuePolicy.DropAfterSignal(StreamSignal.Reaction, currentIndex: 2, count: 6));
        Assert.Equal(new Range(4, 6), QueuePolicy.DropAfterSignal(StreamSignal.Skip, currentIndex: 2, count: 6));
        Assert.Null(QueuePolicy.DropAfterSignal(StreamSignal.Reaction, currentIndex: 5, count: 6));
    }

    [Fact]
    public async Task Local_search_matches_word_prefixes_across_title_artist_and_album()
    {
        var music = Directory.CreateDirectory(Path.Combine(dir, "Fts")).FullName;
        await File.WriteAllBytesAsync(Path.Combine(music, "a.mp3"), [1]);
        await File.WriteAllBytesAsync(Path.Combine(music, "b.mp3"), [2]);
        var lib = new LocalLibrary(db, Path.Combine(dir, "covers"), new FakeTags(p => p.EndsWith("a.mp3")
            ? new LocalTags("Stronger", "Kanye West", "Graduation", 2007, null, null, null, null, null)
            : new LocalTags("Ночь", "Ёлка", "Город", null, null, null, null, null, null)));
        await lib.ReconcileAsync([music]);

        Assert.Equal("Stronger", Assert.Single(lib.Search("kan wes")).Title);
        Assert.Equal("Stronger", Assert.Single(lib.Search("gradu")).Title);
        Assert.Equal("Ночь", Assert.Single(lib.Search("елка")).Title);  // diacritics folded: ё = е
    }
}
