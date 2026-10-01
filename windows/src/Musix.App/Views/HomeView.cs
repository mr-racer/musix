using System.Text.Json.Nodes;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Musix.App.Ui;

namespace Musix.App.Views;

/// <summary>
/// Home (spec §7): the «Поток» orb with the AI phrase, the vibes, what was added and played
/// lately, the playlists. The last `/home` answer is kept in the store, so the page draws at
/// once (offline too) and the network refreshes it behind.
/// </summary>
public sealed class HomeView : UserControl, IRefreshable
{
    private const string CacheKey = "home.json";
    private readonly StackPanel body = M.V(34);
    private readonly Orb orb;
    private readonly TextBlock phrase = M.T("Музыка, которая подстраивается под тебя", 26, Theme.B("MxText"), FontWeights.Light, Theme.SerifItalic, wrap: true);
    private readonly TextBlock pulse = M.T("", 13, Theme.B("MxTextSubtle"), font: Theme.Mono);
    private readonly StackPanel sections = M.V(34);
    private readonly StackPanel anchors = new() { Orientation = Orientation.Horizontal, Spacing = 13, HorizontalAlignment = HorizontalAlignment.Center };
    private bool starting;

    public HomeView()
    {
        body.Padding = new Thickness(40, 40, 40, 40);
        orb = new Orb(220, () => _ = StartStream());
        phrase.TextAlignment = TextAlignment.Center;
        phrase.MaxWidth = 620;
        pulse.HorizontalAlignment = HorizontalAlignment.Center;
        var hero = M.V(18, orb.Align(HorizontalAlignment.Center), M.Eyebrow("Поток").Align(HorizontalAlignment.Center), phrase.Align(HorizontalAlignment.Center), pulse, anchors);
        hero.Margin = new Thickness(0, 10, 0, 6);
        body.Children.Add(hero);
        body.Children.Add(sections);
        Content = new ScrollViewer { Content = body };
        Loaded += (_, _) => App.Shared.Player.Changed += SyncOrb;
        Unloaded += (_, _) => App.Shared.Player.Changed -= SyncOrb;
        SyncOrb();
        if (App.Shared.Db.Kv(CacheKey) is { } cached && JsonNode.Parse(cached) is JsonObject h) Draw(h);
        _ = Load();
    }

    public void Refresh() => _ = Load();

    private void SyncOrb() => orb.SetPlaying(App.Shared.Player.Mode == Musix.Core.Playback.QueueMode.Stream && App.Shared.Player.IsPlaying);

    private async Task StartStream()
    {
        var p = App.Shared.Player;
        if (p.Mode == Musix.Core.Playback.QueueMode.Stream && p.Current is not null) { p.Toggle(); return; }
        if (starting) return;
        starting = true;
        try { await p.StartStreamAsync(); }
        catch (Exception) { phrase.Text = "Поток недоступен без сервера — включи что-нибудь из библиотеки"; }
        finally { starting = false; }
    }

    private async Task Load()
    {
        try
        {
            var tz = (int)TimeZoneInfo.Local.GetUtcOffset(DateTime.Now).TotalMinutes;
            if (await App.Shared.Api.GetJsonAsync($"api/v2/home?tzOffsetMinutes={tz}") is not JsonObject h) return;
            App.Shared.Db.PutKv(CacheKey, h.ToJsonString());
            Draw(h);
        }
        catch (Exception) { /* offline: the cached page stands */ }
    }

