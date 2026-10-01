using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Musix.App.Ui;
using Musix.Core.Api;

namespace Musix.App.Views;

/// <summary>v1's login (golden login-desktop): the brand, the promise, the glass card — server, email, password.</summary>
public sealed class LoginView : Grid
{
    public LoginView(Action signedIn)
    {
        var app = App.Shared;
        var server = new TextBox { Header = "Сервер", Text = app.Settings.Server, Width = 380 };
        var email = new TextBox { Header = "Email", Width = 380, InputScope = new Microsoft.UI.Xaml.Input.InputScope { Names = { new Microsoft.UI.Xaml.Input.InputScopeName(Microsoft.UI.Xaml.Input.InputScopeNameValue.EmailSmtpAddress) } } };
        var password = new PasswordBox { Header = "Пароль", Width = 380 };
        var invite = new TextBox { Header = "Инвайт-код", Width = 380, Visibility = Visibility.Collapsed, MaxLength = 12 };
        var mode = new SelectorBar();
        mode.Items.Add(new SelectorBarItem { Text = "Войти", IsSelected = true });
        mode.Items.Add(new SelectorBarItem { Text = "Регистрация" });
        mode.SelectionChanged += (_, _) => invite.Visibility = mode.SelectedItem == mode.Items[1] ? Visibility.Visible : Visibility.Collapsed;
        var error = M.T("", 13, Theme.B("MxRed"), wrap: true);
        var go = M.Btn("Войти", () => { }, accent: true);
        go.Width = 380;
        go.Click += async (_, _) =>
        {
            error.Text = "";
            go.IsEnabled = false;
            try
            {
                var url = new Uri(server.Text.Trim().TrimEnd('/') + "/");
                if (url != app.Session.Server) { app.Settings.Server = url.ToString(); app.Settings.Save(); app.Connect(url); }
                if (mode.SelectedItem == mode.Items[1]) await app.Session.RegisterAsync(email.Text.Trim(), password.Password, invite.Text.Trim());
                else await app.Session.LoginAsync(email.Text.Trim(), password.Password);
                signedIn();
            }
            catch (ApiError e) { error.Text = e.Status == 401 ? "Неверный email или пароль" : e.Status == 403 ? "Регистрация на этом сервере закрыта" : $"Сервер ответил {e.Status}"; }
            catch (Exception) { error.Text = "Сервер недоступен"; }
            finally { go.IsEnabled = true; }
        };
        var brand = M.H(14, new Border { Width = 46, Height = 46, CornerRadius = new CornerRadius(12), Background = Theme.Brush("MxUserBubble") },
            M.T("MUSIX", 15, Theme.Hex(0xD9EEEEF3), FontWeights.SemiBold, Theme.Mono, spacing: 0.3).Align(HorizontalAlignment.Left, VerticalAlignment.Center));
        brand.HorizontalAlignment = HorizontalAlignment.Center;
        var head = M.T("Подними свой Spotify у себя дома", 40, Theme.Hex(0xFFF1EEFF), FontWeights.Light, Theme.SerifItalic, wrap: true);
        head.TextAlignment = TextAlignment.Center;
        var line = M.T("Бесплатно, на твоих файлах и без буллшита в рекомендациях. Не только слушай музыку — узнавай её.", 15, Theme.Hex(0x99EEEEF3), wrap: true);
        line.TextAlignment = TextAlignment.Center;
        line.MaxWidth = 440;
        var card = M.Card(M.V(14, mode, server, email, password, invite, error, go), radius: 22, pad: 26);
        card.HorizontalAlignment = HorizontalAlignment.Center;
        var col = M.V(18, brand, head, line, card);
        col.MaxWidth = 560;
        col.HorizontalAlignment = HorizontalAlignment.Center;
        col.VerticalAlignment = VerticalAlignment.Center;
        Children.Add(new ScrollViewer { Content = col, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
    }
}
