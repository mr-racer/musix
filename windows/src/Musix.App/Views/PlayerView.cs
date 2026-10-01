using System.Numerics;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
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
/// The full player: v1's desktop player (golden player-desktop), built from the v2 web
/// player's spec (web/src/routes/_app/player.tsx and its CSS).
/// - Ambient field: the cover's palette in two radial glows that fade between tracks.
/// - Left: the cover stage, the title, the fact line between hairline wings, the wave
///   scrubber, the action row and the Lossless mark.
///   - A tap on the cover pauses (v1); the lyrics are on its back, turned by the ≡ action.
///   - The stage keeps v1's motion: a tilt and a shine under the pointer, a press, a veil
///     while buffering, a play/pause pulse, the flip, and the vinyl-stack change between
///     tracks (the old cover recedes door-style, the new one bounces in; mirrored for «назад»).
/// - Right: «Песня | Артист» facts one at a time with a pager, the credit chips, and the
///   queue (past rows dimmed, the playing one amber with live bars).
/// </summary>
public sealed partial class PlayerView : UserControl
{
    private const double Radius = 20;
    private static readonly SolidColorBrush Clear = new(Color.FromArgb(0, 0, 0, 0));

    // ambient
    private readonly GradientStop glow1 = new() { Offset = 0 }, glow2 = new() { Offset = 0 };

    // the cover stage
    private readonly Grid art = new();
    private readonly Border outHost = new() { CornerRadius = new CornerRadius(Radius), Visibility = Visibility.Collapsed, IsHitTestVisible = false };
    private readonly Image outImage = new() { Stretch = Stretch.UniformToFill };
    private readonly PlaneProjection outProj = new(), inProj = new(), tiltProj = new(), flipProj = new();
    private readonly ScaleTransform outScale = new(), inScale = new(), tiltScale = new();
    private readonly Grid inHost = new(), tiltHost = new(), flipHost = new();
    private readonly Border front = new() { CornerRadius = new CornerRadius(Radius), BorderThickness = new Thickness(1) };
    private readonly Image cover = new() { Stretch = Stretch.UniformToFill };
    private readonly Rectangle dim = new() { Fill = new SolidColorBrush(Color.FromArgb(255, 0, 0, 0)), Opacity = 0, IsHitTestVisible = false };
    private readonly Rectangle shine = new() { Opacity = 0, IsHitTestVisible = false };
    private readonly LinearGradientBrush shineBrush = new();
    private readonly Grid veil = new() { Background = new SolidColorBrush(Color.FromArgb(64, 0, 0, 0)), Opacity = 0, IsHitTestVisible = false };
    private readonly ProgressRing spinner = new() { IsActive = false, Width = 34, Height = 34 };
    private readonly Grid pulse = new() { Opacity = 0, IsHitTestVisible = false };
    private readonly ScaleTransform pulseScale = new();
    private readonly Border back = new() { CornerRadius = new CornerRadius(Radius), Visibility = Visibility.Collapsed, BorderThickness = new Thickness(1) };
    private readonly StackPanel lyrics = M.V(0);
    private readonly TextBlock lyricsHead = M.T("", 9, Theme.Hex(0xFF666666), FontWeights.SemiBold, spacing: 0.18);
    private readonly Border prevFlank, nextFlank;
    private readonly LinearGradientBrush prevWing = new(), nextWing = new();

