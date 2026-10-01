using System.Text.Json.Nodes;
using Dapper;
using Musix.Core.Api;
using Musix.Core.Store;

namespace Musix.Core.Outbox;

/// <summary>
/// Mutations made on this PC (Android `Outbox`): a row per mutation, keyed by the client id
/// the server dedupes on, replayed in order. A crash between "sent" and "deleted" replays the
/// row and the server answers it as a duplicate — never a second copy. A network error, 401,
/// 408, 429 or 5xx stops the flush (the rest waits, in order); any other 4xx is permanent and
/// the row is dropped, or it would block every mutation behind it forever.
/// </summary>
public sealed class Outbox(Db db, MusixHttp api)
{
    public const string Listen = "listen", Signal = "signal", PlaylistCreate = "playlist.create", PlaylistPatch = "playlist.patch",
        PlaylistDelete = "playlist.delete", PlaylistAdd = "playlist.add", PlaylistMove = "playlist.move",
        PlaylistRemove = "playlist.remove", Settings = "settings";

    private readonly SemaphoreSlim gate = new(1, 1);

    /// <summary>Raised after an enqueue so the app can schedule a flush.</summary>
    public event Action? Enqueued;

    public int Pending => db.Conn.ExecuteScalar<int>("SELECT count(*) FROM outbox");

    public void Enqueue(string kind, string key, JsonObject payload)
    {
        db.Conn.Execute("INSERT OR IGNORE INTO outbox(kind, key, payload, created_at) VALUES (@kind, @key, @p, @at)",
            new { kind, key, p = payload.ToJsonString(), at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
        Enqueued?.Invoke();
    }

    public abstract record Flush
    {
        public sealed record Done : Flush;
        public sealed record Retry(string Reason) : Flush;
    }

    public async Task<Flush> FlushAsync(CancellationToken ct = default)
    {
        await gate.WaitAsync(ct);
        try
        {
            while (true)
            {
                var head = db.Conn.Query<Row>("SELECT seq, kind, key, payload FROM outbox ORDER BY seq LIMIT 100").ToList();
                if (head.Count == 0) return new Flush.Done();
                // consecutive listens go as one batch; anything else goes alone, in order
                var batch = head[0].Kind == Listen ? head.TakeWhile(r => r.Kind == Listen).ToList() : head.Take(1).ToList();
                try
                {
                    await SendAsync(batch, ct);
                    Done(batch);
                }
                catch (ApiError e) when (e.Transient)
                {
                    Failed(batch, $"HTTP {e.Status}");
                    return new Flush.Retry($"HTTP {e.Status}");
                }
                catch (ApiError)
                {
                    Done(batch);  // permanent: the server will never take it
                }
                catch (Exception e) when (e is HttpRequestException or TaskCanceledException or TimeoutException)
                {
                    Failed(batch, e.GetType().Name);
                    return new Flush.Retry(e.GetType().Name);
                }
            }
        }
        finally { gate.Release(); }
    }

    private void Done(List<Row> batch) => db.Conn.Execute("DELETE FROM outbox WHERE seq IN @seqs", new { seqs = batch.Select(b => b.Seq) });

    private void Failed(List<Row> batch, string why) =>
        db.Conn.Execute("UPDATE outbox SET attempts = attempts + 1, last_error = @why WHERE seq IN @seqs", new { why, seqs = batch.Select(b => b.Seq) });

    private async Task SendAsync(List<Row> batch, CancellationToken ct)
    {
        var first = batch[0];
        var p = JsonNode.Parse(first.Payload)!.AsObject();
        string s(string k) => p[k]!.GetValue<string>();
        JsonObject without(string k) { var o = p.DeepClone().AsObject(); o.Remove(k); return o; }
        switch (first.Kind)
        {
            case Listen:
                await api.SendJsonAsync(HttpMethod.Post, "api/v2/events/listens:batch",
                    new JsonObject { ["events"] = new JsonArray(batch.Select(b => JsonNode.Parse(b.Payload)).ToArray()) }.ToJsonString(), ct);
                break;
            case Signal:
                var sig = new JsonObject { ["kind"] = s("kind"), ["clientEventId"] = s("clientEventId") };
                if (p["sessionId"] is { } sid) sig["sessionId"] = sid.DeepClone();
                await api.SendJsonAsync(HttpMethod.Post, $"api/v2/tracks/{s("trackId")}/signals", sig.ToJsonString(), ct);
                break;
            case PlaylistCreate: await api.SendJsonAsync(HttpMethod.Post, "api/v2/playlists", first.Payload, ct); break;
            case PlaylistPatch: await api.SendJsonAsync(HttpMethod.Patch, $"api/v2/playlists/{s("id")}", without("id").ToJsonString(), ct); break;
            case PlaylistDelete: await api.SendJsonAsync(HttpMethod.Delete, $"api/v2/playlists/{s("id")}", null, ct); break;
            case PlaylistAdd: await api.SendJsonAsync(HttpMethod.Post, $"api/v2/playlists/{s("playlistId")}/items", without("playlistId").ToJsonString(), ct); break;
            case PlaylistMove:
                await api.SendJsonAsync(HttpMethod.Patch, $"api/v2/playlists/{s("playlistId")}/items/{s("itemId")}",
                    new JsonObject { ["position"] = s("position") }.ToJsonString(), ct);
                break;
            case PlaylistRemove: await api.SendJsonAsync(HttpMethod.Delete, $"api/v2/playlists/{s("playlistId")}/items/{s("itemId")}", null, ct); break;
            case Settings: await api.SendJsonAsync(HttpMethod.Put, "api/v2/settings", first.Payload, ct); break;
            // an unknown kind from a newer build: dropped
        }
    }

    private sealed record Row(long Seq, string Kind, string Key, string Payload);
}
