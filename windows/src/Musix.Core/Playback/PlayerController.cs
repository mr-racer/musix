using System.Text.Json.Nodes;
using Dapper;
using Musix.Core.Api;
using Musix.Core.Local;
using Musix.Core.Store;

namespace Musix.Core.Playback;

/// <summary>
/// The queue's brain over a platform engine (Android's PlaybackService rules): list mode
/// tops up from autoplay as the last item starts; «Поток» keeps a prefetch of 1–2 and, after
/// a reaction or a skip, drops the tail chosen by the old profile and asks again. Every heard
/// server track becomes a listen in the outbox; reactions go there too, as signals.
/// </summary>
public sealed class PlayerController
{
    private readonly IPlaybackEngine engine;
    private readonly MusixHttp api;
    private readonly Db db;
    private readonly Action<string, string, JsonObject> enqueue;
    private readonly ListenTracker tracker;
    private readonly string session = Guid.NewGuid().ToString("N")[..16];
    private readonly List<QueueItem> queue = [];
    private bool refilling;
    private int current = -1;

    public PlayerController(IPlaybackEngine engine, MusixHttp api, Db db, Action<string, string, JsonObject> enqueue)
    {
        this.engine = engine;
        this.api = api;
        this.db = db;
        this.enqueue = enqueue;
        tracker = new ListenTracker((key, e) => enqueue("listen", key, e), session);
        engine.CurrentChanged += OnCurrent;
        engine.PlayingChanged += on =>
        {
            tracker.Playing(on);
            if (on) Owner = true;  // playing here = this PC has the account's playback
            PublishSoon();
            Changed?.Invoke();
        };
    }

    // ─── «Слушать на…» (phase 8 §1) ─────────────────────────────────────────

    /// <summary>Where the state goes (the realtime socket); null until the app connects one.</summary>
    public Func<JsonObject, Task>? Publish { get; set; }

    /// <summary>This PC owns the account's playback: it publishes and obeys remote commands.</summary>
    public bool Owner { get; private set; }

    /// <summary>The account plays on another device now (the «Играет на …» line).</summary>
    public (string Device, bool Playing)? Remote { get; private set; }

    private CancellationTokenSource? publishSoon;
    private DateTime lastPublish;

    private void PublishSoon()
    {
        publishSoon?.Cancel();
        var cts = publishSoon = new CancellationTokenSource();
        _ = Task.Delay(400, cts.Token).ContinueWith(t => { if (!t.IsCanceled) _ = PublishState(); }, TaskScheduler.Current);
    }

    /// <summary>Every 10 s while playing (the app's timer calls it); positions drift otherwise.</summary>
    public void Heartbeat() { if (Owner && engine.IsPlaying && DateTime.UtcNow - lastPublish > TimeSpan.FromSeconds(10)) _ = PublishState(); }

    public async Task PublishState()
    {
        if (!Owner || Publish is null || Current is null) return;
        var ids = queue.Select(q => q.ServerTrackId).ToList();
        if (Current.ServerTrackId is null || ids.Any(i => i is null)) return;  // a queue with local files can't be continued elsewhere
        var from = Math.Max(0, current - 50);
        var window = ids.Skip(from).Take(500).ToList();
        lastPublish = DateTime.UtcNow;
        await Publish(new JsonObject
        {
            ["type"] = "playback.state",
            ["state"] = new JsonObject
            {
                ["trackIds"] = new JsonArray(window.Select(i => (JsonNode)JsonValue.Create(i)!).ToArray()),
                ["index"] = current - from, ["positionMs"] = (long)engine.Position.TotalMilliseconds, ["playing"] = engine.IsPlaying,
                ["mode"] = Mode == QueueMode.Stream ? "stream" : "list", ["contextType"] = Context,
            },
        });
    }

    /// <summary>A realtime message: hello on `ready`, then take, release, other players' state, commands.</summary>
    public async Task OnRealtime(JsonObject msg)
    {
        switch (msg["type"]?.GetValue<string>())
        {
            case "ready":
                if (Publish is not null) await Publish(new JsonObject { ["type"] = "device.hello", ["canPlay"] = true });
                await PublishState();
                break;
            case "playback.take":
                await TakeAsync(msg["play"]?.GetValue<bool>() ?? true);
                break;
            case "playback.release":
                Owner = false;
                engine.Pause();
                break;
            case "playback.state":  // never echoed to its sender: another device is the active player
                var playing = msg["playing"]?.GetValue<bool>() == true;
                Remote = (msg["device"]?.GetValue<string>() ?? "", playing);
                if (playing && Owner && engine.IsPlaying) { Owner = false; engine.Pause(); }
                Changed?.Invoke();
                break;
            case "playback.command" when Owner:
                switch (msg["command"]?.GetValue<string>())
                {
                    case "play": engine.Play(); break;
                    case "pause": engine.Pause(); break;
                    case "toggle": Toggle(); break;
                    case "next": Next(); break;
                    case "prev": Previous(); break;
                    case "seek" when msg["positionMs"] is JsonValue p: Seek(TimeSpan.FromMilliseconds(p.GetValue<long>())); break;
                    case "signal" when msg["kind"]?.GetValue<string>() is { } kind: React(kind); break;
                }
                break;
        }
    }

