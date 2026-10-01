using System.Text.Json.Nodes;
using Musix.Core.Api;
using Musix.Core.Playback;
using Windows.Media;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.Storage.Streams;

namespace Musix.App.Services;

/// <summary>
/// The Windows player (spec §2): `MediaPlayer` over a `MediaPlaybackList` — gapless, decoded by
/// Media Foundation (FLAC, ALAC, AAC, MP3), with the System Media Transport Controls (media
/// keys, the volume overlay, the lock screen) for free. A server item plays its signed URL
/// from `/playback/manifest`; a local one, its file. Loudness is applied as attenuation per
/// item from the manifest's gain (boost is off on Windows). An item whose URL expired is
/// re-asked once and replaced in place.
/// </summary>
public sealed class MediaEngine : IPlaybackEngine, IDisposable
{
    private readonly MediaPlayer player = new() { AudioCategory = MediaPlayerAudioCategory.Media };
    private readonly MediaPlaybackList list = new() { MaxPrefetchTime = TimeSpan.FromSeconds(20) };
    private readonly MusixHttp api;
    private readonly Func<string?, Uri?> cover;
    private readonly List<QueueItem> items = [];
    private readonly Dictionary<string, double> gainDb = new();
    private readonly HashSet<string> retried = [];
    private double volume = 1.0;
    // MediaPlayer raises its events on worker threads; the queue's brain lives on the UI thread
    private readonly Microsoft.UI.Dispatching.DispatcherQueue ui = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();

    public MediaEngine(MusixHttp api, Func<string?, Uri?> cover)
    {
        this.api = api;
        this.cover = cover;
        player.Source = list;
        list.CurrentItemChanged += (_, e) => ui.TryEnqueue(() =>
        {
            var i = e.NewItem is null ? -1 : (int)list.CurrentItemIndex;
            ApplyGain(i);
            CurrentChanged?.Invoke(i);
        });
        list.ItemFailed += (l, e) => ui.TryEnqueue(() => { var t = Recover(e.Item); });
        player.PlaybackSession.PlaybackStateChanged += (s, _) =>
        {
            var on = s.PlaybackState == MediaPlaybackState.Playing;
            ui.TryEnqueue(() => PlayingChanged?.Invoke(on));
        };
    }

    public event Action<int>? CurrentChanged;
    public event Action<bool>? PlayingChanged;
    public int CurrentIndex => list.Items.Count == 0 ? -1 : (int)list.CurrentItemIndex;
    public bool IsPlaying => player.PlaybackSession.PlaybackState == MediaPlaybackState.Playing;
    public TimeSpan Position => player.PlaybackSession.Position;
    public TimeSpan Duration => player.PlaybackSession.NaturalDuration;
    public IReadOnlyList<QueueItem> Items => items;

    public double Volume { get => volume; set { volume = Math.Clamp(value, 0, 1); ApplyGain(CurrentIndex); } }

    public void Replace(IReadOnlyList<QueueItem> next, int startIndex) => _ = ReplaceAsync(next, startIndex);

    public async Task ReplaceAsync(IReadOnlyList<QueueItem> next, int startIndex)
    {
        player.Pause();
        list.Items.Clear();
        items.Clear();
        await AppendAsync(next);
        if (startIndex > 0 && startIndex < list.Items.Count) list.MoveTo((uint)startIndex);
        player.Play();
    }

    public void Append(IReadOnlyList<QueueItem> more) => _ = AppendAsync(more);

    private async Task AppendAsync(IReadOnlyList<QueueItem> more)
    {
        var urls = await Manifest(more.Where(i => i.LocalPath is null && i.ServerTrackId is not null).Select(i => i.ServerTrackId!).ToList());
        foreach (var q in more)
        {
            Uri? src = q.LocalPath is { } p ? new Uri(p) : q.ServerTrackId is { } id && urls.TryGetValue(id, out var u) ? u : null;
            if (src is null) continue;  // a track the server no longer knows: left out, as the manifest does
            items.Add(q);
            list.Items.Add(Item(q, src));
        }
    }

    public void RemoveRange(Range range)
    {
        var (from, len) = range.GetOffsetAndLength(items.Count);
        for (var i = from + len - 1; i >= from; i--) { list.Items.RemoveAt(i); items.RemoveAt(i); }
    }

    public void Play() => player.Play();
    public void Pause() => player.Pause();
    public void Next() => list.MoveNext();
    public void Previous()
    {
        if (player.PlaybackSession.Position > TimeSpan.FromSeconds(3)) player.PlaybackSession.Position = TimeSpan.Zero;
        else list.MovePrevious();
    }
    public void Seek(TimeSpan to) => player.PlaybackSession.Position = to;
    public void Toggle() { if (IsPlaying) Pause(); else Play(); }

    private MediaPlaybackItem Item(QueueItem q, Uri src)
    {
        var item = new MediaPlaybackItem(MediaSource.CreateFromUri(src));
        var props = item.GetDisplayProperties();
        props.Type = MediaPlaybackType.Music;
        props.MusicProperties.Title = q.Title;
        props.MusicProperties.Artist = q.Artist;
        if (cover(q.CoverImageId) is { } c) props.Thumbnail = RandomAccessStreamReference.CreateFromUri(c);
        item.ApplyDisplayProperties(props);
        item.Source.CustomProperties["id"] = q.Id;
        return item;
    }

    private async Task<Dictionary<string, Uri>> Manifest(List<string> ids)
    {
        var urls = new Dictionary<string, Uri>();
        foreach (var page in ids.Chunk(20))
        {
            var m = await api.SendJsonAsync(HttpMethod.Post, "api/v2/playback/manifest", new { trackIds = page, network = "wifi" });
            foreach (var it in m?["items"]?.AsArray() ?? [])
            {
                var id = it!["trackId"]!.GetValue<string>();
                urls[id] = new Uri(it["url"]!.GetValue<string>());
                var g = it["gain"]?["trackDb"];
                if (g is JsonValue v && v.TryGetValue<double>(out var db)) gainDb[id] = db;
            }
        }
        return urls;
    }

    /// <summary>Attenuation only: a negative gain lowers the item, a positive one plays at the set volume.</summary>
    private void ApplyGain(int index)
    {
        var g = index >= 0 && index < items.Count && items[index].ServerTrackId is { } id && gainDb.TryGetValue(id, out var db) ? Math.Min(0, db) : 0;
        player.Volume = volume * Math.Pow(10, g / 20);
    }

    private async Task Recover(MediaPlaybackItem failed)
    {
        var i = list.Items.IndexOf(failed);
        if (i < 0 || i >= items.Count) return;
        var q = items[i];
        if (q.ServerTrackId is not { } id || !retried.Add(id)) return;  // once per track: a second failure is real
        var urls = await Manifest([id]);
        if (!urls.TryGetValue(id, out var u)) return;
        var wasCurrent = CurrentIndex == i;
        list.Items[i] = Item(q, u);
        if (wasCurrent) { list.MoveTo((uint)i); player.Play(); }
    }

    public void Dispose() => player.Dispose();
}
