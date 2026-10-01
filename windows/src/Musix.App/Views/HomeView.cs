using System.Globalization;
using System.Numerics;
using System.Text.Json.Nodes;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Shapes;
using Musix.App.Ui;
using Musix.Core.Playback;
using Windows.Foundation;
using Windows.UI;

namespace Musix.App.Views;

/// <summary>
/// v1's desktop landing (golden home-desktop, web/src/routes/_app/index.tsx).
/// - An aurora in the taste palette drifts behind everything.
/// - At the left: the vibe line, the «Поток» orb with «Настроить волну», the taste
///   anchors and the вайбики.
/// - At the right: the lyrics search and the library card.
/// - Along the bottom: the discoveries and the week's pulse.
/// The last `/home` answer is kept in the store, so the page draws at once (offline too)
/// and the network refreshes it behind.
/// </summary>
public sealed class HomeView : UserControl, IRefreshable
{
    private const string CacheKey = "home.json";
    private static readonly string[] Brand = ["#7C5BFF", "#FF78C8", "#E0B341", "#B06BFF"];
    private static readonly SolidColorBrush Clear = new(Color.FromArgb(0, 0, 0, 0));
    private readonly Grid aurora = new() { IsHitTestVisible = false };
    private readonly List<(Ellipse Blob, GradientStop Ink, double W, double H)> blobs = [];
    private readonly Orb orb;
    private readonly TextBlock vibe = new() { FontFamily = Theme.Display, FontSize = 34, LineHeight = 41, TextWrapping = TextWrapping.WrapWholeWords, MaxWidth = 640, HorizontalAlignment = HorizontalAlignment.Left };
    private readonly TextBlock orbTitle = M.T("ВКЛЮЧИТЬ ПОТОК", 13, weight: FontWeights.SemiBold, spacing: 0.22);
    private readonly TextBlock orbSub = M.T("Волна под ваш вкус — подстраивается под реакции", 13, Theme.B("MxTextMuted"));
    private readonly StackPanel anchors = M.H(13);
    private readonly StackPanel vibes = M.V(10);
    private readonly TextBlock libraryCounts = M.T("", 10.5, Theme.B("MxTextSubtle"), spacing: 0.16, wrap: true);
    private readonly Grid libraryStack = new() { Width = 140, Height = 64 };
    private readonly Grid discoveries = new() { ColumnSpacing = 28 };
    private readonly StackPanel pulse = M.V(8);
    private bool starting;