    /// <summary>The account's session, continued here (the state is up to 10 s old).</summary>
    public async Task TakeAsync(bool play)
    {
        if (await api.GetJsonAsync("api/v2/playback/session") is not JsonObject s || s["state"] is not JsonObject st) return;
        var ids = (st["trackIds"]?.AsArray() ?? []).Select(x => x!.GetValue<string>()).ToList();
        var index = st["index"]?.GetValue<int>() ?? 0;
        var lag = st["playing"]?.GetValue<bool>() == true && s["updatedAt"]?.GetValue<DateTimeOffset>() is { } at ? DateTimeOffset.UtcNow - at : TimeSpan.Zero;
        var rows = db.Conn.Query<(string Id, string Title, string Artist, long DurationMs, string? CoverImageId)>(
            "SELECT id, title, artist, duration_ms, cover_image_id FROM tracks WHERE id IN @ids", new { ids }).ToDictionary(r => r.Id);
        var items = ids.Where(rows.ContainsKey).Select(id => rows[id]).Select(r => new QueueItem(r.Id, r.Title, r.Artist, r.Id, null, r.DurationMs, r.CoverImageId)).ToList();
        if (items.Count == 0) return;
        var want = ids.ElementAtOrDefault(index);
        var at2 = Math.Max(0, items.FindIndex(i => i.Id == want));
        Owner = true;
        Remote = null;
        await StartAsync(items, at2, st["mode"]?.GetValue<string>() == "stream" ? QueueMode.Stream : QueueMode.List, st["contextType"]?.GetValue<string>() ?? "queue");
        if (items[at2].Id == want) engine.Seek(TimeSpan.FromMilliseconds((st["positionMs"]?.GetValue<long>() ?? 0)) + lag);
        if (!play) engine.Pause();
    }

    /// <summary>The music goes to another device (or comes here).</summary>
    public async Task TransferAsync(string toDevice) =>
        await api.SendJsonAsync(HttpMethod.Post, "api/v2/playback/transfer", new { toDevice, play = true });

    public async Task<IReadOnlyList<JsonObject>> DevicesAsync() =>
        (await api.GetJsonAsync("api/v2/devices/active"))?.AsArray().OfType<JsonObject>().ToList() ?? [];

    public event Action? Changed;
    public QueueMode Mode { get; private set; } = QueueMode.List;
    public string Context { get; private set; } = "queue";
    public IReadOnlyList<QueueItem> Queue => queue;
    public QueueItem? Current => current >= 0 && current < queue.Count ? queue[current] : null;
    public bool IsPlaying => engine.IsPlaying;

    /// <summary>Plays server tracks from the mirror, in order, from <paramref name="index"/>.</summary>
    public void PlayTracks(IReadOnlyList<string> trackIds, int index, string context)
    {
        var rows = db.Conn.Query<(string Id, string Title, string Artist, long DurationMs, string? CoverImageId)>(
            "SELECT id, title, artist, duration_ms, cover_image_id FROM tracks WHERE id IN @ids", new { ids = trackIds }).ToDictionary(r => r.Id);
        var items = trackIds.Where(rows.ContainsKey).Select(id => rows[id]).Select(r => new QueueItem(r.Id, r.Title, r.Artist, r.Id, null, r.DurationMs, r.CoverImageId)).ToList();
        _ = StartAsync(items, index, QueueMode.List, context);
    }

    /// <summary>Plays this PC's files at once (no network); a file linked to a server track also counts as a listen.</summary>
    public void PlayLocal(IReadOnlyList<LocalTrack> files, int index) =>
        _ = StartAsync(files.Select(f => new QueueItem($"local:{f.Id}", f.Title, f.Artist, f.ServerTrackId, f.Path, f.DurationMs ?? 0, null)).ToList(), index, QueueMode.List, "queue");

