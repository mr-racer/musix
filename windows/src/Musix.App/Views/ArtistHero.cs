using System.Numerics;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Shapes;
using Path = Microsoft.UI.Xaml.Shapes.Path;
using Musix.App.Ui;
using Windows.Foundation;
using Windows.UI;

namespace Musix.App.Views;

/// <summary>
/// v1's light field behind the artist cutout (web/src/ui/ArtistFigure.module.css «Burst»):
/// - light rays turning once in 90 s, centred on the figure;
/// - a warm flare breathing over 7.5 s;
/// - sparks drifting up.
/// The field melts into the page at the bottom and the left. WinUI has no conic gradients
/// and no masks, so the rays are one wedge path under a radial fill, and the fades are
/// gradients in the page colour on top.
/// </summary>
public sealed class ArtistBurst : Grid
{
    private const double R = 900;
    private readonly Grid rays = new() { Width = 2 * R, Height = 2 * R, IsHitTestVisible = false };
    private readonly Canvas sparks = new() { IsHitTestVisible = false };
    private readonly Rectangle baseGlow = new();
    private readonly bool motion = new Windows.UI.ViewManagement.UISettings().AnimationsEnabled;

    public ArtistBurst(double hue)
    {
        IsHitTestVisible = false;
        var bg = Theme.C("MxBg");
        var b = new RadialGradientBrush { Center = new Point(0.73, 0.32), GradientOrigin = new Point(0.73, 0.32), RadiusX = 0.92, RadiusY = 0.71 };
        b.GradientStops.Add(new GradientStop { Offset = 0, Color = Theme.Dark ? Theme.Oklch(0.21, 0.015, hue) : Theme.Oklch(0.96, 0.012, hue) });
        b.GradientStops.Add(new GradientStop { Offset = 0.55, Color = Theme.Dark ? Theme.Oklch(0.13, 0.01, hue) : Theme.Oklch(0.92, 0.01, hue) });
        b.GradientStops.Add(new GradientStop { Offset = 1, Color = bg });
        baseGlow.Fill = b;
        Children.Add(baseGlow);

        // the rays: 3° of light every 13°, fading out from the centre like v1's radial mask
        var geo = new PathGeometry();
        for (double a = 0; a < 360; a += 13)
        {
            Point P(double deg) => new(R + R * Math.Cos(deg * Math.PI / 180), R + R * Math.Sin(deg * Math.PI / 180));
            var f = new PathFigure { StartPoint = new Point(R, R), IsClosed = true };
            f.Segments.Add(new LineSegment { Point = P(a) });
            f.Segments.Add(new ArcSegment { Point = P(a + 3), Size = new Size(R, R), SweepDirection = SweepDirection.Clockwise });
            geo.Figures.Add(f);
        }
        var rayInk = Theme.Dark ? Color.FromArgb(51, 255, 255, 255) : Color.FromArgb(61, 120, 92, 220);
        var fade = new RadialGradientBrush();
        fade.GradientStops.Add(new GradientStop { Offset = 0.04, Color = rayInk });
        fade.GradientStops.Add(new GradientStop { Offset = 0.56, Color = Theme.WithAlpha(rayInk, 0) });
        var turn = new RotateTransform { CenterX = R, CenterY = R };
        rays.Children.Add(new Path { Data = geo, Fill = fade, RenderTransform = turn });
        var flareSize = R * 1.12;
        var flare = new Ellipse { Width = flareSize, Height = flareSize, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var fb = new RadialGradientBrush();
        fb.GradientStops.Add(new GradientStop { Offset = 0, Color = Theme.Dark ? Color.FromArgb(173, 255, 250, 240) : Color.FromArgb(217, 255, 255, 255) });
        fb.GradientStops.Add(new GradientStop { Offset = 0.26, Color = Theme.WithAlpha(Theme.Dark ? Theme.Oklch(0.68, 0.14, hue) : Theme.Oklch(0.80, 0.12, hue), 0.42) });
        fb.GradientStops.Add(new GradientStop { Offset = 0.62, Color = Color.FromArgb(0, 255, 255, 255) });
        flare.Fill = fb;
        rays.Children.Add(flare);
        rays.HorizontalAlignment = HorizontalAlignment.Left;
        rays.VerticalAlignment = VerticalAlignment.Top;
        Children.Add(rays);

        // sparks: three sizes, like v1's three background layers
        var rnd = new Random(7);
        var spark = Theme.Dark ? Color.FromArgb(242, 255, 238, 205) : Theme.WithAlpha(Theme.Oklch(0.58, 0.16, hue), 0.7);
        for (var i = 0; i < 70; i++)
        {
            var (d, c) = (i % 3) switch { 0 => (2.6, Color.FromArgb(250, 255, 255, 255)), 1 => (2.4, Color.FromArgb(153, 255, 255, 255)), _ => (3.4, spark) };
            var e = new Ellipse { Width = d, Height = d, Fill = new SolidColorBrush(c), Tag = (rnd.NextDouble(), rnd.NextDouble()) };
            sparks.Children.Add(e);
        }
        sparks.Opacity = 0.85;
        Children.Add(sparks);

        // v1's mask: no edges, it melts into the page below and toward the rail
        var down = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(0, 1) };
        down.GradientStops.Add(new GradientStop { Offset = 0.52, Color = Theme.WithAlpha(bg, 0) });
        down.GradientStops.Add(new GradientStop { Offset = 1, Color = bg });
        Children.Add(new Rectangle { Fill = down });
        var side = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(1, 0) };
        side.GradientStops.Add(new GradientStop { Offset = 0, Color = bg });
        side.GradientStops.Add(new GradientStop { Offset = 0.18, Color = Theme.WithAlpha(bg, 0) });
        side.GradientStops.Add(new GradientStop { Offset = 0.88, Color = Theme.WithAlpha(bg, 0) });
        side.GradientStops.Add(new GradientStop { Offset = 1, Color = bg });
        Children.Add(new Rectangle { Fill = side });

