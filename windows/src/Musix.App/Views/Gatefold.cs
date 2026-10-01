using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Shapes;
using Musix.App.Ui;
using Musix.Core.Store;
using Windows.Foundation;
using Windows.UI;

namespace Musix.App.Views;

/// <summary>
/// v1's album gatefold (web/src/ui/Gatefold.tsx). The open album is an overlay, not a page.
/// - The sleeve flies in from the clicked cover and turns 180°.
/// - The back is the blurred cover, with the record peeking from a small sleeve and the
///   tracklist rising in, row by row.
/// - The close plays all of it backwards.
/// - The back stays dark in both themes, like v1's.
/// The blur is the cover decoded at 24 px and stretched: there is no blur effect without Win2D.
/// </summary>
public sealed class Gatefold : Grid
{
    private static readonly Color Ink = Color.FromArgb(255, 236, 233, 244);
    private static readonly SolidColorBrush Clear = new(Color.FromArgb(0, 0, 0, 0));
    private readonly string id;
    private readonly Rect? from;
    private readonly Action done;
    private readonly Grid stage = new();
    private readonly CompositeTransform fly = new();
    private readonly Grid flip = new();
    private readonly PlaneProjection turn = new();
    private readonly Grid front = new(), back = new() { Visibility = Visibility.Collapsed };
    private readonly List<(UIElement El, TranslateTransform T, int Delay, bool Row)> risers = [];
    private readonly bool motion = new Windows.UI.ViewManagement.UISettings().AnimationsEnabled;
    private bool closing;