    /// <summary>«Поток»: the server picks, three at a time, and keeps its own session state.</summary>
    public async Task StartStreamAsync(CancellationToken ct = default)
    {
        var items = await NextChunk(QueuePolicy.StreamChunk, ct);
        await StartAsync(items, 0, QueueMode.Stream, "stream");
    }

    public void Toggle() { if (engine.IsPlaying) engine.Pause(); else engine.Play(); }
    public void Next() { tracker.End("skipped"); Signal(StreamSignal.Skip); engine.Next(); }
    public void Previous() => engine.Previous();
    public void Seek(TimeSpan to) { tracker.Interacted(); engine.Seek(to); }

    /// <summary>огонёк / вода: a signal in the outbox; in «Поток» the stale tail goes and new picks come.</summary>
    public void React(string kind)
    {
        if (Current?.ServerTrackId is not { } id) return;
        tracker.Interacted();
        var key = Guid.NewGuid().ToString();
        enqueue("signal", key, new JsonObject { ["trackId"] = id, ["kind"] = kind, ["clientEventId"] = key, ["sessionId"] = session });
        Signal(StreamSignal.Reaction);
    }

    private async Task StartAsync(List<QueueItem> items, int index, QueueMode mode, string context)
    {
        tracker.End("stopped");
        Mode = mode;
        Context = context;
        queue.Clear();  // until the engine says what it took, no index means anything
        current = -1;
        var taken = await engine.ReplaceAsync(items, Math.Clamp(index, 0, Math.Max(0, items.Count - 1)));
        queue.AddRange(taken);
        OnCurrent(engine.CurrentIndex);
        Changed?.Invoke();
    }

    private void OnCurrent(int index)
    {
        if (index == current || index >= queue.Count) return;  // an event from before the queue landed
        if (current >= 0) tracker.End(index == current + 1 ? "completed" : "skipped");
        current = index;
        if (Current is { } item) { tracker.Start(item, Context); tracker.Playing(engine.IsPlaying); }
        Changed?.Invoke();
        _ = Refill();
    }

    private void Signal(StreamSignal s)
    {
        if (Mode != QueueMode.Stream) return;
        if (QueuePolicy.DropAfterSignal(s, current, queue.Count) is { } drop)
        {
            var (from, len) = drop.GetOffsetAndLength(queue.Count);
            queue.RemoveRange(from, len);
            engine.RemoveRange(drop);
        }
        _ = Refill();
    }

    private async Task Refill()
    {
        if (refilling) return;
        refilling = true;
        try
        {
            if (Mode == QueueMode.Stream && QueuePolicy.NeedsStreamRefill(queue.Count, current))
            {
                var more = await NextChunk(QueuePolicy.StreamChunk, default);
                queue.AddRange(await engine.AppendAsync(more));
            }
            else if (Mode == QueueMode.List && QueuePolicy.NeedsListTopUp(queue.Count, current) && Current?.ServerTrackId is { } seed)
            {
                var exclude = queue.Select(q => q.ServerTrackId).OfType<string>().TakeLast(QueuePolicy.PlayedExcludeMax).ToArray();
                var r = await api.SendJsonAsync(HttpMethod.Post, "api/v2/stream/autoplay",
                    new { seedTrackId = seed, excludeIds = exclude, limit = QueuePolicy.AutoplayLimit });
                queue.AddRange(await engine.AppendAsync(Tracks(r?["tracks"]?.AsArray())));
            }
        }
        catch (Exception) { /* offline: the queue just ends; the next start tries again */ }
        finally { refilling = false; Changed?.Invoke(); }
    }

    private async Task<List<QueueItem>> NextChunk(int n, CancellationToken ct) =>
        Items(await api.GetJsonAsync($"api/v2/stream/next?sessionId={session}&n={n}&lang=ru&tzOffsetMinutes={(int)TimeZoneInfo.Local.GetUtcOffset(DateTime.Now).TotalMinutes}", ct));

    private static List<QueueItem> Items(JsonNode? r) => Tracks(new JsonArray((r?["items"]?.AsArray() ?? []).Select(it => it?["track"]?.DeepClone()).ToArray()));

    private static List<QueueItem> Tracks(JsonArray? tracks) =>
        (tracks ?? []).OfType<JsonObject>().Select(t => new QueueItem(
            t["id"]!.GetValue<string>(), t["titleDisplay"]?.GetValue<string>() ?? t["title"]!.GetValue<string>(), t["artistDisplay"]?.GetValue<string>() ?? "",
            t["id"]!.GetValue<string>(), null, t["durationMs"]?.GetValue<long>() ?? 0, t["coverImageId"]?.GetValue<string>())).ToList();
}
