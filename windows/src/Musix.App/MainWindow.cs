using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Musix.App.Ui;
using Musix.App.Views;

namespace Musix.App;

/// <summary>
/// The desktop shell (the web's desktop layout): a left rail, the page, and the player bar
/// along the bottom. Mica is the Windows-native counterpart of the web's glass. Closing the
/// window hides it to the tray while music plays (a setting); the mini-player is a compact
/// overlay window.
/// </summary>
public sealed class MainWindow : Window
{
    private readonly Grid root = new();
    private readonly NavigationView rail = new();
    private readonly ContentControl page = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch, VerticalContentAlignment = VerticalAlignment.Stretch };
    private PlayerBar? bar;
    private readonly Stack<Func<UIElement>> history = new();
    private Func<UIElement>? current;
    private Window? mini;

    public MainWindow()
    {
        Title = "MusiX";
        SystemBackdrop = new MicaBackdrop();
        ExtendsContentIntoTitleBar = true;
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1360, 880));
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "musix.ico"));
        AppWindow.Closing += (_, e) =>
        {
            if (!App.Shared.Settings.CloseToTray || !App.Shared.Player.IsPlaying) { App.Shared.Quit(); return; }
            e.Cancel = true;  // keeps playing in the tray
            AppWindow.Hide();
        };
        root.Background = Theme.B("MxBg");
        Content = root;
        rail.PaneDisplayMode = NavigationViewPaneDisplayMode.LeftCompact;
        rail.IsBackButtonVisible = NavigationViewBackButtonVisible.Visible;
        rail.IsSettingsVisible = true;
        rail.Background = Theme.Brush("MxSidebarBg");
        rail.MenuItems.Add(Item("Главная", "", "home"));
        rail.MenuItems.Add(Item("Библиотека", "", "library"));
        rail.MenuItems.Add(Item("На этом компьютере", "", "local"));
        rail.Content = page;
        rail.SelectionChanged += (_, e) =>
        {
            if (e.IsSettingsSelected) { Go(() => new SettingsView(), root: true); return; }
            switch ((e.SelectedItem as NavigationViewItem)?.Tag as string)
            {
                case "home": Go(() => new HomeView(), root: true); break;
                case "library": Go(() => new LibraryView(), root: true); break;
                case "local": Go(() => new LocalView(), root: true); break;
            }
        };
        rail.BackRequested += (_, _) => Back();
    }

    public void ShowWindow() { AppWindow.Show(); Activate(); }

    public void ShowLogin()
    {
        root.Children.Clear();
        root.RowDefinitions.Clear();
        root.Children.Add(new LoginView(() => ShowShell()));
    }

    public void ShowShell()
    {
        root.Children.Clear();
        root.RowDefinitions.Clear();
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        bar = new PlayerBar();  // bound to this session's player (a server switch at login builds a new one)
        Grid.SetRow(rail, 0);
        Grid.SetRow(bar, 1);
        root.Children.Add(rail);
        root.Children.Add(bar);
        rail.SelectedItem = null;
        rail.SelectedItem = rail.MenuItems[0];
        App.Shared.StartLoops();
    }

    private static NavigationViewItem Item(string text, string glyph, string tag) =>
        new() { Content = text, Icon = new FontIcon { Glyph = glyph }, Tag = tag };

    /// <summary>Opens a page; a root page clears the back stack (a rail tap starts over, as on Android).</summary>
    public void Go(Func<UIElement> make, bool root = false)
    {
        if (root) history.Clear();
        else if (current is not null) history.Push(current);
        current = make;
        page.Content = make();
        rail.IsBackEnabled = history.Count > 0;
    }

    /// <summary>Opens an album; its cover flies from the tile into the header (a connected animation).</summary>
    public void OpenAlbum(string id, Image from)
    {
        try { Microsoft.UI.Xaml.Media.Animation.ConnectedAnimationService.GetForCurrentView().PrepareToAnimate("cover", from); } catch (Exception) { }
        Go(() => new AlbumView(id));
    }

    public void Back()
    {
        if (history.Count == 0) return;
        current = history.Pop();
        page.Content = current();
        rail.IsBackEnabled = history.Count > 0;
    }

    /// <summary>The data changed behind the page (a sync landed): the page and the bar redraw from the store.</summary>
    public void Refresh()
    {
        if (page.Content is IRefreshable r) r.Refresh();
        bar?.Refresh();
    }

    /// <summary>The mini-player: a compact always-on-top overlay with the cover and the transport.</summary>
    public void ToggleMini()
    {
        if (mini is not null) { mini.Close(); mini = null; return; }
        mini = new Window { Title = "MusiX", SystemBackdrop = new DesktopAcrylicBackdrop() };
        mini.AppWindow.SetPresenter(AppWindowPresenterKind.CompactOverlay);
        mini.AppWindow.Resize(new Windows.Graphics.SizeInt32(340, 340));
        var p = App.Shared.Player;
        var cover = new Image { Stretch = Stretch.UniformToFill };
        var title = M.T("", 15, weight: FontWeights.SemiBold);
        var artist = M.T("", 12.5, Theme.B("MxTextMuted"));
        void sync()
        {
            var c = p.Current;
            title.Text = c?.Title ?? "MusiX";
            artist.Text = c?.Artist ?? "";
            cover.Source = App.Shared.CoverUrl(c?.CoverImageId, 512) is { } u ? new BitmapImage(u) : null;
        }
        p.Changed += sync;
        mini.Closed += (_, _) => p.Changed -= sync;
        sync();
        var controls = M.H(6, M.Glyph("", p.Previous), M.Glyph("", p.Toggle, 48), M.Glyph("", p.Next)).Align(HorizontalAlignment.Center);
        var g = new Grid { Background = Theme.B("MxBg") };
        g.Children.Add(cover);
        g.Children.Add(new Border
        {
            VerticalAlignment = VerticalAlignment.Bottom, Padding = new Thickness(14),
            Background = new LinearGradientBrush(new GradientStopCollection
            {
                new() { Color = Colors.Transparent, Offset = 0 }, new() { Color = Windows.UI.Color.FromArgb(0xD9, 0x0A, 0x0A, 0x10), Offset = 1 },
            }, 90),
            Child = M.V(6, title, artist, controls),
        });
        mini.Content = g;
        mini.Closed += (_, _) => mini = null;
        mini.Activate();
    }
}

/// <summary>A page that can redraw from the store when a sync lands.</summary>
public interface IRefreshable
{
    void Refresh();
}
