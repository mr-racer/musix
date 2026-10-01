using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;
using Windows.UI;

namespace Musix.App.Ui;

/// <summary>
/// v1's record: black grooves, a highlight, and a label in the cover's colours. The label is
/// a radial blend of the vibrant colour into the dark accent, off-centre so the spin shows.
/// The card deck slides it out from behind the sleeve on hover; the gatefold shows it
/// peeking from its sleeve. It turns only while shown, so a grid of hundreds idles.
/// </summary>
public sealed class Vinyl : Grid
{
    private readonly RotateTransform turn = new();
    private readonly Storyboard spin = new() { RepeatBehavior = RepeatBehavior.Forever };

    public Vinyl(double size, string? coverImageId, double seconds = 10)
    {
        Width = Height = size;
        RenderTransform = turn;
        turn.CenterX = turn.CenterY = size / 2;
        Children.Add(new Ellipse { Fill = Theme.Hex(0xFF0B0B0Du), Stroke = Theme.Hex(0x0DFFFFFFu), StrokeThickness = 1 });
        for (var r = 0.40; r < 0.97; r += 0.045)
            Children.Add(new Ellipse { Width = size * r, Height = size * r, Stroke = Theme.Hex(0xFF17171Au), StrokeThickness = 1, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });
        var shine = new RadialGradientBrush { Center = new Point(0.34, 0.28), GradientOrigin = new Point(0.34, 0.28), RadiusX = 0.42, RadiusY = 0.42 };
        shine.GradientStops.Add(new GradientStop { Offset = 0, Color = Color.FromArgb(41, 255, 255, 255) });
        shine.GradientStops.Add(new GradientStop { Offset = 1, Color = Color.FromArgb(0, 255, 255, 255) });
        Children.Add(new Ellipse { Fill = shine });
        var pal = App.Shared.Palette(coverImageId);
        var label = new RadialGradientBrush { Center = new Point(0.38, 0.32), GradientOrigin = new Point(0.38, 0.32), RadiusX = 0.7, RadiusY = 0.7 };
        label.GradientStops.Add(new GradientStop { Offset = 0, Color = pal?.Vibrant ?? Theme.Oklch(0.62, 0.16, 285) });
        label.GradientStops.Add(new GradientStop { Offset = 1, Color = pal?.Accent ?? Theme.Oklch(0.45, 0.16, 300) });
        Children.Add(new Ellipse { Width = size * 0.34, Height = size * 0.34, Fill = label, Stroke = Theme.Hex(0x59000000u), StrokeThickness = 1, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });
        var hole = Math.Max(5, size * 0.05);
        Children.Add(new Ellipse { Width = hole, Height = hole, Fill = Theme.Hex(0xFF08080Au), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });
        var a = new DoubleAnimation { From = 0, To = 360, Duration = TimeSpan.FromSeconds(seconds), EnableDependentAnimation = true };
        Storyboard.SetTarget(a, turn);
        Storyboard.SetTargetProperty(a, "Angle");
        spin.Children.Add(a);
        Unloaded += (_, _) => spin.Stop();
    }

    public void Spin(bool on) { if (on) spin.Begin(); else spin.Pause(); }
}
