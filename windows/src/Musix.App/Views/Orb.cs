using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Shapes;
using Musix.App.Ui;
using Windows.Foundation;
using Windows.UI;

namespace Musix.App.Views;

/// <summary>
/// The «Поток» orb (v1's wave orb): a gradient ring turning slowly at rest and faster while the
/// stream plays, colour blobs drifting under a glass cap, a breath. All of it runs as
/// independent animations on the compositor (RotateTransform/ScaleTransform), never per frame
/// on the UI thread.
/// </summary>
public sealed class Orb : Grid
{
    private readonly Storyboard ring;
    private readonly FontIcon glyph = new() { Glyph = "", FontSize = 30, Foreground = new SolidColorBrush(Color.FromArgb(0xF2, 0xFF, 0xFF, 0xFF)) };

    public Orb(double size, Action onClick)
    {
        Width = Height = size;
        var accent = Theme.C("MxAccent");
        var amber = Theme.C("MxAmber");
        var green = Theme.C("MxGreen");
        var halo = new Ellipse
        {
            Width = size, Height = size,
            Fill = new RadialGradientBrush
            {
                GradientStops = { Stop(Alpha(accent, 0x55), 0), Stop(Alpha(accent, 0x18), 0.62), Stop(Alpha(accent, 0), 1) },
            },
        };
        var ringShape = new Ellipse
        {
            Width = size * 0.86, Height = size * 0.86, StrokeThickness = 2.5,
            Stroke = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(1, 1), GradientStops = { Stop(accent, 0), Stop(Alpha(amber, 0xCC), 0.5), Stop(Alpha(accent, 0x22), 1) } },
        };
        var blobs = new Grid { Width = size * 0.7, Height = size * 0.7 };
        blobs.Children.Add(Blob(size * 0.52, accent, -size * 0.07, -size * 0.05));
        blobs.Children.Add(Blob(size * 0.42, amber, size * 0.1, size * 0.02));
        blobs.Children.Add(Blob(size * 0.38, green, -size * 0.02, size * 0.11));
        var body = new Ellipse { Width = size * 0.7, Height = size * 0.7, Fill = new SolidColorBrush(Theme.C("MxBgDeep")) };
        var cap = new Ellipse
        {
            Width = size * 0.7, Height = size * 0.7,
            Fill = new RadialGradientBrush
            {
                Center = new Point(0.35, 0.28), GradientOrigin = new Point(0.35, 0.28), RadiusX = 0.75, RadiusY = 0.75,
                GradientStops = { Stop(Color.FromArgb(0x55, 0xFF, 0xFF, 0xFF), 0), Stop(Color.FromArgb(0x10, 0xFF, 0xFF, 0xFF), 0.45), Stop(Color.FromArgb(0, 0xFF, 0xFF, 0xFF), 1) },
            },
            Stroke = new SolidColorBrush(Color.FromArgb(0x30, 0xFF, 0xFF, 0xFF)), StrokeThickness = 1,
        };
        var clip = new Grid { Width = size * 0.7, Height = size * 0.7, CornerRadius = new CornerRadius(size * 0.35) };
        clip.Children.Add(body);
        clip.Children.Add(blobs);
        foreach (var e in new UIElement[] { halo, ringShape, clip, cap, glyph }) Children.Add(e);
        ring = Spin(ringShape, 6);
        Spin(blobs, 14);
        Breathe(clip);
        Tapped += (_, _) => onClick();
        PointerEntered += (_, _) => ring.SpeedRatio = 2;
        PointerExited += (_, _) => ring.SpeedRatio = Playing ? 2.7 : 1;
    }

    public bool Playing { get; private set; }

    public void SetPlaying(bool on)
    {
        Playing = on;
        glyph.Glyph = on ? "" : "";
        ring.SpeedRatio = on ? 2.7 : 1;  // 6 s at rest, ~2.2 s while the stream plays
    }

    private static Ellipse Blob(double d, Color c, double dx, double dy) => new()
    {
        Width = d, Height = d, Margin = new Thickness(dx * 2, dy * 2, 0, 0),
        Fill = new RadialGradientBrush { GradientStops = { Stop(Alpha(c, 0xD0), 0), Stop(Alpha(c, 0x60), 0.5), Stop(Alpha(c, 0), 1) } },
    };

    private static Storyboard Spin(UIElement e, double seconds)
    {
        var t = new RotateTransform();
        e.RenderTransform = t;
        e.RenderTransformOrigin = new Point(0.5, 0.5);
        var a = new DoubleAnimation { From = 0, To = 360, Duration = TimeSpan.FromSeconds(seconds), RepeatBehavior = RepeatBehavior.Forever };
        Storyboard.SetTarget(a, t);
        Storyboard.SetTargetProperty(a, "Angle");
        var sb = new Storyboard { Children = { a } };
        sb.Begin();
        return sb;
    }

    private static void Breathe(UIElement e)
    {
        var t = new ScaleTransform();
        e.RenderTransform = t;
        e.RenderTransformOrigin = new Point(0.5, 0.5);
        var sb = new Storyboard();
        foreach (var prop in new[] { "ScaleX", "ScaleY" })
        {
            var a = new DoubleAnimation
            {
                From = 1, To = 1.035, Duration = TimeSpan.FromSeconds(3.2), AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
            };
            Storyboard.SetTarget(a, t);
            Storyboard.SetTargetProperty(a, prop);
            sb.Children.Add(a);
        }
        sb.Begin();
    }

    private static GradientStop Stop(Color c, double at) => new() { Color = c, Offset = at };
    private static Color Alpha(Color c, byte a) => Color.FromArgb(a, c.R, c.G, c.B);
}
