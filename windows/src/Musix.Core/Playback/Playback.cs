using System.Text.Json.Nodes;

namespace Musix.Core.Playback;

public enum QueueMode { List, Stream }

/// <summary>A strong signal during «Поток»: a reaction (огонёк/вода) or a listener skip.</summary>
public enum StreamSignal { Reaction, Skip }

/// <summary>
/// Queue rules, shared with Android (`QueuePolicy`, itself a port of the web's stream
/// handling). Pure, so the tests pin them; «Поток» keeps its session state on the server.
/// </summary>
public static class QueuePolicy
{
    /// <summary>«Поток» keeps a 1–2 track prefetch; refill when fewer remain after the current one.</summary>
    public const int StreamRefillBelow = 2, StreamChunk = 3;
    /// <summary>Played items kept before the current one, so "previous" still works.</summary>
    public const int HistoryKeep = 20, AutoplayLimit = 20, PlayedExcludeMax = 200;

    public static int Upcoming(int count, int index) => Math.Max(0, count - 1 - index);

    public static bool NeedsStreamRefill(int count, int index) => index >= 0 && Upcoming(count, index) < StreamRefillBelow;

    /// <summary>List mode tops up from autoplay as soon as the LAST item starts — no silent gap at its end.</summary>
    public static bool NeedsListTopUp(int count, int index) => count > 0 && index >= count - 1;

    /// <summary>
    /// The indices to drop after a signal — the tail was chosen by the pre-signal profile. A
    /// reaction keeps only the current track; a skip keeps one runway track for an instant jump.
    /// </summary>
    public static Range? DropAfterSignal(StreamSignal signal, int currentIndex, int count)
    {
        var keepThrough = signal == StreamSignal.Skip ? currentIndex + 1 : currentIndex;
        var from = keepThrough + 1;
        return currentIndex >= 0 && from < count ? new Range(from, count) : null;
    }

    public static int HistoryOverflow(int currentIndex) => Math.Max(0, currentIndex - HistoryKeep);
}

/// <summary>What the queue plays: a server track by id (through the playback manifest) or a file on this PC.</summary>
public sealed record QueueItem(string Id, string Title, string Artist, string? ServerTrackId, string? LocalPath, long DurationMs, string? CoverImageId);

/// <summary>The platform player (WinUI: `MediaPlayer` + `MediaPlaybackList` with SMTC).</summary>
public interface IPlaybackEngine
{
    event Action<int>? CurrentChanged;
    event Action<bool>? PlayingChanged;
    int CurrentIndex { get; }
    bool IsPlaying { get; }
    TimeSpan Position { get; }
    /// <summary>
    /// Queues what it can play and returns exactly that list, in order. A server track the
    /// manifest doesn't return is left out, and so is every server track while offline (local
    /// files still play). The caller's queue must be this list, or indexes drift apart.
    /// </summary>
    Task<IReadOnlyList<QueueItem>> ReplaceAsync(IReadOnlyList<QueueItem> items, int startIndex);
    Task<IReadOnlyList<QueueItem>> AppendAsync(IReadOnlyList<QueueItem> items);
    void RemoveRange(Range range);
    /// <summary>Plays the queued item at <paramref name="index"/> from its start.</summary>
    void MoveTo(int index);
    void Play();
    void Pause();
    void Next();
    void Previous();
    void Seek(TimeSpan to);
}

/// <summary>
/// Turns what was heard into v2 listen events (the same fields Android sends): one event per
/// item once it ends or is left, with the played time, whether it was dropped early, and why.
/// The event's client id is minted when the item starts, so a replay is a duplicate.
/// </summary>
public sealed class ListenTracker(Action<string, JsonObject> enqueue, string sessionId, Func<DateTimeOffset>? now = null)
{
    private readonly Func<DateTimeOffset> clock = now ?? (() => DateTimeOffset.UtcNow);
    private QueueItem? item;
    private DateTimeOffset startedAt;
    private string eventId = "";
    private TimeSpan played;
    private DateTimeOffset? since;
    private bool touched;

    /// <summary>v1's early-skip line: dropped within the first 30 s (or a third of a short track).</summary>
    public static bool SkippedEarly(TimeSpan played, long durationMs) =>
        played < TimeSpan.FromMilliseconds(Math.Min(30_000, durationMs > 0 ? durationMs / 3.0 : 30_000));

    public void Start(QueueItem next, string source)
    {
        item = next;
        Source = source;
        startedAt = clock();
        eventId = Guid.NewGuid().ToString();
        played = TimeSpan.Zero;
        since = null;
        touched = false;
    }

    public string Source { get; private set; } = "queue";

    public void Playing(bool on)
    {
        var t = clock();
        if (on) since ??= t;
        else if (since is { } s) { played += t - s; since = null; }
    }

    /// <summary>A reaction or a seek: the listener did something with this track.</summary>
    public void Interacted() => touched = true;

    private static readonly HashSet<string> Contexts = ["stream", "album", "playlist", "search", "artist", "queue"];

    /// <summary>
    /// The item is over — <paramref name="reason"/> is the server's `completed | skipped |
    /// stopped | error` — and its event is written if it was a server track that was heard.
    /// </summary>
    public void End(string reason)
    {
        if (item is null) return;
        Playing(false);
        if (item.ServerTrackId is { } id && played > TimeSpan.Zero)
        {
            var e = new JsonObject
            {
                ["clientEventId"] = eventId,
                ["sessionId"] = sessionId,
                ["trackId"] = id,
                ["startedAt"] = startedAt.ToString("O"),
                ["playedMs"] = (long)played.TotalMilliseconds,
                ["durationMs"] = item.DurationMs,
                ["endReason"] = reason,
                ["skippedEarly"] = reason == "skipped" && SkippedEarly(played, item.DurationMs),
                ["interacted"] = touched,
            };
            if (Contexts.Contains(Source)) e["contextType"] = Source;
            enqueue(eventId, e);
        }
        item = null;
    }
}
