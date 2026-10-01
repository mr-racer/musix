using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Musix.App.Ui;
using Musix.Core.Playback;

namespace Musix.App.Views;

/// <summary>
/// The web player's wave scrubber: 96 bars drawn from the server's energy envelope. The bars
/// already played are amber. A click or a drag seeks. A 404 means the envelope is not
/// computed yet (the server queues it on the first ask), so the scrubber is a plain line
/// meanwhile and asks again every 4 s.
/// </summary>
public sealed class Wave : Grid
{
    private const int N = 96;
    private readonly StackPanel bars = new() { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
    private readonly Rectangle line = new() { Height = 2, RadiusX = 1, RadiusY = 1, VerticalAlignment = VerticalAlignment.Center };
    private readonly Rectangle lineDone = new() { Height = 2, RadiusX = 1, RadiusY = 1, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Left };
    private readonly Brush played = Theme.B("MxAmber"), rest = Theme.Hex(Theme.Dark ? 0x40FFFFFFu : 0x33000000u);
    private double[]? heights;
    private double progress;
    private string? trackId;
    private bool dragging;
    private DispatcherTimer? retry;

    public Action<double>? Seek { get; set; }

    public Wave()
    {
        Height = 36;
        Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);  // hit-testable everywhere, not only on bars
        line.Fill = rest;
        lineDone.Fill = played;
        Children.Add(line);
        Children.Add(lineDone);
        Children.Add(bars);
        SizeChanged += (_, _) => Layout();
        PointerPressed += (_, e) => { dragging = true; CapturePointer(e.Pointer); At(e.GetCurrentPoint(this).Position.X); };
        PointerMoved += (_, e) => { if (dragging) At(e.GetCurrentPoint(this).Position.X, preview: true); };
        PointerReleased += (_, e) => { if (!dragging) return; dragging = false; ReleasePointerCapture(e.Pointer); At(e.GetCurrentPoint(this).Position.X); };
        Unloaded += (_, _) => retry?.Stop();
    }

    public async void Load(string? serverTrackId)
    {
        if (serverTrackId == trackId) return;
        trackId = serverTrackId;
        heights = null;
        retry?.Stop();
        Layout();
        if (serverTrackId is null) return;
        try
        {
            var raw = await App.Shared.Api.GetBytesAsync($"api/v2/tracks/{serverTrackId}/envelope");
            if (serverTrackId != trackId) return;
            if (raw is null)
            {
                retry ??= new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
                retry.Tick -= Again;
                retry.Tick += Again;
                retry.Start();
                return;
            }
            heights = Envelope.Bars(raw, N);
            Layout();
        }
        catch (Exception) { /* offline: the line stays */ }
    }

    private void Again(object? s, object e)
    {
        retry!.Stop();
        var id = trackId;
        trackId = null;
        Load(id);
    }

    public void SetProgress(double p)
    {
        if (dragging) return;
        progress = Math.Clamp(p, 0, 1);
        Paint();
    }

    private void At(double x, bool preview = false)
    {
        var f = ActualWidth > 0 ? Math.Clamp(x / ActualWidth, 0, 1) : 0;
        progress = f;
        Paint();
        if (!preview) Seek?.Invoke(f);
    }

    private void Layout()
    {
        bars.Children.Clear();
        var w = ActualWidth;
        line.Visibility = lineDone.Visibility = heights is null ? Visibility.Visible : Visibility.Collapsed;
        if (heights is not null && w > 0)
        {
            var slot = w / N;
            var bar = Math.Max(1.5, slot * 0.62);
            bars.Spacing = slot - bar;
            foreach (var h in heights)
                bars.Children.Add(new Rectangle { Width = bar, Height = Math.Max(2, h * Height), RadiusX = bar / 2, RadiusY = bar / 2, VerticalAlignment = VerticalAlignment.Center });
        }
        Paint();
    }

    private void Paint()
    {
        if (heights is null) { lineDone.Width = Math.Max(0, ActualWidth * progress); return; }
        var cut = (int)Math.Round(progress * N);
        for (var i = 0; i < bars.Children.Count; i++)
            ((Rectangle)bars.Children[i]).Fill = i < cut ? played : rest;
    }
}
