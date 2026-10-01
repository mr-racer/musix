using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Musix.App.Ui;

namespace Musix.App.Views;

/// <summary>The bottom player bar: the cover and titles, the transport, огонёк/вода, the scrubber, the mini-player.</summary>
public sealed class PlayerBar : Grid
{
    private readonly Image cover = new() { Width = 56, Height = 56, Stretch = Stretch.UniformToFill };
    private readonly TextBlock title = M.T("", 14.5, weight: FontWeights.SemiBold);
    private readonly TextBlock artist = M.T("", 12.5, Theme.B("MxTextMuted"));
    private readonly Slider seek = new() { Minimum = 0, Maximum = 1, StepFrequency = 0.001, MinWidth = 320 };
    private readonly TextBlock pos = M.T("0:00", 11.5, Theme.B("MxTextSubtle"), font: Theme.Mono);
    private readonly TextBlock dur = M.T("0:00", 11.5, Theme.B("MxTextSubtle"), font: Theme.Mono);
    private readonly FontIcon playIcon = new() { Glyph = "", FontSize = 18 };
    private bool dragging;

    public PlayerBar()
    {
        Background = Theme.Brush("MxTabBarBg");
        BorderBrush = Theme.B("MxBorder");
        BorderThickness = new Thickness(0, 1, 0, 0);
        Padding = new Thickness(16, 10, 16, 10);
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var p = App.Shared.Player;

        var left = M.H(12, new Border { CornerRadius = new CornerRadius(10), Child = cover }, M.V(2, title, artist).Align(HorizontalAlignment.Left, VerticalAlignment.Center));
        left.Tapped += (_, _) => { if (App.Shared.Player.Current is not null) App.Shared.Window.Go(() => new PlayerView()); };
        ToolTipService.SetToolTip(left, "Открыть плеер");
        var play = new Button { Content = playIcon, Width = 44, Height = 44, CornerRadius = new CornerRadius(22), Style = (Style)Application.Current.Resources["AccentButtonStyle"] };
        play.Click += (_, _) => p.Toggle();
        var transport = M.H(8, M.Glyph("", p.Previous, tip: "Назад"), play, M.Glyph("", p.Next, tip: "Дальше"));
        transport.HorizontalAlignment = HorizontalAlignment.Center;
        seek.ValueChanged += (_, e) => { if (dragging) pos.Text = Clock(e.NewValue * App.Shared.Engine.Duration.TotalSeconds); };
        seek.PointerCaptureLost += (_, _) => { App.Shared.Player.Seek(TimeSpan.FromSeconds(seek.Value * App.Shared.Engine.Duration.TotalSeconds)); dragging = false; };
        seek.PointerPressed += (_, _) => dragging = true;
        var scrub = M.H(10, pos, seek, dur);
        scrub.HorizontalAlignment = HorizontalAlignment.Center;
        var center = M.V(4, transport, scrub);
        var right = M.H(4,
            M.Glyph("", () => p.React("fire"), tip: "Огонёк"),
            M.Glyph("", () => p.React("water"), tip: "Вода"),
            M.Glyph("", () => App.Shared.Window.ToggleMini(), tip: "Мини-плеер"));
        right.HorizontalAlignment = HorizontalAlignment.Right;
        right.VerticalAlignment = VerticalAlignment.Center;
        SetColumn(left, 0); SetColumn(center, 1); SetColumn(right, 2);
        Children.Add(left); Children.Add(center); Children.Add(right);

        p.Changed += Refresh;  // the engine raises on the UI thread
        var timer = DispatcherQueue.CreateTimer();
        timer.Interval = TimeSpan.FromMilliseconds(500);
        timer.Tick += (_, _) => Tick();
        timer.Start();
        Refresh();
    }

    public void Refresh()
    {
        var c = App.Shared.Player.Current;
        title.Text = c?.Title ?? "Ничего не играет";
        artist.Text = c?.Artist ?? "";
        cover.Source = App.Shared.CoverUrl(c?.CoverImageId, 96) is { } u ? new BitmapImage(u) { DecodePixelWidth = 112 } : null;
        playIcon.Glyph = App.Shared.Player.IsPlaying ? "" : "";
    }

    private void Tick()
    {
        var e = App.Shared.Engine;
        var total = e.Duration.TotalSeconds;
        dur.Text = Clock(total);
        if (dragging || total <= 0) return;
        pos.Text = Clock(e.Position.TotalSeconds);
        seek.Value = e.Position.TotalSeconds / total;
    }

    private static string Clock(double s) => s <= 0 || double.IsNaN(s) ? "0:00" : $"{(int)s / 60}:{(int)s % 60:00}";
}
