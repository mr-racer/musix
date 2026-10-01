using System.Text.Json.Nodes;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Musix.App.Ui;

namespace Musix.App.Views;

/// <summary>
/// Search (the web's): as you type, only the catalog section, debounced. On Enter, the full
/// search adds lyric lines/meaning and «как звучит» (CLAP). Offline, the mirror answers by
/// title/artist.
/// </summary>
public sealed class SearchView : UserControl
{
    private readonly AutoSuggestBox box = new() { PlaceholderText = "Песня, артист, строчка из текста или «как звучит»", QueryIcon = new SymbolIcon(Symbol.Find), MaxWidth = 720 };
    private readonly StackPanel results = M.V(28);
    private readonly DispatcherTimer debounce = new() { Interval = TimeSpan.FromMilliseconds(220) };
    private int generation;

    public SearchView(string? query = null)
    {
        box.HorizontalAlignment = HorizontalAlignment.Stretch;
        box.TextChanged += (_, e) => { if (e.Reason == AutoSuggestionBoxTextChangeReason.UserInput) { debounce.Stop(); debounce.Start(); } };
        box.QuerySubmitted += (_, _) => _ = Run(full: true);
        debounce.Tick += (_, _) => { debounce.Stop(); _ = Run(full: false); };
        var body = M.V(24, M.T("Поиск", 34, font: Theme.Display), box, results);
        body.Padding = new Thickness(40, 36, 40, 40);
        Content = new ScrollViewer { Content = body };
        Loaded += (_, _) => box.Focus(FocusState.Programmatic);
        if (query is not null) { box.Text = query; _ = Run(full: true); }
    }

    private async Task Run(bool full)
    {
        var q = box.Text.Trim();
        var gen = ++generation;
        if (q.Length == 0) { results.Children.Clear(); return; }
        var sections = full ? "catalog,lyrics,sound" : "catalog";
        try
        {
            var r = await App.Shared.Api.GetJsonAsync($"api/v2/search?q={Uri.EscapeDataString(q)}&limit=12&sections={sections}") as JsonObject;
            if (gen != generation || r is null) return;  // a newer query already answered
            Draw(r);
        }
        catch (Exception)
        {
            if (gen == generation) DrawOffline(q);
        }
    }

    private void Draw(JsonObject r)
    {
        results.Children.Clear();
        var images = r["images"] as JsonObject;
        Tracks("Треки", r["tracks"]?.AsArray().OfType<JsonObject>(), images);
        var albums = (r["albums"]?.AsArray() ?? []).OfType<JsonObject>().Select(a => new AlbumRow(a["id"]!.GetValue<string>(), a["title"]!.GetValue<string>(),
            a["year"]?.GetValue<long>(), a["coverImageId"]?.GetValue<string>(), a["albumArtist"]?["name"]?.GetValue<string>() ?? "", 0, 0)).ToList();
        if (albums.Count > 0)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 20 };
            foreach (var a in albums) { var t = new AlbumTile(164); t.Bind(a); row.Children.Add(t); }
            results.Children.Add(M.V(12, M.Eyebrow("Альбомы"), new ScrollViewer { Content = row, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalScrollMode = ScrollMode.Enabled }));
        }
        var artists = (r["artists"]?.AsArray() ?? []).OfType<JsonObject>().ToList();
        if (artists.Count > 0)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 20 };
            foreach (var a in artists) { var t = new ArtistTile(132); t.Bind(new ArtistRow(a["id"]!.GetValue<string>(), a["name"]!.GetValue<string>(), a["imageId"]?.GetValue<string>(), 0)); row.Children.Add(t); }
            results.Children.Add(M.V(12, M.Eyebrow("Артисты"), new ScrollViewer { Content = row, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalScrollMode = ScrollMode.Enabled }));
        }
        Tracks("По тексту", r["lyrics"]?.AsArray().OfType<JsonObject>().Select(s => s["track"] as JsonObject).OfType<JsonObject>(), images);
        Tracks("Как звучит", r["sound"]?.AsArray().OfType<JsonObject>().Select(s => s["track"] as JsonObject).OfType<JsonObject>(), images);
        if (results.Children.Count == 0) results.Children.Add(M.T("Ничего не нашлось", 15, Theme.B("MxTextMuted")));
        if ((r["degraded"]?.AsArray().Count ?? 0) > 0)
            results.Children.Add(M.T("Часть поиска сейчас недоступна — показано, что успело ответить.", 12.5, Theme.B("MxTextSubtle")));
    }

    private void Tracks(string title, IEnumerable<JsonObject>? tracks, JsonObject? images)
    {
        var list = (tracks ?? []).Select(t => new TrackRow(t["id"]!.GetValue<string>(), t["titleDisplay"]?.GetValue<string>() ?? t["title"]!.GetValue<string>(),
            t["artistDisplay"]?.GetValue<string>() ?? "", t["album"]?.GetValue<string>(), t["durationMs"]?.GetValue<long>() ?? 0, t["coverImageId"]?.GetValue<string>(), null)).ToList();
        if (list.Count == 0) return;
        var ids = list.Select(t => t.Id).ToList();
        var panel = M.V(2, M.Eyebrow(title).Margin(0, 0, 0, 8));
        for (var i = 0; i < list.Count; i++)
        {
            var line = new TrackLine(n => App.Shared.Player.PlayTracks(ids, n, "search"));
            line.Bind(new At<TrackRow>(list[i], i));
            panel.Children.Add(line);
        }
        results.Children.Add(panel);
    }

    private void DrawOffline(string q)
    {
        results.Children.Clear();
        var words = q.Replace('ё', 'е').Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var hits = Dapper.SqlMapper.Query<TrackRow>(App.Shared.Db.Conn, "SELECT id, title, artist, album, duration_ms, cover_image_id, track_no FROM tracks")
            .Where(t => words.All(w => $"{t.Title} {t.Artist} {t.Album}".Replace('ё', 'е').Contains(w, StringComparison.OrdinalIgnoreCase))).Take(50).ToList();
        results.Children.Add(M.T("Сервер недоступен — ищу в библиотеке на этом ПК", 12.5, Theme.B("MxTextSubtle")));
        var ids = hits.Select(t => t.Id).ToList();
        for (var i = 0; i < hits.Count; i++)
        {
            var line = new TrackLine(n => App.Shared.Player.PlayTracks(ids, n, "search"));
            line.Bind(new At<TrackRow>(hits[i], i));
            results.Children.Add(line);
        }
    }
}