    // the text under it
    private readonly TextBlock hint = M.T("НАЖМИ НА ОБЛОЖКУ, ЧТОБЫ ПОСТАВИТЬ НА ПАУЗУ", 10.5, Theme.B("MxTextSubtle"), FontWeights.Medium, spacing: 0.2);
    private readonly TextBlock title = M.T("", 26, weight: FontWeights.SemiBold, wrap: true);
    private readonly HyperlinkButton artist = new() { Padding = new Thickness(6, 2, 6, 2), HorizontalAlignment = HorizontalAlignment.Center };
    private readonly TextBlock artistText = M.T("", 16, Theme.B("MxTextMuted"));
    private readonly TextBlock album = M.T("", 12.5, Theme.B("MxTextSubtle"));
    private readonly Grid factLine = new() { ColumnSpacing = 10, MaxWidth = 640, Margin = new Thickness(0, 10, 0, 0), Visibility = Visibility.Collapsed };
    private readonly TextBlock factText = M.T("", 14.5, Theme.Hex(Theme.Dark ? 0xD1D8CCFFu : 0xFF5B3F8Cu), FontWeights.Light, Theme.SerifItalic, wrap: true);
    private readonly TextBlock posText = M.T("", 11.5, Theme.B("MxTextSubtle"), font: Theme.Mono);
    private readonly TextBlock durText = M.T("", 11.5, Theme.B("MxTextSubtle"), font: Theme.Mono);
    private readonly Wave wave = new();
    private readonly Button fire, water, lyricsToggle, shuffle;
    private readonly Icon fireIcon = new("Fire", 20), waterIcon = new("Water", 20), lyricsIcon = new("Lyrics", 20);
    private readonly Slider volume = new() { Width = 90, Minimum = 0, Maximum = 1, StepFrequency = 0.01, VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel lossless = M.H(8);
    private readonly TextBlock losslessInfo = M.T("", 12, Theme.B("MxTextSubtle"), font: Theme.Mono);

    // the right column
    private readonly Button songTab, artistTab;
    private readonly StackPanel facts = M.V(10);
    private readonly Wrap credits = new();
    private readonly TextBlock queueHead = M.T("", 10.5, Theme.B("MxTextSubtle"), FontWeights.Medium, spacing: 0.2);
    private readonly StackPanel rows = M.V(2);
    private readonly ScrollViewer rowsScroll = new() { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(0, 0, 8, 0) };

    private readonly Grid stage = new() { ColumnSpacing = 40, Padding = new Thickness(24, 28, 40, 28) };
    private readonly StackPanel idle = M.V(12);
    private readonly DispatcherTimer tick = new() { Interval = TimeSpan.FromMilliseconds(250) };
    private readonly bool motion = new Windows.UI.ViewManagement.UISettings().AnimationsEnabled;
    private List<(TimeSpan At, Button Line)> synced = [];
    private JsonObject? context;
    private string? shownId;
    private int shownIndex = -1;
    private ImageSource? shownCover;
    private bool flipped, flipping, hovering;
    private static string factSide = "song";
    private int factIndex;
    private (string Id, string Name)? artistTarget;
    private double size = 440;

    public PlayerView()
    {
        (prevFlank, nextFlank) = (Flank("ChevronLeft", prevWing, () => App.Shared.Player.Previous()), Flank("ChevronRight", nextWing, () => App.Shared.Player.Next()));
        fire = Act(fireIcon, () => { App.Shared.Player.React("fire"); Paint(); }, "Огонёк: больше такого");
        water = Act(waterIcon, () => { App.Shared.Player.React("water"); Paint(); }, "Вода: меньше такого");
        lyricsToggle = Act(lyricsIcon, Flip, "Текст песни");
        shuffle = Act(new Icon("Shuffle", 20), () => _ = App.Shared.Player.ShuffleUpcomingAsync(), "Перемешать очередь");
        songTab = Tab("Песня", "song");
        artistTab = Tab("Артист", "artist");

        var page = new Grid();
        page.Children.Add(Ambient());
        stage.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.05, GridUnitType.Star) });
        stage.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(0.95, GridUnitType.Star), MinWidth = 360 });
        var left = new ScrollViewer { Content = Left(), VerticalScrollBarVisibility = ScrollBarVisibility.Hidden };
        var right = Right();
        Grid.SetColumn(right, 1);
        stage.Children.Add(left);
        stage.Children.Add(right);
        page.Children.Add(stage);
        page.Children.Add(Idle());
        Content = page;

        SizeChanged += (_, _) => Resize(left.ActualWidth, ActualHeight);
        left.SizeChanged += (_, _) => Resize(left.ActualWidth, ActualHeight);
        tick.Tick += (_, _) => Tick();
        Loaded += (_, _) => { App.Shared.Player.Changed += Sync; tick.Start(); Sync(); };
        Unloaded += (_, _) => { App.Shared.Player.Changed -= Sync; tick.Stop(); };
    }

    // ── layout ──────────────────────────────────────────────────────────────────

    /// <summary>v1's ambient field: the palette's dominant colour high-left, its accent low-right.</summary>
    private Grid Ambient()
    {
        var g = new Grid { Background = Theme.B("MxBg"), IsHitTestVisible = false };
        foreach (var (stop, center, rx, ry) in new[] { (glow1, new Point(0.28, 0.35), 0.6, 0.55), (glow2, new Point(0.8, 0.8), 0.5, 0.5) })
        {
            var b = new RadialGradientBrush { Center = center, GradientOrigin = center, RadiusX = rx, RadiusY = ry };
            b.GradientStops.Add(stop);
            b.GradientStops.Add(new GradientStop { Offset = 0.7, Color = Color.FromArgb(0, 0, 0, 0) });
            g.Children.Add(new Rectangle { Fill = b });
        }
        SetAmbient(Theme.Parse("#1c1830")!.Value, Theme.Parse("#10101a")!.Value, animate: false);
        return g;
    }

    private StackPanel Idle()
    {
        var head = M.T("Сейчас ничего не играет", 36, font: Theme.SerifItalic, weight: FontWeights.Light);
        var sub = M.T("Включи «Поток» — волну под твой вкус — или выбери альбом в библиотеке.", 14, Theme.B("MxTextMuted"), wrap: true);
        sub.TextAlignment = TextAlignment.Center;
        var actions = M.H(12,
            M.Btn("Включить поток", () => _ = App.Shared.Player.StartStreamAsync(), accent: true),
            M.Btn("В библиотеку", () => App.Shared.Window.Go(() => new LibraryView(), root: true)));
        actions.HorizontalAlignment = HorizontalAlignment.Center;
        actions.Margin = new Thickness(0, 12, 0, 0);
        idle.Children.Add(head.Align(HorizontalAlignment.Center));
        idle.Children.Add(sub);
        idle.Children.Add(actions);
        idle.HorizontalAlignment = HorizontalAlignment.Center;
        idle.VerticalAlignment = VerticalAlignment.Center;
        idle.MaxWidth = 520;
        return idle;
    }

    private StackPanel Left()
    {
        // the stage, back to front: the live cover, then the old one above it during a change
        outHost.Child = outImage;
        outHost.Projection = outProj;
        outHost.RenderTransform = outScale;
        var shadow = new Rectangle { Margin = new Thickness(-36, 26, -36, -54), IsHitTestVisible = false };
        var sb = new RadialGradientBrush { RadiusX = 0.5, RadiusY = 0.5 };
        sb.GradientStops.Add(new GradientStop { Offset = 0.55, Color = Color.FromArgb(140, 0, 0, 0) });
        sb.GradientStops.Add(new GradientStop { Offset = 1, Color = Color.FromArgb(0, 0, 0, 0) });
        shadow.Fill = sb;

        front.BorderBrush = Theme.Hex(0x12FFFFFFu);
        front.Background = Theme.B("MxSurface2");
        shine.Fill = shineBrush;
        spinner.Foreground = Theme.Hex(0xFFFFFFFFu);
        veil.Children.Add(spinner);
        pulse.RenderTransform = pulseScale;
        front.Child = new Grid { Children = { cover, dim, shine, veil, pulse } };
        front.Tapped += (_, _) => TapCover();
        front.PointerPressed += (_, _) => Press(0.975f);
        front.PointerReleased += (_, _) => Press(1);
        front.PointerCaptureLost += (_, _) => Press(1);
        front.ScaleTransition = new Vector3Transition { Duration = TimeSpan.FromMilliseconds(350) };
        front.SizeChanged += (_, _) => front.CenterPoint = new Vector3((float)front.ActualWidth / 2, (float)front.ActualHeight / 2, 0);
        dim.OpacityTransition = new ScalarTransition { Duration = TimeSpan.FromMilliseconds(350) };
        veil.OpacityTransition = new ScalarTransition { Duration = TimeSpan.FromMilliseconds(300) };
        shine.OpacityTransition = new ScalarTransition { Duration = TimeSpan.FromMilliseconds(200) };

        back.Background = Theme.Hex(Theme.Dark ? 0xFF0D0A12u : 0xFFF6F3EAu);
        back.BorderBrush = Theme.Hex(0x12FFFFFFu);
        back.Child = new ScrollViewer
        {
            Content = M.V(0, lyricsHead.Margin(0, 0, 0, 14), lyrics),
            Padding = new Thickness(24, 22, 24, 22), VerticalScrollBarVisibility = ScrollBarVisibility.Hidden,
        };

        flipHost.Children.Add(front);
        flipHost.Children.Add(back);
        flipHost.Projection = flipProj;
        tiltHost.Children.Add(shadow);
        tiltHost.Children.Add(flipHost);
        tiltHost.Projection = tiltProj;
        tiltHost.RenderTransform = tiltScale;
        inHost.Children.Add(tiltHost);
        inHost.Projection = inProj;
        inHost.RenderTransform = inScale;
        art.Children.Add(inHost);
        art.Children.Add(outHost);  // above, as it recedes into the stack
        art.Width = art.Height = size;
        art.PointerMoved += (_, e) => TiltTo(e.GetCurrentPoint(art).Position);
        art.PointerExited += (_, _) => Untilt();

        var coverRow = new Grid { HorizontalAlignment = HorizontalAlignment.Center };
        for (var i = 0; i < 3; i++) coverRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(art, 1);
        Grid.SetColumn(nextFlank, 2);
        coverRow.Children.Add(prevFlank);
        coverRow.Children.Add(art);
        coverRow.Children.Add(nextFlank);

        artist.Content = M.H(4, artistText, new Icon("ChevronDown", 14, Theme.B("MxTextMuted")).Align(HorizontalAlignment.Left, VerticalAlignment.Center));
        artist.Click += (_, _) => { if (artistTarget is { } a) App.Shared.Window.Go(() => new ArtistView(a.Id, a.Name)); };
        title.TextAlignment = TextAlignment.Center;
        title.HorizontalAlignment = HorizontalAlignment.Center;
        album.HorizontalAlignment = HorizontalAlignment.Center;

        // v1 VibeLine: an italic serif line between two hairline wings
        factLine.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(40) });
        factLine.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        factLine.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(40) });
        factText.TextAlignment = TextAlignment.Center;
        factText.MaxWidth = 540;
        Grid.SetColumn(factText, 1);
        factLine.Children.Add(Hairline(false));
        factLine.Children.Add(factText);
        var rightWing = Hairline(true);
        Grid.SetColumn(rightWing, 2);
        factLine.Children.Add(rightWing);
        factLine.HorizontalAlignment = HorizontalAlignment.Center;

        var scrub = new Grid { ColumnSpacing = 12, MaxWidth = 560, Margin = new Thickness(0, 22, 0, 0) };
        scrub.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(48) });
        scrub.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        scrub.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(48) });
        posText.HorizontalAlignment = HorizontalAlignment.Right;
        posText.VerticalAlignment = durText.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(wave, 1);
        Grid.SetColumn(durText, 2);
        scrub.Children.Add(posText);
        scrub.Children.Add(wave);
        scrub.Children.Add(durText);
        wave.Seek = f => App.Shared.Player.Seek(TimeSpan.FromMilliseconds(f * Duration().TotalMilliseconds));

        volume.Value = App.Shared.Engine.Volume;
        volume.ValueChanged += (_, e) => App.Shared.Engine.Volume = e.NewValue;
        var add = Act(new Icon("Plus", 20), () => { }, "В плейлист");
        add.Flyout = AddFlyout();
        var vol = M.H(8, new Icon("Volume", 18).Align(HorizontalAlignment.Left, VerticalAlignment.Center), volume);
        vol.Margin = new Thickness(8, 0, 0, 0);
        var actions = M.H(6, fire, water, add, lyricsToggle, shuffle, PlayerBar.Devices(), vol);
        actions.HorizontalAlignment = HorizontalAlignment.Center;
        actions.Margin = new Thickness(0, 18, 0, 0);

        lossless.Children.Add(Icon.Lossless(14, Theme.B("MxTextMuted")).Align(HorizontalAlignment.Left, VerticalAlignment.Center));
        lossless.Children.Add(M.T("Lossless", 14, Theme.B("MxTextMuted")));
        lossless.Children.Add(losslessInfo.Align(HorizontalAlignment.Left, VerticalAlignment.Center));
        lossless.HorizontalAlignment = HorizontalAlignment.Center;
        lossless.Margin = new Thickness(0, 16, 0, 0);
        lossless.Visibility = Visibility.Collapsed;

        hint.HorizontalAlignment = HorizontalAlignment.Center;
        hint.OpacityTransition = new ScalarTransition { Duration = TimeSpan.FromMilliseconds(300) };
        return M.V(0, hint.Margin(0, 0, 0, 14), coverRow, title.Margin(0, 22, 0, 0), artist.Margin(0, 2, 0, 0), album.Margin(0, 2, 0, 0), factLine, scrub, actions, lossless);
    }

    private Grid Right()
    {
        var tabs = new Border
        {
            Child = M.H(2, songTab, artistTab), Padding = new Thickness(3), CornerRadius = new CornerRadius(999),
            Background = Theme.B("MxSurface"), BorderBrush = Theme.B("MxBorder"), BorderThickness = new Thickness(1),
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        credits.Margin = new Thickness(0, 4, 0, 0);
        var panel = M.V(14, facts, credits);
        rowsScroll.Content = rows;
        var queue = new Grid { RowSpacing = 8, BorderBrush = Theme.B("MxBorder"), BorderThickness = new Thickness(0, 1, 0, 0), Padding = new Thickness(0, 16, 0, 0) };
        queue.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        queue.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(rowsScroll, 1);
        queue.Children.Add(queueHead);
        queue.Children.Add(rowsScroll);

        var g = new Grid { RowSpacing = 18, Padding = new Thickness(0, 30, 0, 0) };
        g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(panel, 1);
        Grid.SetRow(queue, 2);
        g.Children.Add(tabs);
        g.Children.Add(panel);
        g.Children.Add(queue);
        PaintTabs();
        return g;
    }

    /// <summary>The flank beside the cover: a chevron on a soft wing of the palette colour, fading outward.</summary>
    private static Border Flank(string icon, LinearGradientBrush wing, Action click)
    {
        var glyph = new Icon(icon, 22, Theme.B("MxTextMuted"));
        var b = new Border
        {
            Width = 64, Height = 88, CornerRadius = new CornerRadius(14), Background = wing, Margin = new Thickness(6, 0, 6, 0),
            Child = glyph.Align(HorizontalAlignment.Center, VerticalAlignment.Center),
        };
        b.OpacityTransition = new ScalarTransition { Duration = TimeSpan.FromMilliseconds(300) };
        b.PointerEntered += (_, _) => glyph.Brush = Theme.B("MxText");
        b.PointerExited += (_, _) => glyph.Brush = Theme.B("MxTextMuted");
        b.Tapped += (_, e) => { e.Handled = true; click(); };
        return b;
    }

    private static Rectangle Hairline(bool mirrored)
    {
        var g = new LinearGradientBrush { StartPoint = new Point(mirrored ? 1 : 0, 0), EndPoint = new Point(mirrored ? 0 : 1, 0) };
        g.GradientStops.Add(new GradientStop { Offset = 0, Color = Color.FromArgb(0, 216, 204, 255) });
        g.GradientStops.Add(new GradientStop { Offset = 1, Color = Color.FromArgb(115, 216, 204, 255) });
        return new Rectangle { Height = 1, Fill = g, VerticalAlignment = VerticalAlignment.Center };
    }

    private static Button Act(UIElement icon, Action click, string tip)
    {
        var b = new Button
        {
            Content = icon, Width = 42, Height = 42, CornerRadius = new CornerRadius(21), Padding = new Thickness(0),
            Background = Clear, BorderThickness = new Thickness(0),
        };
        ToolTipService.SetToolTip(b, tip);
        b.Click += (_, _) => click();
        return b;
    }

    private Button Tab(string text, string side)
    {
        var b = new Button
        {
            Content = M.T(text.ToUpperInvariant(), 11, weight: FontWeights.SemiBold, spacing: 0.14), CornerRadius = new CornerRadius(999),
            Padding = new Thickness(14, 6, 14, 6), BorderThickness = new Thickness(0),
        };
        b.Click += (_, _) => { factSide = side; factIndex = 0; PaintTabs(); DrawFacts(); };
        return b;
    }

    private void PaintTabs()
    {
        foreach (var (b, side) in new[] { (songTab, "song"), (artistTab, "artist") })
        {
            var on = factSide == side;
            b.Background = on ? Theme.B("MxSurface3") : Clear;
            ((TextBlock)b.Content).Foreground = on ? Theme.B("MxText") : Theme.B("MxTextSubtle");
        }
    }

    private static MenuFlyout AddFlyout()
    {
        var menu = new MenuFlyout();
        menu.Opening += (_, _) =>
        {
            menu.Items.Clear();
            var id = App.Shared.Player.Current?.ServerTrackId;
            if (id is null) { menu.Items.Add(new MenuFlyoutItem { Text = "Файл с этого компьютера — в плейлист после загрузки", IsEnabled = false }); return; }
            var lists = App.Shared.Mirror.Playlists();
            if (lists.Count == 0) menu.Items.Add(new MenuFlyoutItem { Text = "Плейлистов пока нет", IsEnabled = false });
            foreach (var p in lists)
            {
                var item = new MenuFlyoutItem { Text = p.Name };
                item.Click += (_, _) =>
                {
                    var itemId = Guid.NewGuid().ToString();
                    App.Shared.Outbox.Enqueue("playlist.add", itemId, new JsonObject
                    {
                        ["playlistId"] = p.Id, ["items"] = new JsonArray(new JsonObject { ["itemId"] = itemId, ["trackId"] = id }),
                    });
                };
                menu.Items.Add(item);
            }
        };
        return menu;
    }

    /// <summary>v1's `min(440px, 46vh)`, also kept clear of the flanks in a narrow column.</summary>
    private void Resize(double leftWidth, double height)
    {
        if (leftWidth <= 0 || height <= 0) return;
        var s = Math.Clamp(Math.Min(Math.Min(440, height * 0.46), leftWidth - 2 * (64 + 12)), 220, 440);
        if (Math.Abs(s - size) < 0.5) return;
        size = s;
        art.Width = art.Height = s;
        tiltScale.CenterX = tiltScale.CenterY = inScale.CenterX = inScale.CenterY = outScale.CenterX = outScale.CenterY = s / 2;
    }

    // ── state ───────────────────────────────────────────────────────────────────

    private static int? Int(JsonNode? n) => n is JsonValue v && v.TryGetValue<int>(out var i) ? i : null;

    private void Sync()
    {
        var p = App.Shared.Player;
        var c = p.Current;
        stage.Visibility = c is null ? Visibility.Collapsed : Visibility.Visible;
        idle.Visibility = c is null ? Visibility.Visible : Visibility.Collapsed;
        DrawQueue();
        Paint();
        if (c?.Id == shownId) return;
        var index = p.Queue.ToList().FindIndex(q => q.Id == c?.Id);
        var dir = index >= shownIndex ? 1 : -1;
        var had = shownId is not null;
        var oldCover = shownCover;
        shownId = c?.Id;
        shownIndex = index;
        title.Text = c?.Title ?? "";
        artistText.Text = c?.Artist ?? "";
        album.Text = "";
        shownCover = Img.Source(c?.CoverImageId, 640);
        cover.Source = shownCover;
        if (had && c is not null) Swap(oldCover, dir);
        var pal = App.Shared.Palette(c?.CoverImageId);
        SetAmbient(pal?.Dominant ?? Theme.Parse("#1c1830")!.Value, pal?.Accent ?? Theme.Parse("#10101a")!.Value, animate: had);
        context = null;
        artistTarget = null;
        factIndex = 0;
        factLine.Visibility = Visibility.Collapsed;
        lossless.Visibility = Visibility.Collapsed;
        DrawLyrics(null, c?.Title);
        wave.Load(c?.ServerTrackId);
        DrawFacts();
        credits.Children.Clear();
        if (c?.ServerTrackId is { } id) _ = Load(id);
        else if (c is not null) { facts.Children.Clear(); Note(facts, "Файл с этого компьютера: факты появятся, когда он будет и на сервере."); }
    }

    private async Task Load(string id)
    {
        try
        {
            if (await App.Shared.Api.GetJsonAsync($"api/v2/player/context/{id}?lang=ru") is not JsonObject ctx || App.Shared.Player.Current?.ServerTrackId != id) return;
            context = ctx;
            var t = ctx["track"];
            album.Text = string.Join(" · ", new[] { t?["album"]?.GetValue<string>(), Int(t?["year"])?.ToString() }.Where(s => !string.IsNullOrEmpty(s)));
            artistTarget = t?["artists"]?[0] is JsonObject first && first["id"]?.GetValue<string>() is { } aid ? (aid, first["name"]?.GetValue<string>() ?? "") : null;
            var k = ctx["knowledge"] as JsonObject;
            var line = k?["vibe"]?.GetValue<string>() ?? (k?["songFacts"]?.AsArray().FirstOrDefault() as JsonObject)?["text"]?.GetValue<string>();
            if (!string.IsNullOrWhiteSpace(line))
            {
                factText.Text = line.Trim().Trim('"', '\'', '«', '»', '“', '”', '„');
                factLine.Visibility = Visibility.Visible;
            }
            var a = ctx["audio"];
            if (App.Shared.Engine.TierOf(id) is "lossless" or "lossless_compat")
            {
                losslessInfo.Text = string.Join(" · ", new[]
                {
                    a?["codec"]?.GetValue<string>()?.ToUpperInvariant(),
                    Int(a?["sampleRate"]) is int sr ? $"{sr / 1000.0:0.#} кГц" : null,
                    Int(a?["bitDepth"]) is int b ? $"{b} бит" : null,
                }.OfType<string>());
                lossless.Visibility = Visibility.Visible;
            }
            DrawLyrics(ctx["lyrics"] as JsonObject, t?["title"]?.GetValue<string>());
            DrawFacts();
            DrawCredits(k);
        }
        catch (Exception)
        {
            facts.Children.Clear();
            Note(facts, "Сервер недоступен — факты и текст подгрузятся позже.");
        }
    }

    /// <summary>The 250 ms beat: the scrubber, the clocks, the sung line, the paused dim and the veil.</summary>
    private void Tick()
    {
        var e = App.Shared.Engine;
        var dur = Duration();
        posText.Text = Clock(e.Position);
        durText.Text = Clock(dur);
        wave.SetProgress(dur.TotalMilliseconds > 0 ? e.Position.TotalMilliseconds / dur.TotalMilliseconds : 0);
        dim.Opacity = App.Shared.Player.Current is not null && !e.IsPlaying ? 0.16 : 0;
        var buffering = e.IsBuffering;
        veil.Opacity = buffering ? 1 : 0;
        spinner.IsActive = buffering;
        if (flipped) Follow(e.Position);
    }

    private static TimeSpan Duration()
    {
        var d = App.Shared.Engine.Duration;
        return d > TimeSpan.Zero ? d : TimeSpan.FromMilliseconds(App.Shared.Player.Current?.DurationMs ?? 0);
    }

    private static string Clock(TimeSpan t) => t <= TimeSpan.Zero ? "0:00" : $"{(int)t.TotalMinutes}:{t.Seconds:00}";

    /// <summary>The action states: огонёк/вода lit by this track's reaction, ≡ lit while flipped, shuffle off in «Поток».</summary>
    private void Paint()
    {
        var p = App.Shared.Player;
        fireIcon.Brush = p.Reaction == "fire" ? Theme.Hex(0xFFFF7A18u) : Theme.B("MxTextMuted");
        waterIcon.Brush = p.Reaction == "water" ? Theme.Hex(0xFF38BDF8u) : Theme.B("MxTextMuted");
        lyricsIcon.Brush = flipped ? Theme.B("MxAccentLight") : Theme.B("MxTextMuted");
        shuffle.IsEnabled = p.Mode != QueueMode.Stream;
        ToolTipService.SetToolTip(shuffle, p.Mode == QueueMode.Stream ? "В «Потоке» порядок ведёт волна" : "Перемешать очередь");
    }

    private void SetAmbient(Color dominant, Color accent, bool animate)
    {
        var (a1, a2) = Theme.Dark ? (0.38, 0.45) : (0.22, 0.16);
        foreach (var (stop, c) in new[] { (glow1, Theme.WithAlpha(dominant, a1)), (glow2, Theme.WithAlpha(accent, a2)) })
        {
            if (!animate || !motion) { stop.Color = c; continue; }
            var anim = new ColorAnimation { To = c, Duration = TimeSpan.FromMilliseconds(800), EnableDependentAnimation = true };
            Storyboard.SetTarget(anim, stop);
            Storyboard.SetTargetProperty(anim, "Color");
            new Storyboard { Children = { anim } }.Begin();
        }
        foreach (var (wing, mirrored) in new[] { (prevWing, false), (nextWing, true) })
        {
            wing.StartPoint = new Point(mirrored ? 0 : 1, 0.5);
            wing.EndPoint = new Point(mirrored ? 1 : 0, 0.5);
            wing.GradientStops.Clear();
            wing.GradientStops.Add(new GradientStop { Offset = 0, Color = Theme.WithAlpha(dominant, Theme.Dark ? 0.42 : 0.26) });
            wing.GradientStops.Add(new GradientStop { Offset = 1, Color = Theme.WithAlpha(dominant, 0) });
        }
    }

    // ── the cover's motion ──────────────────────────────────────────────────────

    private void TapCover()
    {
        var p = App.Shared.Player;
        if (flipped || p.Current is null) return;
        var wasPlaying = p.IsPlaying;
        p.Toggle();
        pulse.Children.Clear();
        pulse.Children.Add(new Icon(wasPlaying ? "Pause" : "Play", 54, Theme.Hex(0xD9FFFFFFu)).Align(HorizontalAlignment.Center, VerticalAlignment.Center));
        pulseScale.CenterX = pulseScale.CenterY = size / 2;
        // v1 `fb`: by 15% it has faded and grown in, then it fades out growing past 1
        Run(Keys(pulse, "Opacity", (0, 0), (180, 1), (1200, 0)),
            Keys(pulseScale, "ScaleX", (0, 0.8), (180, 1), (1200, 1.1)),
            Keys(pulseScale, "ScaleY", (0, 0.8), (180, 1), (1200, 1.1)));
    }

    private void Press(float to) { if (!flipped) front.Scale = new Vector3(to, to, 1); }

    /// <summary>v1's tilt: the cover leans toward the pointer (±5°), grows 4%, and a shine follows.</summary>
    private void TiltTo(Point at)
    {
        if (flipped || flipping || art.ActualWidth <= 0) return;
        double x = at.Y / art.ActualHeight - 0.5, y = at.X / art.ActualWidth - 0.5;
        tiltProj.RotationY = -y * 10;
        tiltProj.RotationX = -x * 10;
        if (!hovering)
        {
            hovering = true;
            Run(A(tiltScale, "ScaleX", null, 1.04, 250, Out()), A(tiltScale, "ScaleY", null, 1.04, 250, Out()));
        }
        var angle = (135 + y * 20) * Math.PI / 180;
        var (dx, dy) = (Math.Sin(angle) / 2, -Math.Cos(angle) / 2);
        shineBrush.StartPoint = new Point(0.5 - dx, 0.5 - dy);
        shineBrush.EndPoint = new Point(0.5 + dx, 0.5 + dy);
        shineBrush.GradientStops.Clear();
        shineBrush.GradientStops.Add(new GradientStop { Offset = 0.3, Color = Color.FromArgb(0, 255, 255, 255) });
        shineBrush.GradientStops.Add(new GradientStop { Offset = 0.48 + y * 0.08, Color = Color.FromArgb(28, 255, 255, 255) });
        shineBrush.GradientStops.Add(new GradientStop { Offset = 0.65, Color = Color.FromArgb(0, 255, 255, 255) });
        shine.Opacity = 1;
    }

    private void Untilt()
    {
        hovering = false;
        shine.Opacity = 0;
        Press(1);
        Run(A(tiltProj, "RotationX", null, 0, 250, Out()), A(tiltProj, "RotationY", null, 0, 250, Out()),
            A(tiltScale, "ScaleX", null, 1, 250, Out()), A(tiltScale, "ScaleY", null, 1, 250, Out()));
    }

    /// <summary>
    /// v1's flip: the card turns half-way, the face swaps at the edge, the other half lands
    /// (850 ms in all). The flanks and the hint fade while the lyrics are up.
    /// </summary>
    public void ToggleLyrics() => Flip();

    private void Flip()
    {
        if (flipping || App.Shared.Player.Current is null) return;
        flipping = true;
        if (hovering) Untilt();
        var first = Run(A(flipProj, "RotationY", 0, 90, 380, new CubicEase { EasingMode = EasingMode.EaseIn }));
        first.Completed += (_, _) =>
        {
            flipped = !flipped;
            front.Visibility = flipped ? Visibility.Collapsed : Visibility.Visible;
            back.Visibility = flipped ? Visibility.Visible : Visibility.Collapsed;
            prevFlank.Opacity = nextFlank.Opacity = flipped ? 0 : 1;
            prevFlank.IsHitTestVisible = nextFlank.IsHitTestVisible = !flipped;
            hint.Opacity = flipped ? 0 : 1;
            Paint();
            var second = Run(A(flipProj, "RotationY", -90, 0, 470, new CubicEase { EasingMode = EasingMode.EaseOut }));
            second.Completed += (_, _) => flipping = false;
            Follow(App.Shared.Engine.Position);
        };
    }

    /// <summary>
    /// v1's vinyl-stack change. The old cover recedes into the stack door-style (420 ms,
    /// ease-in). 320 ms later the new one swings in from the side and overshoots a little
    /// (600 ms). Everything is mirrored for «назад». Not while the lyrics are up.
    /// </summary>
    private void Swap(ImageSource? old, int dir)
    {
        if (flipped || !motion) return;
        var s = size;
        outImage.Source = old;
        outHost.Visibility = Visibility.Visible;
        var ein = new CubicEase { EasingMode = EasingMode.EaseIn };
        var away = Run(
            A(outProj, "GlobalOffsetX", 0, dir * 0.18 * s, 420, ein), A(outProj, "GlobalOffsetY", 0, -0.03 * s, 420, ein),
            A(outProj, "GlobalOffsetZ", 0, -480, 420, ein), A(outProj, "RotationY", 0, dir * 78, 420, ein),
            A(outScale, "ScaleX", 1, 0.55, 420, ein), A(outScale, "ScaleY", 1, 0.55, 420, ein), A(outHost, "Opacity", 1, 0, 420, ein));
        away.Completed += (_, _) => outHost.Visibility = Visibility.Collapsed;

        var bounce = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.45 };
        // the entry's start values hold through its 320 ms delay (FillBehavior covers only the end)
        inHost.Opacity = 0;
        inProj.GlobalOffsetX = dir * 0.6 * s;
        inProj.GlobalOffsetZ = 120;
        inProj.RotationY = dir * 72;
        inScale.ScaleX = inScale.ScaleY = 0.6;
        Run(A(inProj, "GlobalOffsetX", dir * 0.6 * s, 0, 600, bounce, 320), A(inProj, "GlobalOffsetZ", 120, 0, 600, bounce, 320),
            A(inProj, "RotationY", dir * 72, 0, 600, bounce, 320), A(inScale, "ScaleX", 0.6, 1, 600, bounce, 320),
            A(inScale, "ScaleY", 0.6, 1, 600, bounce, 320), A(inHost, "Opacity", 0, 1, 120, null, 320));
    }

    private static CubicEase Out() => new() { EasingMode = EasingMode.EaseOut };

    private static DoubleAnimation A(DependencyObject target, string property, double? from, double to, int ms, EasingFunctionBase? ease, int delay = 0)
    {
        var a = new DoubleAnimation
        {
            From = from, To = to, Duration = TimeSpan.FromMilliseconds(ms), BeginTime = TimeSpan.FromMilliseconds(delay),
            EasingFunction = ease, EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(a, target);
        Storyboard.SetTargetProperty(a, property);
        return a;
    }

    private static DoubleAnimationUsingKeyFrames Keys(DependencyObject target, string property, params (int Ms, double Value)[] frames)
    {
        var a = new DoubleAnimationUsingKeyFrames { EnableDependentAnimation = true };
        foreach (var (ms, v) in frames) a.KeyFrames.Add(new LinearDoubleKeyFrame { KeyTime = TimeSpan.FromMilliseconds(ms), Value = v });
        Storyboard.SetTarget(a, target);
        Storyboard.SetTargetProperty(a, property);
        return a;
    }

    private static Storyboard Run(params Timeline[] parts)
    {
        var sb = new Storyboard();
        foreach (var p in parts) sb.Children.Add(p);
        sb.Begin();
        return sb;
    }

    // ── lyrics ──────────────────────────────────────────────────────────────────

    [GeneratedRegex(@"\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]")]
    private static partial Regex LrcTag();

    private static readonly FontFamily Georgia = new("Georgia");
    private static SolidColorBrush Ink => Theme.Hex(Theme.Dark ? 0xFFD8D4C8u : 0xFF2A2620u);

    /// <summary>v1 `LyricsBackFace`: synced lines mark the one being sung and a click seeks there; the face never scrolls itself.</summary>
    private void DrawLyrics(JsonObject? l, string? songTitle)
    {
        lyrics.Children.Clear();
        synced = [];
        lyricsHead.Text = $"{songTitle} · ТЕКСТ".ToUpperInvariant();
        if (l is null)
        {
            var loading = context is null && App.Shared.Player.Current?.ServerTrackId is not null;
            lyrics.Children.Add(M.T(loading ? "загружаю…" : "тексты ещё не добавлены", 14, Theme.Hex(0xFF666666), font: Georgia, style: Windows.UI.Text.FontStyle.Italic));
            return;
        }
        if (l["syncedLrc"]?.GetValue<string>() is { Length: > 0 } lrc)
        {
            var lines = new List<(TimeSpan At, string Text)>();
            foreach (var raw in lrc.Split('\n'))
            {
                var text = Regex.Replace(raw, @"\[[^\]]*\]", "").Trim();
                foreach (Match m in LrcTag().Matches(raw))
                {
                    var ms = (int.Parse(m.Groups[1].Value) * 60 + int.Parse(m.Groups[2].Value)) * 1000 + (m.Groups[3].Success ? int.Parse(m.Groups[3].Value.PadRight(3, '0')) : 0);
                    lines.Add((TimeSpan.FromMilliseconds(ms), text));
                }
            }
            foreach (var (at, text) in lines.OrderBy(x => x.At))
            {
                var b = new Button
                {
                    Content = new TextBlock { Text = text.Length == 0 ? " " : text, FontFamily = Georgia, FontSize = 14, LineHeight = 24, TextWrapping = TextWrapping.WrapWholeWords, Foreground = Ink },
                    Background = Clear, BorderThickness = new Thickness(0), Padding = new Thickness(0, 1, 0, 1),
                    HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Opacity = 0.72,
                };
                b.Click += (_, _) => App.Shared.Player.Seek(at);
                b.OpacityTransition = new ScalarTransition { Duration = TimeSpan.FromMilliseconds(250) };
                synced.Add((at, b));
                lyrics.Children.Add(b);
            }
            if (synced.Count > 0) return;
        }
        foreach (var para in (l["text"]?.GetValue<string>() ?? "").Split('\n'))
            lyrics.Children.Add(para.Trim().Length == 0
                ? new Border { Height = 16 }
                : new TextBlock { Text = para, FontFamily = Georgia, FontSize = 14, LineHeight = 24, TextWrapping = TextWrapping.WrapWholeWords, Foreground = Ink });
    }

    private void Follow(TimeSpan at)
    {
        if (synced.Count == 0) return;
        var i = synced.FindLastIndex(s => s.At <= at + TimeSpan.FromMilliseconds(250));
        var on = Theme.Hex(Theme.Dark ? 0xFFF3E6C4u : 0xFF5A3D00u);
        for (var k = 0; k < synced.Count; k++)
        {
            synced[k].Line.Opacity = k == i ? 1 : 0.72;
            ((TextBlock)synced[k].Line.Content).Foreground = k == i ? on : Ink;
        }
    }

    // ── facts ───────────────────────────────────────────────────────────────────

    /// <summary>v1's fact classes: the most specific label names the fact, its hue colours the dot.</summary>
    private static readonly (string Key, string Label, double Hue)[] Classes =
    [
        ("sample", "сэмпл", 170), ("name_origin", "название", 125), ("title_origin", "название", 125), ("trouble", "спор", 15),
        ("record", "рекорд", 45), ("award", "награда", 90), ("video", "клип", 335), ("placement", "где звучит", 140),
        ("sound", "звук", 215), ("creation", "создание", 75), ("personal", "личное", 350), ("band_history", "история", 55),
    ];

    private void DrawFacts()
    {
        facts.Children.Clear();
        if (App.Shared.Player.Current is null) return;
        var k = context?["knowledge"] as JsonObject;
        var list = (k?[factSide == "song" ? "songFacts" : "artistFacts"]?.AsArray() ?? []).OfType<JsonObject>().ToList();
        if (list.Count == 0)
        {
            Note(facts, context is null ? "Загружаю…" : factSide == "song" ? "О песне пока ничего не известно" : "Об артисте пока ничего не известно");
            return;
        }
        factIndex = (factIndex % list.Count + list.Count) % list.Count;
        var f = list[factIndex];
        var labels = (f["labels"]?.AsArray() ?? []).Select(x => x?.GetValue<string>()).ToHashSet();
        var head = new Grid();
        var tags = M.H(12);
        var cls = Classes.FirstOrDefault(c => labels.Contains(c.Key));
        if (cls.Label is not null)
            tags.Children.Add(M.H(6, new Ellipse { Width = 6, Height = 6, Fill = new SolidColorBrush(Theme.Oklch(0.72, 0.14, cls.Hue)), VerticalAlignment = VerticalAlignment.Center },
                M.T(cls.Label, 11, Theme.B("MxTextSubtle"))));
        if (f["confirmed"] is JsonValue cv && cv.TryGetValue<bool>(out var confirmed) && !confirmed)
            tags.Children.Add(M.T("из открытых источников", 11, Theme.B("MxTextSubtle")));
        head.Children.Add(tags);
        if (list.Count > 1)
        {
            var pager = M.H(8, Pager("‹", -1), M.T($"{factIndex + 1} / {list.Count}", 11, Theme.B("MxTextSubtle"), font: Theme.Mono).Align(HorizontalAlignment.Left, VerticalAlignment.Center), Pager("›", 1));
            pager.HorizontalAlignment = HorizontalAlignment.Right;
            head.Children.Add(pager);
        }
        facts.Children.Add(head);
        var text = M.T(f["text"]?.GetValue<string>() ?? "", 14.5, wrap: true);
        text.LineHeight = 22;
        text.MaxWidth = 560;
        text.HorizontalAlignment = HorizontalAlignment.Left;
        facts.Children.Add(text);
    }

    private Button Pager(string glyph, int step)
    {
        var b = new Button
        {
            Content = M.T(glyph, 14, Theme.B("MxTextMuted")), Width = 22, Height = 22, Padding = new Thickness(0), CornerRadius = new CornerRadius(6),
            Background = Clear, BorderThickness = new Thickness(0),
        };
        b.Click += (_, _) => { factIndex += step; DrawFacts(); };
        return b;
    }

    private void DrawCredits(JsonObject? k)
    {
        credits.Children.Clear();
        foreach (var (key, pre) in new[] { ("producers", "продюсер"), ("samples", "сэмпл"), ("sampledBy", "сэмплировали") })
            foreach (var r in (k?[key]?.AsArray() ?? []).OfType<JsonObject>())
            {
                var text = r["text"]?.GetValue<string>() ?? "";
                var label = new TextBlock { FontSize = 12, Foreground = Theme.B("MxTextMuted"), TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 320 };
                label.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = pre + " ", Foreground = Theme.B("MxAmber") });
                label.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = text });
                var chip = new Border
                {
                    CornerRadius = new CornerRadius(999), BorderBrush = Theme.B("MxBorderStrong"), BorderThickness = new Thickness(1),
                    Padding = new Thickness(10, 5, 10, 5), Child = label,
                };
                ToolTipService.SetToolTip(chip, text);
                credits.Children.Add(chip);
            }
    }

    private static void Note(StackPanel into, string text) => into.Children.Add(M.T(text, 13.5, Theme.B("MxTextSubtle"), wrap: true));

    // ── the queue ───────────────────────────────────────────────────────────────

    private void DrawQueue()
    {
        var p = App.Shared.Player;
        var q = p.Queue;
        var cur = q.ToList().FindIndex(x => x.Id == p.Current?.Id);
        var ahead = Math.Max(0, q.Count - cur - 1);
        queueHead.Text = $"{(p.Mode == QueueMode.Stream ? "ПОТОК" : "ОЧЕРЕДЬ")} · {Ru.Tracks(ahead).ToUpperInvariant()} ВПЕРЕДИ";
        rows.Children.Clear();
        for (var i = 0; i < q.Count; i++) rows.Children.Add(Row(q[i], i, cur, p.IsPlaying));
        if (cur >= 0 && cur < rows.Children.Count)
            ((FrameworkElement)rows.Children[cur]).StartBringIntoView(new BringIntoViewOptions { VerticalAlignmentRatio = 0.15, AnimationDesired = true });
    }

    private static Grid Row(QueueItem item, int i, int cur, bool playing)
    {
        var row = new Grid { CornerRadius = new CornerRadius(12), Padding = new Thickness(10, 7, 6, 7), ColumnSpacing = 12, BorderThickness = new Thickness(1), Background = Clear, BorderBrush = Clear };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(22) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(40) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(30) });
        UIElement num = i == cur ? EqBars(playing) : M.T(i > cur ? (i - cur).ToString() : "", 12, Theme.B("MxTextSubtle"), font: Theme.Mono).Align(HorizontalAlignment.Center, VerticalAlignment.Center);
        var (frame, image) = Img.Cover(40, 6);
        image.Source = Img.Source(item.CoverImageId, 80);
        var text = M.V(0, M.T(item.Title, 13.5, weight: FontWeights.Medium), M.T(item.Artist, 12, Theme.B("MxTextSubtle")));
        text.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(frame, 1);
        Grid.SetColumn(text, 2);
        row.Children.Add(num);
        row.Children.Add(frame);
        row.Children.Add(text);
        Button? remove = null;
        if (i == cur)
        {
            var amber = Theme.C("MxAmber");
            var g = new LinearGradientBrush { StartPoint = new Point(0, 0.5), EndPoint = new Point(1, 0.5) };
            g.GradientStops.Add(new GradientStop { Offset = 0, Color = Theme.WithAlpha(amber, 0.16) });
            g.GradientStops.Add(new GradientStop { Offset = 1, Color = Theme.WithAlpha(amber, 0.06) });
            row.Background = g;
            row.BorderBrush = new SolidColorBrush(Theme.WithAlpha(amber, 0.22));
        }
        else
        {
            if (i < cur) row.Opacity = 0.5;
            var hover = new SolidColorBrush(Theme.WithAlpha(Theme.C("MxText"), 0.05));
            if (i > cur)
            {
                remove = new Button
                {
                    Content = new Icon("Close", 14, Theme.B("MxTextSubtle")), Width = 30, Height = 30, Padding = new Thickness(0), CornerRadius = new CornerRadius(8),
                    Background = Clear, BorderThickness = new Thickness(0), Opacity = 0,
                };
                ToolTipService.SetToolTip(remove, $"Убрать «{item.Title}» из очереди");
                remove.Click += (_, _) => App.Shared.Player.Remove(i);
                Grid.SetColumn(remove, 3);
                row.Children.Add(remove);
            }
            row.PointerEntered += (_, _) => { row.Background = hover; if (remove is not null) remove.Opacity = 1; };
            row.PointerExited += (_, _) => { row.Background = Clear; if (remove is not null) remove.Opacity = 0; };
        }
        row.Tapped += (_, e) =>
        {
            // the ✕ is a button inside the row: its tap must not also jump there
            for (var el = e.OriginalSource as DependencyObject; el is not null && el != row; el = VisualTreeHelper.GetParent(el))
                if (el == remove) return;
            App.Shared.Player.Jump(i);
        };
        return row;
    }

    /// <summary>The playing row's three amber bars, bouncing while the music plays (v1's equaliser mark).</summary>
    private static StackPanel EqBars(bool playing)
    {
        var bars = M.H(2);
        bars.HorizontalAlignment = HorizontalAlignment.Center;
        bars.VerticalAlignment = VerticalAlignment.Center;
        bars.Height = 14;
        var sb = new Storyboard();
        foreach (var (h, ms) in new[] { (0.55, 420), (1.0, 560), (0.7, 480) })
        {
            var st = new ScaleTransform { CenterY = 14, ScaleY = h };
            bars.Children.Add(new Rectangle { Width = 3, Height = 14, RadiusX = 1.5, RadiusY = 1.5, Fill = Theme.B("MxAmber"), VerticalAlignment = VerticalAlignment.Bottom, RenderTransform = st });
            var a = new DoubleAnimation { From = 0.3, To = 1, Duration = TimeSpan.FromMilliseconds(ms), AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EnableDependentAnimation = true };
            Storyboard.SetTarget(a, st);
            Storyboard.SetTargetProperty(a, "ScaleY");
            sb.Children.Add(a);
        }
        if (playing) bars.Loaded += (_, _) => sb.Begin();
        bars.Unloaded += (_, _) => sb.Stop();
        return bars;
    }
}