    public Gatefold(string id, Rect? from, Action done)
    {
        this.id = id;
        this.from = from;
        this.done = done;
        Background = new SolidColorBrush(Color.FromArgb(166, 0, 0, 0));
        IsTabStop = true;
        Opacity = 0;
        stage.RenderTransform = fly;
        stage.HorizontalAlignment = HorizontalAlignment.Center;
        stage.VerticalAlignment = VerticalAlignment.Center;
        flip.Projection = turn;
        flip.Children.Add(front);
        flip.Children.Add(back);
        stage.Children.Add(flip);
        stage.Tapped += (_, e) => e.Handled = true;  // a tap on the sleeve is not a tap on the dim
        Children.Add(stage);
        Tapped += (_, _) => Close();
        KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Escape) { e.Handled = true; Close(); } };
        Build();
        Loaded += (_, _) => { Focus(FocusState.Programmatic); Open(); };
    }

    private void Build()
    {
        var m = App.Shared.Mirror;
        var a = m.Album(id);
        var tracks = m.AlbumTracks(id).ToList();
        var ids = tracks.Select(t => t.Id).ToList();

        // the front: the sleeve as it was in the grid, with v1's sheen
        foreach (var f in new[] { front, back }) f.CornerRadius = new CornerRadius(18);
        front.Background = Theme.Hex(0xFF0D0A12u);
        front.Children.Add(new Image { Source = Img.Source(a?.Cover, 400), Stretch = Stretch.UniformToFill });
        var sheen = new LinearGradientBrush { StartPoint = new Point(0, 0.15), EndPoint = new Point(1, 0.85) };
        sheen.GradientStops.Add(new GradientStop { Offset = 0, Color = Color.FromArgb(36, 255, 255, 255) });
        sheen.GradientStops.Add(new GradientStop { Offset = 0.32, Color = Color.FromArgb(0, 255, 255, 255) });
        sheen.GradientStops.Add(new GradientStop { Offset = 0.68, Color = Color.FromArgb(0, 0, 0, 0) });
        sheen.GradientStops.Add(new GradientStop { Offset = 1, Color = Color.FromArgb(71, 0, 0, 0) });
        front.Children.Add(new Rectangle { Fill = sheen });

        // the back: the blurred cover under a shade, then the body
        back.Background = Theme.Hex(0xFF0D0A12u);
        if (App.Shared.CoverUrl(a?.Cover, 320) is { } u)
            back.Children.Add(new Image { Source = new BitmapImage(u) { DecodePixelWidth = 24 }, Stretch = Stretch.UniformToFill, Opacity = 0.55, Margin = new Thickness(-60) });
        var shade = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(0, 1) };
        shade.GradientStops.Add(new GradientStop { Offset = 0, Color = Color.FromArgb(82, 10, 8, 18) });
        shade.GradientStops.Add(new GradientStop { Offset = 1, Color = Color.FromArgb(168, 10, 8, 18) });
        back.Children.Add(new Rectangle { Fill = shade });
        var body = new Grid { Padding = new Thickness(28, 26, 28, 24), RowSpacing = 16 };
        body.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        body.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        body.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        back.Children.Add(body);
        if (a is null)
        {
            body.Children.Add(M.T("Альбома больше нет в библиотеке", 15, new SolidColorBrush(Ink)));
            return;
        }

        var hero = new Grid { ColumnSpacing = 22 };
        hero.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(196) });
        hero.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        hero.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var record = new Vinyl(124, a.Cover, seconds: 16) { HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(64, 4, 0, 0) };
        record.Loaded += (_, _) => record.Spin(motion);
        var (small, smallImage) = Img.Cover(132, 12);
        smallImage.Source = Img.Source(a.Cover, 256);
        small.HorizontalAlignment = HorizontalAlignment.Left;
        var sleeve = new Grid { Width = 196, Height = 132, Children = { record, small } };
        var title = new TextBlock
        {
            Text = a.Title, FontFamily = Theme.Display, FontSize = 32, LineHeight = 35, MaxLines = 2, TextWrapping = TextWrapping.WrapWholeWords,
            TextTrimming = TextTrimming.CharacterEllipsis, Foreground = Theme.Hex(0xFFF5F3FAu), Margin = new Thickness(0, 6, 0, 6),
        };
        var text = M.V(0, M.T("АЛЬБОМ", 10, Theme.Hex(0x80EEEBF8u), font: Theme.Mono, spacing: 0.24), title);
        if (a.ArtistId is { } aid)
        {
            var pill = new Button
            {
                Content = M.T($"{a.Artist} →", 13, new SolidColorBrush(Ink)), CornerRadius = new CornerRadius(999), Padding = new Thickness(12, 4, 12, 4),
                Background = Theme.Hex(0x14FFFFFFu), BorderBrush = Theme.Hex(0x29FFFFFFu), BorderThickness = new Thickness(1),
            };
            ToolTipService.SetToolTip(pill, "Открыть страницу артиста");
            pill.Click += (_, _) => Close(() => App.Shared.Window.Go(() => new ArtistView(aid, a.Artist ?? "")));
            text.Children.Add(pill);
        }
        var meta = string.Join("   ·   ", new[] { a.Year?.ToString() ?? "—", Ru.Tracks(tracks.Count), Img.Clock(tracks.Sum(t => t.DurationMs)) });
        text.Children.Add(M.T(meta, 12.5, Theme.Hex(0x99EEEBF8u), font: Theme.Mono, spacing: 0.06).Margin(0, 10, 0, 0));
        text.VerticalAlignment = VerticalAlignment.Center;
        var x = new Button
        {
            Content = new Icon("Close", 15, Theme.Hex(0xB3EEEBF8u)), Width = 34, Height = 34, Padding = new Thickness(0), CornerRadius = new CornerRadius(17),
            Background = Theme.Hex(0x0FFFFFFFu), BorderBrush = Theme.Hex(0x1AFFFFFFu), BorderThickness = new Thickness(1), VerticalAlignment = VerticalAlignment.Top,
        };
        ToolTipService.SetToolTip(x, "Закрыть");
        x.Click += (_, _) => Close();
        Grid.SetColumn(text, 1);
        Grid.SetColumn(x, 2);
        hero.Children.Add(sleeve);
        hero.Children.Add(text);
        hero.Children.Add(x);
        body.Children.Add(Rise(hero, 450));

        var playAll = new Button
        {
            Content = M.H(8, new Icon("Play", 13, Theme.Hex(0xFFFFFFFFu)), M.T("Играть всё", 12, Theme.Hex(0xFFFFFFFFu), spacing: 0.06)),
            CornerRadius = new CornerRadius(10), Padding = new Thickness(18, 9, 18, 9), BorderThickness = new Thickness(0), IsEnabled = tracks.Count > 0,
        };
        var violet = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(0, 1) };
        violet.GradientStops.Add(new GradientStop { Offset = 0, Color = Theme.Oklch(0.62, 0.21, 272) });
        violet.GradientStops.Add(new GradientStop { Offset = 1, Color = Theme.Oklch(0.49, 0.22, 283) });
        playAll.Background = violet;
        playAll.Click += (_, _) => Close(() => App.Shared.Player.PlayTracks(ids, 0, "album"));
        var shuffle = Ghost("Shuffle", "Вперемешку", () => Close(() => App.Shared.Player.PlayTracks(ids.OrderBy(_ => Random.Shared.Next()).ToList(), 0, "album")));
        var add = Ghost("Plus", "В плейлист", () => { });
        add.Flyout = AddTo(ids);
        var actions = M.H(8, playAll, shuffle, add);
        Grid.SetRow(actions, 1);
        body.Children.Add(Rise(actions, 550));

        var rows = M.V(0);
        for (var i = 0; i < tracks.Count; i++) rows.Children.Add(Row(tracks[i], i, ids));
        var list = new Border
        {
            CornerRadius = new CornerRadius(14), Background = Theme.Hex(0x7308060Eu), BorderBrush = Theme.Hex(0x14FFFFFFu), BorderThickness = new Thickness(1),
            Child = new ScrollViewer { Content = rows, VerticalScrollBarVisibility = ScrollBarVisibility.Auto },
        };
        Grid.SetRow(list, 2);
        body.Children.Add(list);
    }

    private Grid Row(TrackRow t, int i, List<string> ids)
    {
        var row = new Grid { Padding = new Thickness(14, 9, 14, 9), ColumnSpacing = 10, Background = Clear, BorderBrush = Theme.Hex(0x0FFFFFFFu), BorderThickness = new Thickness(0, 0, 0, 1) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(28) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(60) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(30) });
        var no = M.T((t.TrackNo ?? i + 1).ToString(), 11, Theme.Hex(0x66EEEBF8u), font: Theme.Mono);
        no.HorizontalAlignment = HorizontalAlignment.Center;
        no.VerticalAlignment = VerticalAlignment.Center;
        var name = M.T(t.Title, 13, new SolidColorBrush(Ink));
        name.VerticalAlignment = VerticalAlignment.Center;
        var dur = M.T(Img.Clock(t.DurationMs), 11, Theme.Hex(0x66EEEBF8u), font: Theme.Mono);
        dur.HorizontalAlignment = HorizontalAlignment.Right;
        dur.VerticalAlignment = VerticalAlignment.Center;
        var add = new Button
        {
            Content = new Icon("Plus", 15, Theme.Hex(0x73EEEBF8u)), Width = 30, Height = 30, Padding = new Thickness(0), Background = Clear, BorderThickness = new Thickness(0),
            Flyout = AddTo([t.Id]),
        };
        ToolTipService.SetToolTip(add, "Добавить в плейлист");
        Grid.SetColumn(name, 1);
        Grid.SetColumn(dur, 2);
        Grid.SetColumn(add, 3);
        row.Children.Add(no);
        row.Children.Add(name);
        row.Children.Add(dur);
        row.Children.Add(add);
        var number = no.Text;
        row.PointerEntered += (_, _) => { row.Background = Theme.Hex(0x0FFFFFFFu); no.Text = "▶"; no.Foreground = Theme.Hex(0xFFCDBCFFu); };
        row.PointerExited += (_, _) => { row.Background = Clear; no.Text = number; no.Foreground = Theme.Hex(0x66EEEBF8u); };
        row.Tapped += (_, e) =>
        {
            for (var el = e.OriginalSource as DependencyObject; el is not null && el != row; el = VisualTreeHelper.GetParent(el))
                if (el == add) return;
            Close(() => App.Shared.Player.PlayTracks(ids, i, "album"));
        };
        return (Grid)Rise(row, 620 + Math.Min(i, 20) * 35, isRow: true);
    }

    private static Button Ghost(string icon, string text, Action click)
    {
        var b = new Button
        {
            Content = M.H(8, new Icon(icon, 13, Theme.Hex(0xD9EEEBF8u)), M.T(text, 12, Theme.Hex(0xD9EEEBF8u))),
            CornerRadius = new CornerRadius(10), Padding = new Thickness(14, 9, 14, 9),
            Background = Theme.Hex(0x0FFFFFFFu), BorderBrush = Theme.Hex(0x1FFFFFFFu), BorderThickness = new Thickness(1),
        };
        b.Click += (_, _) => click();
        return b;
    }

    private static MenuFlyout AddTo(IReadOnlyList<string> trackIds)
    {
        var menu = new MenuFlyout();
        menu.Opening += (_, _) =>
        {
            menu.Items.Clear();
            var lists = App.Shared.Mirror.Playlists();
            if (lists.Count == 0) menu.Items.Add(new MenuFlyoutItem { Text = "Плейлистов пока нет", IsEnabled = false });
            foreach (var p in lists)
            {
                var item = new MenuFlyoutItem { Text = p.Name };
                item.Click += (_, _) =>
                {
                    var items = new System.Text.Json.Nodes.JsonArray();
                    foreach (var tid in trackIds) items.Add(new System.Text.Json.Nodes.JsonObject { ["itemId"] = Guid.NewGuid().ToString(), ["trackId"] = tid });
                    App.Shared.Outbox.Enqueue("playlist.add", Guid.NewGuid().ToString(), new System.Text.Json.Nodes.JsonObject { ["playlistId"] = p.Id, ["items"] = items });
                };
                menu.Items.Add(item);
            }
        };
        return menu;
    }

    /// <summary>v1 `rise` (and `rowIn` for the tracklist): hidden until the back faces up, then up 16 px (or in from the left 10 px) as it fades in.</summary>
    private UIElement Rise(FrameworkElement el, int delay, bool isRow = false)
    {
        var t = new TranslateTransform { X = isRow ? -10 : 0, Y = isRow ? 0 : 16 };
        el.RenderTransform = t;
        el.Opacity = 0;
        risers.Add((el, t, delay, isRow));
        return el;
    }

    // ── motion ─────────────────────────────────────────────────────────────────

    private void Open()
    {
        var w = Math.Min(700, ActualWidth * 0.94);
        var h = Math.Min(ActualHeight * 0.84, 700);
        stage.Width = w;
        stage.Height = h;
        fly.CenterX = w / 2;
        fly.CenterY = h / 2;
        turn.CenterOfRotationX = 0.5;
        if (!motion)
        {
            Opacity = 1;
            Face(back: true);
            foreach (var r in risers) { r.El.Opacity = 1; r.T.X = r.T.Y = 0; }
            return;
        }
        Run(A(this, "Opacity", 0, 1, 250, null));
        if (from is { } f && f.Width > 0)
        {
            // the shared-element flight (FLIP): from the clicked cover to the centre, while it turns
            fly.TranslateX = f.X + f.Width / 2 - ActualWidth / 2;
            fly.TranslateY = f.Y + f.Height / 2 - ActualHeight / 2;
            fly.ScaleX = f.Width / w;
            fly.ScaleY = f.Height / h;
            var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
            Run(A(fly, "TranslateX", fly.TranslateX, 0, 700, ease), A(fly, "TranslateY", fly.TranslateY, 0, 700, ease),
                A(fly, "ScaleX", fly.ScaleX, 1, 700, ease), A(fly, "ScaleY", fly.ScaleY, 1, 700, ease));
        }
        // v1's turn on (.35,.72,.22,1): the first quarter goes fast, the landing is long
        var first = Run(A(turn, "RotationY", 0, 90, 280, null, 60));
        first.Completed += (_, _) =>
        {
            Face(back: true);
            Run(A(turn, "RotationY", -90, 0, 570, new CubicEase { EasingMode = EasingMode.EaseOut }));
        };
        var rises = new List<Timeline>();
        foreach (var (el, t, delay, isRow) in risers)
        {
            var ms = isRow ? 400 : 550;
            var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
            rises.Add(A(el, "Opacity", 0, 1, ms, ease, delay));
            rises.Add(A(t, isRow ? "X" : "Y", isRow ? -10 : 16, 0, ms, ease, delay));
        }
        Run([.. rises]);
    }

    private void Face(bool back)
    {
        this.back.Visibility = back ? Visibility.Visible : Visibility.Collapsed;
        front.Visibility = back ? Visibility.Collapsed : Visibility.Visible;
    }

    /// <summary>Backwards: the sleeve turns to its front and flies home while the dim fades; then <paramref name="then"/>.</summary>
    public void Close(Action? then = null)
    {
        if (closing) return;
        closing = true;
        void finish() { done(); then?.Invoke(); }
        if (!motion) { finish(); return; }
        var first = Run(A(turn, "RotationY", 0, 90, 230, new CubicEase { EasingMode = EasingMode.EaseIn }));
        first.Completed += (_, _) => { Face(back: false); Run(A(turn, "RotationY", -90, 0, 270, new CubicEase { EasingMode = EasingMode.EaseOut })); };
        if (from is { } f && f.Width > 0)
        {
            var ease = new CubicEase { EasingMode = EasingMode.EaseInOut };
            Run(A(fly, "TranslateX", 0, f.X + f.Width / 2 - ActualWidth / 2, 450, ease), A(fly, "TranslateY", 0, f.Y + f.Height / 2 - ActualHeight / 2, 450, ease),
                A(fly, "ScaleX", 1, f.Width / stage.Width, 450, ease), A(fly, "ScaleY", 1, f.Height / stage.Height, 450, ease));
        }
        var fade = Run(A(this, "Opacity", 1, 0, 350, null, 150));
        fade.Completed += (_, _) => finish();
    }

    private static DoubleAnimation A(DependencyObject target, string property, double from, double to, int ms, EasingFunctionBase? ease, int delay = 0)
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

    private static Storyboard Run(params Timeline[] parts)
    {
        var sb = new Storyboard();
        foreach (var p in parts) sb.Children.Add(p);
        sb.Begin();
        return sb;
    }
}