        SizeChanged += (_, _) => Place();
        if (!motion) return;
        var sb = new Storyboard();
        sb.Children.Add(Loop(turn, "Angle", 0, 360, 90_000, reverse: false));
        sb.Children.Add(Loop(flare, "Opacity", 0.82, 1, 3750, reverse: true));
        var drift = new TranslateTransform();
        sparks.RenderTransform = drift;
        sb.Children.Add(Loop(drift, "Y", 0, -120, 13_000, reverse: true));
        Loaded += (_, _) => sb.Begin();
        Unloaded += (_, _) => sb.Stop();
    }

    /// <summary>The rays sit on the figure (72% across, a third down); sparks fill an ellipse around it, thinning out.</summary>
    private void Place()
    {
        double w = ActualWidth, h = ActualHeight;
        if (w <= 0 || h <= 0) return;
        Clip = new RectangleGeometry { Rect = new Rect(0, 0, w, h) };
        double cx = w * 0.72, cy = h * 0.34;
        rays.Margin = new Thickness(cx - R, cy - R, 0, 0);
        foreach (var child in sparks.Children)
        {
            var e = (Ellipse)child;
            var (u, v) = ((double, double))e.Tag;
            double x = u * w, y = v * (h + 120);
            Canvas.SetLeft(e, x);
            Canvas.SetTop(e, y);
            double dx = (x - cx) / (0.6 * w), dy = (y - cy) / (0.86 * h);
            e.Opacity = Math.Clamp(1 - Math.Sqrt(dx * dx + dy * dy) / 0.78, 0, 1);
        }
    }

    /// <summary>v1's parallax: the layers follow the cursor by a few pixels, each at its own depth.</summary>
    public void Lean(double hx, double hy)
    {
        baseGlow.Translation = new Vector3((float)(hx * 6), (float)(hy * 4), 0);
        rays.Translation = new Vector3((float)(hx * 6), (float)(hy * 4), 0);
        sparks.Translation = new Vector3((float)(hx * 8), (float)(hy * 6), 0);
    }

    public void EnableLean()
    {
        foreach (var e in new UIElement[] { baseGlow, rays, sparks })
            e.TranslationTransition = new Vector3Transition { Duration = TimeSpan.FromMilliseconds(700) };
    }

    private static DoubleAnimation Loop(DependencyObject target, string property, double from, double to, int ms, bool reverse)
    {
        var a = new DoubleAnimation
        {
            From = from, To = to, Duration = TimeSpan.FromMilliseconds(ms), RepeatBehavior = RepeatBehavior.Forever, AutoReverse = reverse,
            EnableDependentAnimation = true, EasingFunction = reverse ? new SineEase { EasingMode = EasingMode.EaseInOut } : null,
        };
        Storyboard.SetTarget(a, target);
        Storyboard.SetTargetProperty(a, property);
        return a;
    }
}

