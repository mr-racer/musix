using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Musix.App.Ui;

namespace Musix.App.Views;

/// <summary>
/// The full player, with v1's UX kept exactly (owner's decision):
/// - the cover flips, and the lyrics are on its back face (synced lines light up);
/// - «Песня | Артист» facts sit at the right;
/// - the queue stays folded under a spoiler.
/// The page follows the current track and reads `/player/context/{id}`.
/// </summary>
public sealed partial class PlayerView : UserControl
{
    private readonly Grid card = new() { Width = 440, Height = 440 };
    private readonly Border front;
    private readonly Image cover;
    private readonly Border back = new() { CornerRadius = new CornerRadius(22), Visibility = Visibility.Collapsed, Padding = new Thickness(30, 26, 30, 26) };
    private readonly StackPanel lyrics = M.V(10);
    private readonly ScrollViewer lyricsScroll = new() { VerticalScrollBarVisibility = ScrollBarVisibility.Hidden };
    private readonly PlaneProjection tilt = new();
    private readonly TextBlock title = M.T("", 28, font: Theme.Display, wrap: true);
    private readonly HyperlinkButton artist = new() { Padding = new Thickness(0) };
    private readonly TextBlock audio = M.T("", 12, Theme.B("MxTextSubtle"), font: Theme.Mono);
    private readonly SelectorBar tabs = new();
    private readonly StackPanel facts = M.V(10);
    private readonly Expander queue = new() { HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly StackPanel queueList = M.V(2);
    private readonly DispatcherTimer tick = new() { Interval = TimeSpan.FromMilliseconds(250) };
    private List<(TimeSpan At, TextBlock Line)> synced = [];
    private JsonObject? context;
    private string? shownId;
    private bool flipped, flipping;
    private static string factTab = "song";
    private (string Id, string Name)? artistTarget;

    public PlayerView()
    {
        (front, cover) = Img.Cover(440, 22);
        back.Background = Theme.B("MxSurface");
        back.BorderBrush = Theme.B("MxBorder");
        back.BorderThickness = new Thickness(1);
        lyricsScroll.Content = lyrics;
        back.Child = lyricsScroll;
        card.Children.Add(front);
        card.Children.Add(back);
        card.Projection = tilt;
        card.Tapped += (_, _) => Flip();
        artist.Click += (_, _) => { if (artistTarget is { } a) App.Shared.Window.Go(() => new ArtistView(a.Id, a.Name)); };
        ToolTipService.SetToolTip(card, "Нажми — текст песни на обороте");
        var react = M.H(6,
            M.Glyph("", () => App.Shared.Player.React("fire"), 44, "Огонёк"),
            M.Glyph("", () => App.Shared.Player.React("water"), 44, "Вода"));
        var left = M.V(14, card, M.V(4, title, artist, audio), react);
        left.Width = 440;

        foreach (var (key, text) in new[] { ("song", "Песня"), ("artist", "Артист") })
            tabs.Items.Add(new SelectorBarItem { Text = text, Tag = key, IsSelected = key == factTab });
        tabs.SelectionChanged += (_, _) => { factTab = (string)tabs.SelectedItem.Tag; DrawFacts(); };
        queue.Content = queueList;
        var right = M.V(16, tabs, facts, queue);
        right.MinWidth = 380;
        right.MaxWidth = 560;

        var grid = new Grid { ColumnSpacing = 48, Padding = new Thickness(48, 40, 48, 40) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(right, 1);
        grid.Children.Add(left);
        grid.Children.Add(right);
        Content = new ScrollViewer { Content = grid };

        tick.Tick += (_, _) => Follow();
        Loaded += (_, _) => { App.Shared.Player.Changed += Sync; tick.Start(); Sync(); };
        Unloaded += (_, _) => { App.Shared.Player.Changed -= Sync; tick.Stop(); };
    }

    private void Sync()
    {
        var p = App.Shared.Player;
        var c = p.Current;
        DrawQueue();
        if (c?.Id == shownId) return;
        shownId = c?.Id;
        title.Text = c?.Title ?? "Ничего не играет";
        artist.Content = M.T(c?.Artist ?? "", 15, Theme.B("MxTextMuted"));
        cover.Source = Img.Source(c?.CoverImageId, 640);
        audio.Text = "";
        context = null;
        artistTarget = null;
        lyrics.Children.Clear();
        synced = [];
        facts.Children.Clear();
        if (c?.ServerTrackId is { } id) _ = Load(id);
        else if (c is not null) facts.Children.Add(M.T("Файл с этого компьютера: факты появятся, когда он будет и на сервере.", 13.5, Theme.B("MxTextMuted"), wrap: true));
    }

    private async Task Load(string id)
    {
        try
        {
            if (await App.Shared.Api.GetJsonAsync($"api/v2/player/context/{id}?lang=ru") is not JsonObject ctx || shownId != App.Shared.Player.Current?.Id) return;
            context = ctx;
            var a = ctx["audio"];
            var bits = new List<string?>
            {
                a?["codec"]?.GetValue<string>()?.ToUpperInvariant(),
                a?["bitDepth"]?.GetValue<int>() is int b ? $"{b} бит" : null,
                a?["sampleRate"]?.GetValue<int>() is int sr ? $"{sr / 1000.0:0.#} кГц" : null,
                ctx["stats"]?["plays"]?.GetValue<int>() is > 0 and var n ? Ru.Plural(n, "прослушивание", "прослушивания", "прослушиваний") : null,
            };
            audio.Text = string.Join(" · ", bits.OfType<string>());
            artistTarget = ctx["track"]?["artists"]?[0] is JsonObject first && first["id"]?.GetValue<string>() is { } aid
                ? (aid, first["name"]?.GetValue<string>() ?? "") : null;
            DrawLyrics(ctx["lyrics"] as JsonObject);
            DrawFacts();
        }
        catch (Exception) { facts.Children.Add(M.T("Сервер недоступен — факты и текст подгрузятся позже.", 13.5, Theme.B("MxTextMuted"), wrap: true)); }
    }

    [GeneratedRegex(@"^\[(\d+):(\d+(?:\.\d+)?)\](.*)$")]
    private static partial Regex Lrc();

    private void DrawLyrics(JsonObject? l)
    {
        lyrics.Children.Clear();
        synced = [];
        if (l is null) { lyrics.Children.Add(M.T("Текста пока нет", 15, Theme.B("MxTextMuted"))); return; }
        if (l["syncedLrc"]?.GetValue<string>() is { Length: > 0 } lrc)
        {
            foreach (var raw in lrc.Split('\n'))
            {
                var m = Lrc().Match(raw.Trim());
                if (!m.Success || m.Groups[3].Value.Trim().Length == 0) continue;
                var line = M.T(m.Groups[3].Value.Trim(), 19, Theme.B("MxTextSubtle"), FontWeights.Medium, wrap: true);
                synced.Add((TimeSpan.FromMinutes(int.Parse(m.Groups[1].Value)) + TimeSpan.FromSeconds(double.Parse(m.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture)), line));
                lyrics.Children.Add(line);
            }
            if (synced.Count > 0) return;
        }
        foreach (var para in (l["text"]?.GetValue<string>() ?? "").Split('\n'))
            lyrics.Children.Add(M.T(para, 16, Theme.B("MxText"), wrap: true));
    }

    /// <summary>Synced lyrics: the current line lights up and scrolls toward the top third.</summary>
    private void Follow()
    {
        if (synced.Count == 0 || !flipped) return;
        var at = App.Shared.Engine.Position;
        var i = synced.FindLastIndex(s => s.At <= at);
        for (var k = 0; k < synced.Count; k++) synced[k].Line.Foreground = k == i ? Theme.B("MxText") : Theme.B("MxTextSubtle");
        if (i < 0) return;
        var y = synced[i].Line.TransformToVisual(lyrics).TransformPoint(new Windows.Foundation.Point(0, 0)).Y;
        lyricsScroll.ChangeView(null, Math.Max(0, y - lyricsScroll.ViewportHeight / 3), null);
    }

    /// <summary>v1's flip: the card turns on its vertical axis, the face swaps at the edge.</summary>
    private void Flip()
    {
        if (flipping) return;
        flipping = true;
        var half = new DoubleAnimation { From = 0, To = 90, Duration = TimeSpan.FromMilliseconds(190), EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn } };
        Storyboard.SetTarget(half, tilt);
        Storyboard.SetTargetProperty(half, "RotationY");
        var first = new Storyboard { Children = { half } };
        first.Completed += (_, _) =>
        {
            flipped = !flipped;
            front.Visibility = flipped ? Visibility.Collapsed : Visibility.Visible;
            back.Visibility = flipped ? Visibility.Visible : Visibility.Collapsed;
            var rest = new DoubleAnimation { From = -90, To = 0, Duration = TimeSpan.FromMilliseconds(260), EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
            Storyboard.SetTarget(rest, tilt);
            Storyboard.SetTargetProperty(rest, "RotationY");
            var second = new Storyboard { Children = { rest } };
            second.Completed += (_, _) => flipping = false;
            second.Begin();
            Follow();
        };
        first.Begin();
    }

    private void DrawFacts()
    {
        facts.Children.Clear();
        var k = context?["knowledge"] as JsonObject;
        var list = (k?[factTab == "song" ? "songFacts" : "artistFacts"]?.AsArray() ?? []).OfType<JsonObject>().ToList();
        if (k?["vibe"]?.GetValue<string>() is { Length: > 0 } vibe && factTab == "song")
            facts.Children.Add(M.T(vibe, 18, Theme.B("MxText"), FontWeights.Light, Theme.SerifItalic, wrap: true).Margin(0, 0, 0, 6));
        foreach (var f in list.Take(8))
            facts.Children.Add(M.Card(M.T(f["text"]!.GetValue<string>(), 14, wrap: true), radius: 14, pad: 14));
        if (factTab == "song")
        {
            foreach (var (key, label) in new[] { ("producers", "Продюсеры"), ("samples", "Семплы"), ("sampledBy", "Его семплировали") })
            {
                var rel = (k?[key]?.AsArray() ?? []).OfType<JsonObject>().Select(r => r["text"]!.GetValue<string>()).ToList();
                if (rel.Count > 0) facts.Children.Add(M.V(4, M.Eyebrow(label), M.T(string.Join(" · ", rel), 13.5, Theme.B("MxTextMuted"), wrap: true)));
            }
        }
        if (facts.Children.Count == 0)
            facts.Children.Add(M.T(context is null ? "Загружаю…" : "Фактов пока нет — ИИ-индексация добавит их позже.", 13.5, Theme.B("MxTextMuted"), wrap: true));
    }

    private void DrawQueue()
    {
        var p = App.Shared.Player;
        var cur = p.Queue.ToList().FindIndex(q => q.Id == p.Current?.Id);
        var next = p.Queue.Skip(cur + 1).Take(30).ToList();
        queue.Header = M.H(10, M.Eyebrow(p.Mode == Musix.Core.Playback.QueueMode.Stream ? "Поток · дальше" : "Очередь"), M.T(Ru.Tracks(next.Count), 12, Theme.B("MxTextSubtle"), font: Theme.Mono));
        queueList.Children.Clear();
        foreach (var q in next)
        {
            var (frame, image) = Img.Cover(36, 6);
            image.Source = Img.Source(q.CoverImageId, 64);
            queueList.Children.Add(M.H(12, frame, M.V(0, M.T(q.Title, 13.5, weight: FontWeights.Medium), M.T(q.Artist, 12, Theme.B("MxTextMuted")))).Margin(0, 3, 0, 3));
        }
    }
}