    public HomeView()
    {
        orb = new Orb(110, () => _ = StartStream());
        var root = new Grid();
        root.Children.Add(Aurora());

        var page = new Grid { Padding = new Thickness(24, 22, 48, 40), RowSpacing = 36 };
        page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        page.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var grid = new Grid { ColumnSpacing = 72, Padding = new Thickness(52, 0, 0, 0) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.25, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(0.75, GridUnitType.Star), MinWidth = 320 });
        var paths = Paths();
        Grid.SetColumn(paths, 1);
        grid.Children.Add(Hero());
        grid.Children.Add(paths);
        var bottom = new Grid { ColumnSpacing = 40, Padding = new Thickness(52, 0, 0, 0), VerticalAlignment = VerticalAlignment.Bottom };
        bottom.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        bottom.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(240) });
        Grid.SetColumn(pulse, 1);
        pulse.HorizontalAlignment = HorizontalAlignment.Right;
        pulse.VerticalAlignment = VerticalAlignment.Bottom;
        bottom.Children.Add(discoveries);
        bottom.Children.Add(pulse);
        Grid.SetRow(bottom, 2);
        page.Children.Add(Wordmark());
        Grid.SetRow(grid, 1);
        page.Children.Add(grid);
        page.Children.Add(bottom);
        var scroll = new ScrollViewer { Content = page };
        scroll.SizeChanged += (_, _) => page.MinHeight = scroll.ActualHeight;  // the bottom row sits at the foot of the window
        root.Children.Add(scroll);
        Content = root;

        SizeChanged += (_, _) => PlaceBlobs();
        Loaded += (_, _) => App.Shared.Player.Changed += SyncOrb;
        Unloaded += (_, _) => App.Shared.Player.Changed -= SyncOrb;
        SyncOrb();
        vibe.Text = "Волна под твой вкус — из того, что ты слушаешь";
        if (App.Shared.Db.Kv(CacheKey) is { } cached && JsonNode.Parse(cached) is JsonObject h) Draw(h);
        _ = Load();
        _ = LoadDiscoveries();
    }

    public void Refresh() => _ = Load();

    // ── the aurora ─────────────────────────────────────────────────────────────

    /// <summary>
    /// v1's aurora: four big soft blobs drifting 4vw/3vh and growing 8% over ~38 s, back and
    /// forth, out of phase. A radial fade stands in for the CSS blur(90px).
    /// </summary>
    private Grid Aurora()
    {
        var bg = new RadialGradientBrush { Center = new Point(0.5, 0), GradientOrigin = new Point(0.5, 0), RadiusX = 1.2, RadiusY = 0.9 };
        foreach (var (o, c) in Theme.Dark ? new[] { (0.0, "#15151b"), (0.6, "#0a0a0e"), (1.0, "#07070a") } : [(0.0, "#fafaff"), (0.6, "#ececf3"), (1.0, "#e3e2e8")])
            bg.GradientStops.Add(new GradientStop { Offset = o, Color = Theme.Parse(c)!.Value });
        aurora.Background = bg;
        var specs = new (double W, double H, int Ms)[] { (52, 40, 38_000), (44, 36, 33_000), (40, 30, 41_000), (36, 26, 36_000) };
        for (var i = 0; i < specs.Length; i++)
        {
            var ink = new GradientStop { Offset = 0, Color = Theme.Parse(Brand[i])!.Value };
            var fill = new RadialGradientBrush();
            fill.GradientStops.Add(ink);
            fill.GradientStops.Add(new GradientStop { Offset = 1, Color = Color.FromArgb(0, ink.Color.R, ink.Color.G, ink.Color.B) });
            var drift = new CompositeTransform();
            var blob = new Ellipse
            {
                Fill = fill, Opacity = (Theme.Dark ? 0.34 : 0.24) * (i == 3 ? 0.53 : 1) * 1.6, RenderTransform = drift,
                HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top,
            };
            blobs.Add((blob, ink, specs[i].W, specs[i].H));
            aurora.Children.Add(blob);
            var sb = new Storyboard();
            foreach (var (prop, to) in new[] { ("TranslateX", 1.0), ("TranslateY", 1.0), ("ScaleX", 1.08), ("ScaleY", 1.08) })
            {
                var a = new DoubleAnimation
                {
                    To = prop.StartsWith("Scale") ? to : 0, Duration = TimeSpan.FromMilliseconds(specs[i].Ms), AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever, EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }, EnableDependentAnimation = true,
                };
                Storyboard.SetTarget(a, drift);
                Storyboard.SetTargetProperty(a, prop);
                sb.Children.Add(a);
            }
            blob.Tag = sb;
        }
        Loaded += (_, _) => { if (new Windows.UI.ViewManagement.UISettings().AnimationsEnabled) foreach (var b in blobs) ((Storyboard)b.Blob.Tag).Begin(); };
        Unloaded += (_, _) => { foreach (var b in blobs) ((Storyboard)b.Blob.Tag).Stop(); };
        return aurora;
    }

    /// <summary>The blobs in vmax units, where v1 put them (top-left, top-middle, right, bottom).</summary>
    private void PlaceBlobs()
    {
        double w = ActualWidth, h = ActualHeight, vmax = Math.Max(w, h) / 100;
        if (w <= 0) return;
        aurora.Clip = new RectangleGeometry { Rect = new Rect(0, 0, w, h) };  // the blobs overhang the page; never over the rail
        vibe.FontSize = Math.Clamp(w * 0.026, 26, 38);  // v1's clamp(26px, 2.6vw, 38px)
        vibe.LineHeight = vibe.FontSize * 1.2;
        var at = new (double X, double Y)[] { (-8 * vmax, -18 * vmax), (0.34 * w, -12 * vmax), (w + 12 * vmax - 40 * vmax, 6 * vmax), (0.2 * w, h + 16 * vmax - 26 * vmax) };
        for (var i = 0; i < blobs.Count; i++)
        {
            var (blob, _, bw, bh) = blobs[i];
            blob.Width = bw * vmax * 1.5;  // the fade eats a third of the radius the blur would have kept
            blob.Height = bh * vmax * 1.5;
            blob.Margin = new Thickness(at[i].X - bw * vmax * 0.25, at[i].Y - bh * vmax * 0.25, 0, 0);
            var drift = (CompositeTransform)blob.RenderTransform;
            drift.CenterX = blob.Width / 2;
            drift.CenterY = blob.Height / 2;
            var sb = (Storyboard)blob.Tag;
            ((DoubleAnimation)sb.Children[0]).To = w * 0.04;
            ((DoubleAnimation)sb.Children[1]).To = h * 0.03;
        }
    }

    /// <summary>The blobs take the вайбики's cover colours (muted, like v1's `dusty`), topped up with the brand's.</summary>
    private void TintAurora(IEnumerable<string?> coverIds)
    {
        var colours = coverIds.Select(App.Shared.Palette).OfType<Pal>().SelectMany(p => new[] { p.Vibrant, p.Dominant }).Select(Dusty).ToList();
        if (colours.Count < 2) return;
        colours.AddRange(Brand.Select(b => Theme.Parse(b)!.Value));
        for (var i = 0; i < blobs.Count; i++)
        {
            var c = colours[i];
            blobs[i].Ink.Color = c;
            ((RadialGradientBrush)blobs[i].Blob.Fill).GradientStops[1].Color = Color.FromArgb(0, c.R, c.G, c.B);
        }
    }

    /// <summary>v1 `dusty`: the hue kept, saturation clamped to 36–60%, lightness 58%.</summary>
    private static Color Dusty(Color c)
    {
        double r = c.R / 255.0, g = c.G / 255.0, b = c.B / 255.0, max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b)), d = max - min;
        double h = d == 0 ? 0 : max == r ? (g - b) / d % 6 : max == g ? (b - r) / d + 2 : (r - g) / d + 4;
        double l = (max + min) / 2, s = d == 0 ? 0 : d / (1 - Math.Abs(2 * l - 1));
        return Theme.Parse(FormattableString.Invariant($"hsl({Math.Round(h * 60 + 360) % 360}, {Math.Round(Math.Clamp(s, 0.36, 0.6) * 100)}%, 58%)"))!.Value;
    }

    // ── the sections ───────────────────────────────────────────────────────────

    private static StackPanel Wordmark()
    {
        var (frame, image) = Img.Cover(40, 12);
        image.Source = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri(System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "musix.png")));
        var mark = new TextBlock { FontFamily = Theme.Text, FontSize = 30, FontWeight = FontWeights.Light };
        mark.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = "Musi" });
        mark.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = "X", Foreground = Theme.B("MxAccentLight"), FontStyle = Windows.UI.Text.FontStyle.Italic });
        var w = M.H(14, frame, mark.Align(HorizontalAlignment.Left, VerticalAlignment.Center));
        w.Padding = new Thickness(14, 0, 0, 0);
        return w;
    }

    private StackPanel Hero()
    {
        var eyebrow = M.H(8, EqMark(), M.T("ТВОЙ ВАЙБ", 11, Theme.B("MxAccentLight"), FontWeights.Medium, spacing: 0.22).Align(HorizontalAlignment.Left, VerticalAlignment.Center));
        orbSub.TextWrapping = TextWrapping.WrapWholeWords;
        var tune = new Button
        {
            Content = M.H(6, Untrimmed(M.T("НАСТРОИТЬ ВОЛНУ", 10.5, Theme.B("MxTextMuted"), FontWeights.SemiBold, spacing: 0.16)), new Icon("ChevronDown", 12, Theme.B("MxTextMuted"))),
            CornerRadius = new CornerRadius(999), Padding = new Thickness(14, 7, 14, 7), Margin = new Thickness(0, 6, 0, 0),
            Background = Theme.WithAlphaBrush("MxSurface", 0.6), BorderBrush = Theme.B("MxBorderStrong"), BorderThickness = new Thickness(1),
            Flyout = WaveSettings(),
        };
        var orbText = M.V(6, orbTitle, orbSub, tune);
        orbText.VerticalAlignment = VerticalAlignment.Center;
        var orbRow = M.H(26, orb, orbText);
        var hero = M.V(22, eyebrow, vibe, orbRow, anchors, vibes);
        anchors.Margin = new Thickness(0, 4, 0, 0);
        return hero;
    }

    /// <summary>The «Поток» presets (Что / Звук): the choice is saved on the server, and a playing «Поток» restarts with it.</summary>
    private static Flyout WaveSettings()
    {
        var body = M.V(10);
        var fly = new Flyout { Content = body, Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.BottomEdgeAlignedLeft };
        var sel = (Familiarity: "mix", Sound: (string?)null);
        fly.Opening += async (_, _) =>
        {
            body.Children.Clear();
            body.Children.Add(M.T("Загружаю…", 12.5, Theme.B("MxTextSubtle")));
            try
            {
                var presets = (await App.Shared.Api.GetJsonAsync("api/v2/stream/presets"))?.AsArray().OfType<JsonObject>().ToList() ?? [];
                body.Children.Clear();
                foreach (var (row, label) in new[] { ("familiarity", "Что"), ("sound", "Звук") })
                {
                    var line = M.H(6, M.T(label, 11, Theme.B("MxTextSubtle")).Align(HorizontalAlignment.Left, VerticalAlignment.Center));
                    ((FrameworkElement)line.Children[0]).Width = 42;
                    foreach (var p in presets.Where(p => p["row"]?.GetValue<string>() == row))
                    {
                        var pid = p["id"]!.GetValue<string>();
                        var on = row == "sound" ? sel.Sound == pid : sel.Familiarity == pid;
                        var b = new Button
                        {
                            Content = M.T(p["labelRu"]?.GetValue<string>() ?? pid, 12.5, on ? Theme.B("MxAccentLight") : Theme.B("MxTextMuted")),
                            CornerRadius = new CornerRadius(999), Padding = new Thickness(12, 6, 12, 6), BorderThickness = new Thickness(1),
                            BorderBrush = on ? new SolidColorBrush(Theme.WithAlpha(Theme.C("MxAccent"), 0.45)) : Theme.B("MxBorderStrong"),
                            Background = on ? Theme.B("MxAccentBg") : Clear,
                        };
                        b.Click += async (_, _) =>
                        {
                            sel = row == "sound" ? (sel.Familiarity, sel.Sound == pid ? null : pid) : (pid, sel.Sound);
                            fly.Hide();
                            try
                            {
                                await App.Shared.Api.SendJsonAsync(HttpMethod.Put, "api/v2/stream/settings", new { familiarity = sel.Familiarity, sound = sel.Sound });
                                if (App.Shared.Player.Mode == QueueMode.Stream && App.Shared.Player.Current is not null) await App.Shared.Player.StartStreamAsync();
                            }
                            catch (Exception) { /* offline: the old settings stay */ }
                        };
                        line.Children.Add(b);
                    }
                    body.Children.Add(line);
                }
            }
            catch (Exception) { body.Children.Clear(); body.Children.Add(M.T("Сервер недоступен", 12.5, Theme.B("MxTextSubtle"))); }
        };
        return fly;
    }

    private StackPanel Paths()
    {
        var box = new TextBox { PlaceholderText = "строчка из песни…", BorderThickness = new Thickness(0), Background = Clear, VerticalAlignment = VerticalAlignment.Center, FontSize = 14 };
        box.KeyDown += (_, e) =>
        {
            if (e.Key != Windows.System.VirtualKey.Enter || box.Text.Trim().Length == 0) return;
            var q = box.Text.Trim();
            App.Shared.Window.Go(() => new SearchView(q), root: true);
        };
        var ai = new Border
        {
            CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 3, 8, 3), BorderThickness = new Thickness(1),
            BorderBrush = new SolidColorBrush(Theme.WithAlpha(Theme.C("MxAccent"), 0.45)), Child = M.T("ИИ", 10, Theme.B("MxAccentLight"), FontWeights.SemiBold, spacing: 0.1),
            VerticalAlignment = VerticalAlignment.Center,
        };
        var search = new Grid { Height = 50, ColumnSpacing = 10, Padding = new Thickness(14, 0, 14, 0) };
        search.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        search.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        search.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var glass = Glass(search, 16);
        Grid.SetColumn(box, 1);
        Grid.SetColumn(ai, 2);
        search.Children.Add(new FontIcon { Glyph = "", FontSize = 15, Foreground = Theme.B("MxTextSubtle") });
        search.Children.Add(box);
        search.Children.Add(ai);
        var lyrics = M.V(0,
            M.T("✦  ПОИСК ПО ТЕКСТУ", 11, Theme.B("MxAccentLight"), FontWeights.Medium, spacing: 0.22),
            M.T("Помнишь строчку, а не название? ИИ найдёт песню по словам", 12.5, Theme.B("MxTextMuted"), wrap: true).Margin(0, 6, 0, 12),
            glass);

        var card = new Grid { Height = 86, Padding = new Thickness(18, 0, 18, 0) };
        card.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        card.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var title = M.V(4, M.T("Библиотека  →", 17, weight: FontWeights.SemiBold), libraryCounts);
        title.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(libraryStack, 1);
        libraryStack.VerticalAlignment = VerticalAlignment.Center;
        card.Children.Add(title);
        card.Children.Add(libraryStack);
        var cardGlass = Glass(card, 16);
        cardGlass.TranslationTransition = new Vector3Transition { Duration = TimeSpan.FromMilliseconds(200) };
        cardGlass.PointerEntered += (_, _) => cardGlass.Translation = new Vector3(0, -2, 0);
        cardGlass.PointerExited += (_, _) => cardGlass.Translation = Vector3.Zero;
        cardGlass.Tapped += (_, _) => App.Shared.Window.Go(() => new LibraryView(), root: true);
        var dot = M.H(8, new Ellipse { Width = 6, Height = 6, Fill = Theme.B("MxAccentLight"), VerticalAlignment = VerticalAlignment.Center },
            M.T("ФОНОТЕКА", 11, Theme.B("MxTextSubtle"), FontWeights.Medium, spacing: 0.22));
        var library = M.V(12, dot, cardGlass);
        var paths = M.V(34, lyrics, library);
        paths.Padding = new Thickness(0, 44, 0, 0);
        return paths;
    }

    /// <summary>v1's glass: a translucent surface with a hairline.</summary>
    private static Border Glass(UIElement child, double radius) => new()
    {
        Child = child, CornerRadius = new CornerRadius(radius), Background = Theme.WithAlphaBrush("MxSurface", 0.55),
        BorderBrush = Theme.B("MxBorder"), BorderThickness = new Thickness(1),
    };

    /// <summary>
    /// Spaced caps lose their tail to the ellipsis: Geist has no Cyrillic, the fallback font is
    /// wider than the measure, and the label was cut at «ВОЛН» (smoke screenshot, 2026-10-01).
    /// </summary>
    private static TextBlock Untrimmed(TextBlock t) { t.TextTrimming = TextTrimming.None; return t; }

    private static StackPanel EqMark()
    {
        var bars = M.H(2);
        bars.VerticalAlignment = VerticalAlignment.Center;
        foreach (var h in new[] { 7.0, 12, 9, 13, 8 })
            bars.Children.Add(new Rectangle { Width = 2.5, Height = h, RadiusX = 1, RadiusY = 1, Fill = Theme.B("MxAccentLight"), VerticalAlignment = VerticalAlignment.Bottom });
        bars.Height = 13;
        return bars;
    }

    private void SyncOrb()
    {
        var p = App.Shared.Player;
        var streaming = p.Mode == QueueMode.Stream && p.Current is not null;
        orb.SetPlaying(streaming && p.IsPlaying);
        orbTitle.Text = streaming ? "ВОЛНА ИГРАЕТ" : "ВКЛЮЧИТЬ ПОТОК";
        orbSub.Text = streaming ? "Нажмите, чтобы поставить волну на паузу" : "Волна под ваш вкус — подстраивается под реакции";
    }

    private async Task StartStream()
    {
        var p = App.Shared.Player;
        if (p.Mode == QueueMode.Stream && p.Current is not null) { p.Toggle(); return; }
        if (starting) return;
        starting = true;
        try { await p.StartStreamAsync(); }
        catch (Exception) { orbSub.Text = "Поток недоступен без сервера — включи что-нибудь из библиотеки"; }
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
        if (h["wave"]?["phrase"]?.GetValue<string>() is { Length: > 0 } wave) vibe.Text = wave;
        var albums = h["counts"]?["albums"] is JsonValue av && av.TryGetValue<long>(out var a) ? a : 0;
        var tracks = h["counts"]?["tracks"] is JsonValue tv && tv.TryGetValue<long>(out var t) ? t : 0;
        libraryCounts.Text = $"{albums.ToString("N0", CultureInfo.InvariantCulture)} АЛЬБОМОВ · {tracks.ToString("N0", CultureInfo.InvariantCulture)} ТРЕКОВ";
        DrawStack((h["recentlyAdded"]?.AsArray() ?? []).OfType<JsonObject>().Take(3).Select(x => x["coverImageId"]?.GetValue<string>()).ToList(), images);
        DrawAnchors((h["anchors"]?.AsArray() ?? []).OfType<JsonObject>().ToList(), images);
        var vibeList = (h["vibes"]?.AsArray() ?? []).OfType<JsonObject>().ToList();
        DrawVibes(vibeList, images);
        TintAurora(vibeList.Select(v => v["tracks"]?[0]?["coverImageId"]?.GetValue<string>()));
        if (h["pulse"] is JsonObject p) DrawPulse(p);
    }

    /// <summary>The library card's three newest covers, fanned (−8°, −2°, 6°).</summary>
    private void DrawStack(List<string?> covers, JsonObject? images)
    {
        libraryStack.Children.Clear();
        var turns = new[] { (-8.0, 70.0), (-2.0, 36.0), (6.0, 0.0) };
        for (var i = 0; i < covers.Count && i < 3; i++)
        {
            var (frame, image) = Img.Cover(64, 8);
            image.Source = Img.Source(covers[i], 128, images);
            frame.HorizontalAlignment = HorizontalAlignment.Right;
            frame.Margin = new Thickness(0, 0, turns[i].Item2, 0);
            frame.RenderTransform = new RotateTransform { Angle = turns[i].Item1, CenterX = 32, CenterY = 32 };
            libraryStack.Children.Add(frame);
        }
    }

    /// <summary>v1's «якоря вкуса»: the strongest records, overlapped; one rises on hover, a tap opens the artist.</summary>
    private void DrawAnchors(List<JsonObject> list, JsonObject? images)
    {
        anchors.Children.Clear();
        if (list.Count == 0) return;
        anchors.Children.Add(M.T("ЯКОРЯ ВКУСА", 10.5, Theme.B("MxTextSubtle"), FontWeights.SemiBold, spacing: 0.2).Align(HorizontalAlignment.Left, VerticalAlignment.Center));
        var stack = M.H(0);
        for (var i = 0; i < list.Count; i++)
        {
            var t = list[i];
            var (frame, image) = Img.Cover(40, 10);
            image.Source = Img.Source(t["coverImageId"]?.GetValue<string>(), 96, images);
            frame.BorderBrush = Theme.B("MxBg");
            frame.BorderThickness = new Thickness(2);
            frame.Margin = new Thickness(i == 0 ? 0 : -11, 0, 0, 0);
            var z = 10 - i;
            Canvas.SetZIndex(frame, z);
            frame.TranslationTransition = new Vector3Transition { Duration = TimeSpan.FromMilliseconds(250) };
            frame.PointerEntered += (_, _) => { frame.Translation = new Vector3(0, -4, 0); Canvas.SetZIndex(frame, 20); };
            frame.PointerExited += (_, _) => { frame.Translation = Vector3.Zero; Canvas.SetZIndex(frame, z); };
            ToolTipService.SetToolTip(frame, $"{t["titleDisplay"]?.GetValue<string>() ?? t["title"]?.GetValue<string>()} — {t["artistDisplay"]?.GetValue<string>()}");
            if (t["artists"]?[0] is JsonObject a && a["id"]?.GetValue<string>() is { } aid)
            {
                var name = a["name"]?.GetValue<string>() ?? "";
                frame.Tapped += (_, _) => App.Shared.Window.Go(() => new ArtistView(aid, name));
            }
            stack.Children.Add(frame);
        }
        anchors.Children.Add(stack);
    }

    private void DrawVibes(List<JsonObject> list, JsonObject? images)
    {
        vibes.Children.Clear();
        if (list.Count == 0) return;
        var caption = new TextBlock { FontSize = 10.5, Foreground = Theme.B("MxTextSubtle") };
        caption.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = "ВАЙБИКИ", FontWeight = FontWeights.SemiBold, CharacterSpacing = 200 });
        caption.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = " · то, что держит тебя сейчас" });
        var chips = new Wrap { Spacing = 10 };
        foreach (var v in list.Take(8))
        {
            var ids = (v["tracks"]?.AsArray() ?? []).Select(x => x?["id"]?.GetValue<string>()).OfType<string>().ToList();
            var first = v["tracks"]?[0];
            var name = v["name"]?.GetValue<string>() ?? first?["genre"]?.GetValue<string>() ?? "Вайб";
            var (frame, image) = Img.Cover(26, 13);
            image.Source = Img.Source(first?["coverImageId"]?.GetValue<string>(), 64, images);
            var chip = new Button
            {
                Content = M.H(10, frame, M.T(name, 13).Align(HorizontalAlignment.Left, VerticalAlignment.Center), new Icon("Play", 10, Theme.B("MxTextSubtle")).Align(HorizontalAlignment.Left, VerticalAlignment.Center)),
                CornerRadius = new CornerRadius(999), Padding = new Thickness(5, 5, 14, 5),
                Background = Theme.WithAlphaBrush("MxSurface", 0.6), BorderBrush = Theme.B("MxBorderStrong"), BorderThickness = new Thickness(1),
            };
            chip.Click += (_, _) => App.Shared.Player.PlayTracks(ids, 0, "vibe");
            chips.Children.Add(chip);
        }
        vibes.Children.Add(caption);
        vibes.Children.Add(chips);
    }

    private static readonly string[] Days = ["п", "в", "с", "ч", "п", "с", "в"];

    /// <summary>The week's pulse: the hours, a bar per day, the top genre and the first listens.</summary>
    private void DrawPulse(JsonObject p)
    {
        pulse.Children.Clear();
        var ms = p["playedMs"] is JsonValue v && v.TryGetValue<long>(out var x) ? x : 0;
        var daily = (p["dailyMs"]?.AsArray() ?? []).Select(d => d is JsonValue dv && dv.TryGetValue<double>(out var y) ? y : 0).ToList();
        var max = Math.Max(1, daily.DefaultIfEmpty(0).Max());
        pulse.Children.Add(M.T("ЗА ЭТУ НЕДЕЛЮ", 10, Theme.B("MxTextSubtle"), spacing: 0.2).Align(HorizontalAlignment.Right));
        pulse.Children.Add(M.T(ms >= 3_600_000 ? $"{ms / 3_600_000}ч {ms / 60_000 % 60}м" : $"{ms / 60_000}м", 26, new SolidColorBrush(Theme.Oklch(0.72, 0.14, 320)), FontWeights.Medium).Align(HorizontalAlignment.Right));
        var bars = M.H(10);
        bars.Height = 56;
        bars.HorizontalAlignment = HorizontalAlignment.Right;
        var ink = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(0, 1) };
        ink.GradientStops.Add(new GradientStop { Offset = 0, Color = Theme.Oklch(0.80, 0.10, 300) });
        ink.GradientStops.Add(new GradientStop { Offset = 1, Color = Theme.Oklch(0.60, 0.15, 290) });
        for (var i = 0; i < 7; i++)
        {
            var h = Math.Max(3, (i < daily.Count ? daily[i] / max : 0) * 38);
            var col = M.V(4, new Rectangle { Width = 10, Height = h, RadiusX = 4, RadiusY = 4, Fill = ink, HorizontalAlignment = HorizontalAlignment.Center },
                M.T(Days[i], 10, Theme.B("MxTextSubtle")).Align(HorizontalAlignment.Center));
            col.VerticalAlignment = VerticalAlignment.Bottom;
            bars.Children.Add(col);
        }
        pulse.Children.Add(bars);
        var meta = M.H(12);
        meta.HorizontalAlignment = HorizontalAlignment.Right;
        if (p["topGenre"]?.GetValue<string>() is { } g) meta.Children.Add(Dot(Theme.Oklch(0.70, 0.16, 280), g));
        var first = p["discoveries"] is JsonValue fv && fv.TryGetValue<int>(out var n) ? n : 0;
        meta.Children.Add(Dot(Theme.Oklch(0.72, 0.16, 340), $"{first} треков впервые"));
        pulse.Children.Add(meta);
    }

    private static StackPanel Dot(Color c, string text) =>
        M.H(5, new Ellipse { Width = 6, Height = 6, Fill = new SolidColorBrush(c), VerticalAlignment = VerticalAlignment.Center }, M.T(text, 11, Theme.B("MxTextSubtle")));

    /// <summary>Three discovery cards from the assistant: a track, its headline, and the fact that makes it a find.</summary>
    private async Task LoadDiscoveries()
    {
        try
        {
            if (await App.Shared.Api.GetJsonAsync("api/v2/assistant/discoveries?limit=6") is not JsonObject d) return;
            var images = d["images"] as JsonObject;
            var cards = (d["cards"]?.AsArray() ?? []).OfType<JsonObject>().Take(3).ToList();
            discoveries.Children.Clear();
            discoveries.ColumnDefinitions.Clear();
            for (var i = 0; i < cards.Count; i++)
            {
                discoveries.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                var c = cards[i];
                var tid = c["track_id"]?.GetValue<string>() ?? c["items"]?[0]?["track_id"]?.GetValue<string>();
                var t = tid is null ? null : d["tracks"]?[tid];
                var (frame, image) = Img.Cover(40, 6);
                image.Source = Img.Source(t?["coverImageId"]?.GetValue<string>(), 96, images);
                var head = M.V(2, M.T(c["headline"]?.GetValue<string>() ?? "", 13.5, weight: FontWeights.SemiBold),
                    M.T((c["subline"]?.GetValue<string>() ?? "").ToUpperInvariant(), 10.5, Theme.B("MxTextSubtle"), spacing: 0.12));
                head.VerticalAlignment = VerticalAlignment.Center;
                var text = M.T(c["fact"]?.GetValue<string>() ?? c["badge"]?.GetValue<string>() ?? "", 13, Theme.B("MxTextMuted"), wrap: true);
                text.MaxLines = 3;
                text.LineHeight = 19.5;
                text.TextTrimming = TextTrimming.WordEllipsis;
                var card = new Border { Padding = new Thickness(10), Margin = new Thickness(-10), CornerRadius = new CornerRadius(14), Background = Clear, Child = M.V(14, M.H(12, frame, head), text) };
                card.PointerEntered += (_, _) => card.Background = new SolidColorBrush(Theme.WithAlpha(Theme.C("MxText"), 0.04));
                card.PointerExited += (_, _) => card.Background = Clear;
                if (tid is not null) card.Tapped += (_, _) => App.Shared.Player.PlayTracks([tid], 0, "queue");
                Grid.SetColumn(card, i);
                discoveries.Children.Add(card);
            }
        }
        catch (Exception) { /* offline: no discoveries */ }
    }
}
