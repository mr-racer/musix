using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Musix.App.Ui;

namespace Musix.App.Views;

/// <summary>Settings: the account and server, the look, the tray, the version.</summary>
public sealed class SettingsView : UserControl
{
    public SettingsView()
    {
        var app = App.Shared;
        var s = app.Settings;
        var theme = new RadioButtons { Header = "Оформление (после перезапуска)" };
        theme.Items.Add("Тёмное");
        theme.Items.Add("Светлое");
        theme.SelectedIndex = s.Theme == "light" ? 1 : 0;
        theme.SelectionChanged += (_, _) => { s.Theme = theme.SelectedIndex == 1 ? "light" : "dark"; s.Save(); };
        var tray = new ToggleSwitch { Header = "Закрытие окна во время музыки сворачивает в трей", IsOn = s.CloseToTray };
        tray.Toggled += (_, _) => { s.CloseToTray = tray.IsOn; s.Save(); };
        var logout = M.Btn("Выйти из аккаунта", () => _ = Logout());
        var keys = new ToggleSwitch { Header = "Глобальные клавиши (работают, даже когда окно свёрнуто)", IsOn = s.Hotkeys };
        var combos = M.V(6);
        void drawCombos()
        {
            combos.Children.Clear();
            var busy = app.Keys?.Busy ?? [];
            foreach (var (action, label, def) in Services.Hotkeys.Actions)
            {
                var box = new TextBox { Text = s.HotkeyMap.GetValueOrDefault(action, def), Width = 220, IsReadOnly = true, PlaceholderText = "нажми сочетание" };
                ToolTipService.SetToolTip(box, "Нажми новое сочетание с Ctrl, Alt, Shift или Win");
                box.PreviewKeyDown += (_, e) =>
                {
                    e.Handled = true;
                    var k = e.Key;
                    if (k is Windows.System.VirtualKey.Control or Windows.System.VirtualKey.Menu or Windows.System.VirtualKey.Shift or Windows.System.VirtualKey.LeftWindows) return;
                    bool down(Windows.System.VirtualKey m) => Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(m).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);
                    var parts = new List<string>();
                    if (down(Windows.System.VirtualKey.Control)) parts.Add("Ctrl");
                    if (down(Windows.System.VirtualKey.Menu)) parts.Add("Alt");
                    if (down(Windows.System.VirtualKey.Shift)) parts.Add("Shift");
                    if (down(Windows.System.VirtualKey.LeftWindows)) parts.Add("Win");
                    if (parts.Count == 0) return;  // a bare key would steal it from every app
                    parts.Add(k.ToString());
                    box.Text = string.Join("+", parts);
                    s.HotkeyMap[action] = box.Text;
                    s.Save();
                    app.Keys?.Apply();
                    drawCombos();
                };
                var row = M.H(12, M.T(label, 14).Align(HorizontalAlignment.Left, VerticalAlignment.Center), box);
                if (busy.Contains(action)) row.Children.Add(M.T("занято другой программой", 12.5, Theme.B("MxRed")).Align(HorizontalAlignment.Left, VerticalAlignment.Center));
                combos.Children.Add(row);
            }
        }
        drawCombos();
        keys.Toggled += (_, _) => { s.Hotkeys = keys.IsOn; s.Save(); app.Keys?.Apply(); drawCombos(); };
        var version = app.Updates.Version;
        var updateState = M.T(app.Updates.Installed ? (app.Updates.Ready is { } r ? $"Готово обновление {r}" : "Последняя версия") : "Запуск из исходников — обновления отключены",
            13, Theme.B("MxTextMuted"));
        var check = M.Btn(app.Updates.Ready is null ? "Проверить обновления" : "Перезапустить и обновить", () => { });
        check.IsEnabled = app.Updates.Installed;
        check.Click += async (_, _) =>
        {
            if (app.Updates.Ready is not null) { app.Updates.ApplyAndRestart(); return; }
            check.IsEnabled = false;
            updateState.Text = "Проверяю…";
            try
            {
                var found = await app.Updates.CheckAsync();
                updateState.Text = found ? $"Готово обновление {app.Updates.Ready}" : "Последняя версия";
                if (found) check.Content = "Перезапустить и обновить";
            }
            catch (Exception) { updateState.Text = "Сервер обновлений недоступен"; }
            finally { check.IsEnabled = true; }
        };
        var body = M.V(22,
            M.T("Настройки", 34, font: Theme.Display),
            M.Card(M.V(12, M.Eyebrow("Аккаунт"), M.T(app.Session.Server.ToString(), 15, weight: FontWeights.Medium), logout)),
            M.Card(M.V(16, M.Eyebrow("Окно"), theme, tray)),
            M.Card(M.V(12, M.Eyebrow("Клавиши"), keys, combos)),
            M.Card(M.V(8, M.Eyebrow("О программе"), M.T($"MusiX для Windows {version}", 15), updateState, check,
                M.T("Библиотека и плейлисты хранятся на этом ПК и работают без сети; прослушивания и реакции уходят на сервер, когда он доступен.",
                    13, Theme.B("MxTextMuted"), wrap: true))));
        body.Padding = new Thickness(40, 36, 40, 40);
        body.MaxWidth = 760;
        body.HorizontalAlignment = HorizontalAlignment.Left;
        Content = new ScrollViewer { Content = body };
    }

    private static async Task Logout()
    {
        var app = App.Shared;
        app.StopLoops();
        app.Engine.Pause();
        try { await app.Session.LogoutAsync(); } catch (Exception) { /* the token is cleared locally either way */ }
        app.Window.ShowLogin();
    }
}