    private void Draw(JsonObject h)
    {
        var images = h["images"] as JsonObject;
        if (h["wave"]?["phrase"]?.GetValue<string>() is { Length: > 0 } wave) phrase.Text = wave;
        if (h["pulse"] is JsonObject pl && pl["playedMs"]?.GetValue<long>() is > 0 and var ms)
        {
            var parts = new List<string> { $"за неделю {Ru.Minutes(ms)}" };
            if (pl["topGenre"]?.GetValue<string>() is { } g) parts.Add(g);
            if (pl["discoveries"]?.GetValue<int>() is > 0 and var d) parts.Add(Ru.Plural(d, "открытие", "открытия", "открытий"));
            pulse.Text = string.Join(" · ", parts);
        }
        DrawAnchors((h["anchors"]?.AsArray() ?? []).OfType<JsonObject>().ToList(), images);
        sections.Children.Clear();
        var vibes = (h["vibes"]?.AsArray() ?? []).OfType<JsonObject>().ToList();
        if (vibes.Count > 0)
        {
            var chips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
            foreach (var v in vibes.Take(8))
            {
                var ids = Ids(v["tracks"]);
                var first = v["tracks"]?[0];
                var name = v["name"]?.GetValue<string>() ?? first?["titleDisplay"]?.GetValue<string>() ?? first?["title"]?.GetValue<string>() ?? "Вайб";
                var (frame, image) = Img.Cover(30, 15);
                image.Source = Img.Source(first?["coverImageId"]?.GetValue<string>(), 64, images);
                var chip = M.Btn(M.H(10, frame, M.T(name, 13.5).Align(HorizontalAlignment.Left, VerticalAlignment.Center)), () => App.Shared.Player.PlayTracks(ids, 0, "vibe"));
                chip.CornerRadius = new CornerRadius(22);
                chip.Padding = new Thickness(6, 6, 16, 6);
                chips.Children.Add(chip);
            }
            sections.Children.Add(Section("Вайбики", Row(chips)));
        }
        AddTracks("Недавно добавленные", h["recentlyAdded"], images, "recent");
        AddTracks("Вы слушали", h["recent"], images, "history");
        var lists = (h["playlists"]?.AsArray() ?? []).OfType<JsonObject>().ToList();
        if (lists.Count > 0)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 20 };
            foreach (var p in lists)
            {
                var tile = new AlbumTile(164, playlist: true);
                tile.Bind(new AlbumRow(p["id"]!.GetValue<string>(), p["name"]!.GetValue<string>(), null, p["coverImageId"]?.GetValue<string>(),
                    Ru.Tracks(p["itemCount"]?.GetValue<long>() ?? 0), 0, 0));
                row.Children.Add(tile);
            }
            sections.Children.Add(Section("Плейлисты", Row(row)));
        }
    }

    /// <summary>v1's «якоря вкуса»: the strongest records, overlapped; a tap opens the artist.</summary>
    private void DrawAnchors(List<JsonObject> list, JsonObject? images)
    {
        anchors.Children.Clear();
        if (list.Count == 0) return;
        anchors.Children.Add(M.Eyebrow("Якоря вкуса").Align(HorizontalAlignment.Left, VerticalAlignment.Center));
        var stack = new StackPanel { Orientation = Orientation.Horizontal };
        for (var i = 0; i < list.Count; i++)
        {
            var t = list[i];
            var (frame, image) = Img.Cover(40, 10);
            image.Source = Img.Source(t["coverImageId"]?.GetValue<string>(), 96, images);
            frame.BorderBrush = Theme.B("MxBg");
            frame.BorderThickness = new Thickness(2);
            frame.Margin = new Thickness(i == 0 ? 0 : -11, 0, 0, 0);
            Canvas.SetZIndex(frame, 10 - i);
            ToolTipService.SetToolTip(frame, $"{t["titleDisplay"]?.GetValue<string>() ?? t["title"]?.GetValue<string>()} — {t["artistDisplay"]?.GetValue<string>()}");
            if (t["artists"]?[0] is JsonObject a && a["id"]?.GetValue<string>() is { } aid)
            {
                var name = a["name"]?.GetValue<string>() ?? "";
                frame.Tapped += (_, _) => App.Shared.Window.Go(() => new ArtistView(aid, name));
            }
            Img.Lift(frame, 1.08f);
            stack.Children.Add(frame);
        }
        anchors.Children.Add(stack);
    }

    private void AddTracks(string title, JsonNode? tracks, JsonObject? images, string context)
    {
        var list = (tracks?.AsArray() ?? []).OfType<JsonObject>().ToList();
        if (list.Count == 0) return;
        var ids = Ids(tracks);
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 20 };
        for (var i = 0; i < list.Count; i++)
        {
            var t = list[i];
            var at = i;
            var (frame, image) = Img.Cover(164, 14);
            image.Source = Img.Source(t["coverImageId"]?.GetValue<string>(), 256, images);
            var tile = M.V(8, frame, M.V(2,
                M.T(t["titleDisplay"]?.GetValue<string>() ?? t["title"]!.GetValue<string>(), 14, weight: FontWeights.SemiBold),
                M.T(t["artistDisplay"]?.GetValue<string>() ?? "", 12.5, Theme.B("MxTextMuted"))));
            tile.Width = 164;
            Img.Lift(tile);
            tile.Tapped += (_, _) => App.Shared.Player.PlayTracks(ids, at, context);
            row.Children.Add(tile);
        }
        sections.Children.Add(Section(title, Row(row)));
    }

    private static List<string> Ids(JsonNode? tracks) =>
        (tracks?.AsArray() ?? []).Select(t => t?["id"]?.GetValue<string>()).OfType<string>().ToList();

    private static ScrollViewer Row(UIElement content) => new()
    {
        Content = content, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
        HorizontalScrollMode = ScrollMode.Enabled, VerticalScrollMode = ScrollMode.Disabled, Padding = new Thickness(0, 0, 0, 12),
    };

    private static StackPanel Section(string title, UIElement content) => M.V(14, M.T(title, 22, font: Theme.Display), content);
}