/// <summary>
/// The artist's transparent cutout standing in the light (web/src/ui/ArtistFigure.tsx):
/// - a blurred, brightened echo of it glows behind;
/// - it rises in 18 px as it fades in;
/// - a pool of light with a glass rim fades in under the feet.
/// The echo is the cutout decoded at 40 px and stretched (no blur effect without Win2D).
/// </summary>
public sealed class ArtistFigure : Grid
{
    public ArtistFigure(Uri cutout, double hue)
    {
        Width = 460;
        Height = 440;
        var echo = new Image
        {
            Source = new BitmapImage(cutout) { DecodePixelWidth = 40 }, Stretch = Stretch.Uniform, VerticalAlignment = VerticalAlignment.Bottom, Opacity = 0.5,
            RenderTransform = new ScaleTransform { ScaleX = 1.07, ScaleY = 1.07, CenterX = 230, CenterY = 220 },
        };
        var lift = new TranslateTransform { Y = 18 };
        var figure = new Image { Source = new BitmapImage(cutout) { DecodePixelWidth = 900 }, Stretch = Stretch.Uniform, VerticalAlignment = VerticalAlignment.Bottom, Opacity = 0, RenderTransform = lift };
        var pedestal = new Grid { Height = 58, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, -26), Opacity = 0, IsHitTestVisible = false };
        pedestal.Children.Add(new Ellipse { Fill = Pool(Theme.WithAlpha(Theme.Oklch(0.80, 0.10, hue), 0.5), Theme.WithAlpha(Theme.Oklch(0.66, 0.12, hue), 0.2)) });
        var rim = new RadialGradientBrush();
        rim.GradientStops.Add(new GradientStop { Offset = 0.6, Color = Color.FromArgb(0, 255, 255, 255) });
        rim.GradientStops.Add(new GradientStop { Offset = 0.67, Color = Theme.Dark ? Color.FromArgb(87, 255, 255, 255) : Color.FromArgb(97, 120, 92, 220) });
        rim.GradientStops.Add(new GradientStop { Offset = 0.75, Color = Color.FromArgb(0, 255, 255, 255) });
        pedestal.Children.Add(new Ellipse { Fill = rim, Margin = new Thickness(8, 4, 8, 4) });
        var shade = new RadialGradientBrush();
        shade.GradientStops.Add(new GradientStop { Offset = 0, Color = Color.FromArgb(128, 0, 0, 0) });
        shade.GradientStops.Add(new GradientStop { Offset = 0.7, Color = Color.FromArgb(0, 0, 0, 0) });
        pedestal.Children.Add(new Ellipse { Fill = shade, Margin = new Thickness(92, 17, 92, 15) });
        Children.Add(echo);
        Children.Add(pedestal);
        Children.Add(figure);
        // the pool is as wide as the figure is drawn, not as its box
        figure.ImageOpened += (_, _) =>
        {
            if (figure.Source is BitmapImage { PixelWidth: > 0, PixelHeight: > 0 } bi)
                pedestal.Width = Math.Max(160, Math.Min(Width, Height * bi.PixelWidth / bi.PixelHeight) * 1.05);
            Run(Anim(figure, "Opacity", 0, 1, 800, 150), Anim(lift, "Y", 18, 0, 800, 150), Anim(pedestal, "Opacity", 0, 1, 900, 400));
        };
        TranslationTransition = new Vector3Transition { Duration = TimeSpan.FromMilliseconds(700) };
    }

    private static RadialGradientBrush Pool(Color inner, Color mid)
    {
        var b = new RadialGradientBrush();
        b.GradientStops.Add(new GradientStop { Offset = 0, Color = inner });
        b.GradientStops.Add(new GradientStop { Offset = 0.45, Color = mid });
        b.GradientStops.Add(new GradientStop { Offset = 0.72, Color = Theme.WithAlpha(mid, 0) });
        return b;
    }

    private static DoubleAnimation Anim(DependencyObject target, string property, double from, double to, int ms, int delay)
    {
        var a = new DoubleAnimation
        {
            From = from, To = to, Duration = TimeSpan.FromMilliseconds(ms), BeginTime = TimeSpan.FromMilliseconds(delay),
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }, EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(a, target);
        Storyboard.SetTargetProperty(a, property);
        return a;
    }

    private static void Run(params Timeline[] parts)
    {
        var sb = new Storyboard();
        foreach (var p in parts) sb.Children.Add(p);
        sb.Begin();
    }
}
