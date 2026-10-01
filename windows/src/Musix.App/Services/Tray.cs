using H.NotifyIcon;
using Microsoft.UI.Xaml.Controls;

namespace Musix.App.Services;

/// <summary>The tray icon (spec §4): play/pause, next, огонёк/вода, show, quit. Closing the window keeps playing.</summary>
public sealed class Tray : IDisposable
{
    private readonly TaskbarIcon icon;

    public Tray(App app)
    {
        var menu = new MenuFlyout();
        void add(string text, Action a) { var i = new MenuFlyoutItem { Text = text }; i.Click += (_, _) => a(); menu.Items.Add(i); }
        add("Открыть MusiX", () => app.Window.ShowWindow());
        add("Пауза / играть", () => app.Player.Toggle());
        add("Следующий", () => app.Player.Next());
        add("🔥 Огонёк", () => app.Player.React("fire"));
        add("💧 Вода", () => app.Player.React("water"));
        add("📱 Продолжить на телефоне", () => _ = app.ContinueOnPhoneAsync());
        menu.Items.Add(new MenuFlyoutSeparator());
        add("Выйти", () => app.Quit());
        icon = new TaskbarIcon
        {
            ToolTipText = "MusiX",
            ContextFlyout = menu,
            IconSource = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri(Path.Combine(AppContext.BaseDirectory, "Assets", "musix.ico"))),
            NoLeftClickDelay = true,
        };
        icon.LeftClickCommand = new CommunityToolkit.Mvvm.Input.RelayCommand(() => app.Window.ShowWindow());
        icon.ForceCreate();
    }

    public void Dispose() => icon.Dispose();
}
