using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Foundation;

namespace Musix.App.Ui;

/// <summary>Children left to right, wrapping to a new line (WinUI has no WrapPanel): the credit chips.</summary>
public sealed class Wrap : Panel
{
    public double Spacing { get; set; } = 8;

    protected override Size MeasureOverride(Size available)
    {
        double x = 0, y = 0, line = 0, width = 0;
        foreach (var c in Children)
        {
            c.Measure(available);
            var d = c.DesiredSize;
            if (x > 0 && x + d.Width > available.Width) { y += line + Spacing; x = 0; line = 0; }
            x += d.Width + Spacing;
            line = Math.Max(line, d.Height);
            width = Math.Max(width, x - Spacing);
        }
        return new Size(double.IsInfinity(available.Width) ? width : Math.Min(width, available.Width), y + line);
    }

    protected override Size ArrangeOverride(Size final)
    {
        double x = 0, y = 0, line = 0;
        foreach (var c in Children)
        {
            var d = c.DesiredSize;
            if (x > 0 && x + d.Width > final.Width) { y += line + Spacing; x = 0; line = 0; }
            c.Arrange(new Rect(x, y, Math.Min(d.Width, final.Width), d.Height));
            x += d.Width + Spacing;
            line = Math.Max(line, d.Height);
        }
        return final;
    }
}
