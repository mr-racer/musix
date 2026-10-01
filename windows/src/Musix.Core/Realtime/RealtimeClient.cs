using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using Musix.Core.Api;

namespace Musix.Core.Realtime;

/// <summary>
/// The realtime channel (`/api/v2/ws`). It authenticates with the first message and resumes
/// by `lastSeq`. A close with 4401 renews the token once, then the client reconnects with
/// backoff. Every message reaches <see cref="Message"/> (on the thread pool). `sync.changed`
/// triggers a sync, and the handoff messages drive the player.
/// </summary>
public sealed class RealtimeClient(Uri server, IAccessTokens tokens) : IAsyncDisposable
{
    private readonly CancellationTokenSource stop = new();
    private ClientWebSocket? ws;
    private long? lastSeq;
    private Task? loop;
    private readonly SemaphoreSlim sendGate = new(1, 1);

    public event Action<JsonObject>? Message;

    public void Start() => loop ??= Task.Run(() => Run(stop.Token));

    /// <summary>A message to the server; dropped while reconnecting (the player re-publishes on `ready`).</summary>
    public async Task SendAsync(JsonObject msg)
    {
        var s = ws;
        if (s is null || s.State != WebSocketState.Open) return;
        await sendGate.WaitAsync();
        try { await s.SendAsync(Encoding.UTF8.GetBytes(msg.ToJsonString()), WebSocketMessageType.Text, true, stop.Token); }
        catch (Exception) { /* the receive loop notices and reconnects */ }
        finally { sendGate.Release(); }
    }

    private async Task Run(CancellationToken ct)
    {
        var backoff = TimeSpan.FromSeconds(1);
        while (!ct.IsCancellationRequested)
        {
            var code = await Session(ct);
            if (ct.IsCancellationRequested) return;
            if (code == 4401) await tokens.RenewAsync(tokens.Current, ct);
            if (code == (int)WebSocketCloseStatus.NormalClosure) backoff = TimeSpan.FromSeconds(1);
            try { await Task.Delay(backoff, ct); } catch (OperationCanceledException) { return; }
            backoff = TimeSpan.FromSeconds(Math.Min(60, backoff.TotalSeconds * 2));
        }
    }

    private async Task<int> Session(CancellationToken ct)
    {
        using var s = new ClientWebSocket();
        ws = s;
        try
        {
            var url = new UriBuilder(new Uri(server, "api/v2/ws")) { Scheme = server.Scheme == "https" ? "wss" : "ws" }.Uri;
            await s.ConnectAsync(url, ct);
            var token = tokens.Current ?? await tokens.RenewAsync(null, ct);
            if (token is null) return 4401;
            var auth = new JsonObject { ["type"] = "auth", ["token"] = token };
            if (lastSeq is { } seq) auth["lastSeq"] = seq;
            await s.SendAsync(Encoding.UTF8.GetBytes(auth.ToJsonString()), WebSocketMessageType.Text, true, ct);
            var buf = new byte[64 * 1024];
            var text = new MemoryStream();
            while (s.State == WebSocketState.Open)
            {
                var r = await s.ReceiveAsync(buf, ct);
                if (r.MessageType == WebSocketMessageType.Close) break;
                text.Write(buf, 0, r.Count);
                if (!r.EndOfMessage) continue;
                var msg = JsonNode.Parse(text.ToArray()) as JsonObject;
                text.SetLength(0);
                if (msg is null) continue;
                if (msg["type"]?.GetValue<string>() is "ready" or "sync.changed" && msg["seq"] is JsonValue v && v.TryGetValue<long>(out var n)) lastSeq = n;
                Message?.Invoke(msg);
            }
            return (int?)s.CloseStatus ?? -1;
        }
        catch (Exception) when (!ct.IsCancellationRequested) { return -1; }
        catch (OperationCanceledException) { return 0; }
        finally { ws = null; }
    }

    public async ValueTask DisposeAsync()
    {
        stop.Cancel();
        if (loop is not null) await loop.ContinueWith(_ => { });
    }
}
