using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.UI.Text;

namespace Musix.App.Ui;

/// <summary>A little C# markup: the UI is built in code (it compiles and type-checks anywhere).</summary>
public static class M
{
    public static TextBlock T(string text, double size = 14, Brush? color = null, FontWeight? weight = null, FontFamily? font = null,
        double spacing = 0, bool wrap = false, FontStyle style = FontStyle.Normal) => new()
    {
        Text = text, FontSize = size, Foreground = color ?? Theme.B("MxText"), FontWeight = weight ?? FontWeights.Normal,
        FontFamily = font ?? Theme.Sans, CharacterSpacing = (int)(spacing * 1000), FontStyle = style,
        TextWrapping = wrap ? TextWrapping.WrapWholeWords : TextWrapping.NoWrap, TextTrimming = wrap ? TextTrimming.None : TextTrimming.CharacterEllipsis,
    };

    /// <summary>v1's mono eyebrow: small caps-like spaced uppercase.</summary>
    public static TextBlock Eyebrow(string text, Brush? color = null) =>
        T(text.ToUpperInvariant(), 11, color ?? Theme.B("MxTextSubtle"), FontWeights.SemiBold, Theme.Mono, spacing: 0.2);

    public static StackPanel V(double spacing, params UIElement[] children)
    {
        var p = new StackPanel { Orientation = Orientation.Vertical, Spacing = spacing };
        foreach (var c in children) p.Children.Add(c);
        return p;
    }

    public static StackPanel H(double spacing, params UIElement[] children)
    {
        var p = new StackPanel { Orientation = Orientation.Horizontal, Spacing = spacing };
        foreach (var c in children) p.Children.Add(c);
        return p;
    }

    public static T Pad<T>(this T e, double l, double t, double r, double b) where T : Control { e.Padding = new Thickness(l, t, r, b); return e; }
    public static T Margin<T>(this T e, double l, double t, double r, double b) where T : FrameworkElement { e.Margin = new Thickness(l, t, r, b); return e; }
    public static T Align<T>(this T e, HorizontalAlignment h, VerticalAlignment v = VerticalAlignment.Stretch) where T : FrameworkElement
    { e.HorizontalAlignment = h; e.VerticalAlignment = v; return e; }

    public static Border Card(UIElement child, double radius = 18, Brush? bg = null, double pad = 18) => new()
    {
        Child = child, CornerRadius = new CornerRadius(radius), Padding = new Thickness(pad),
        Background = bg ?? Theme.B("MxSurface"), BorderBrush = Theme.B("MxBorder"), BorderThickness = new Thickness(1),
    };

    public static Button Btn(object content, Action onClick, bool accent = false)
    {
        var b = new Button { Content = content, CornerRadius = new CornerRadius(12), Padding = new Thickness(16, 9, 16, 9) };
        if (accent) b.Style = (Style)Application.Current.Resources["AccentButtonStyle"];
        b.Click += (_, _) => onClick();
        return b;
    }

    /// <summary>A round glyph button (Segoe Fluent Icons).</summary>
    public static Button Glyph(string glyph, Action onClick, double size = 40, string? tip = null)
    {
        var b = new Button
        {
            Content = new FontIcon { Glyph = glyph, FontSize = size * 0.42 }, Width = size, Height = size, CornerRadius = new CornerRadius(size / 2),
            Padding = new Thickness(0), Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent), BorderThickness = new Thickness(0),
        };
        if (tip is not null) ToolTipService.SetToolTip(b, tip);
        b.Click += (_, _) => onClick();
        return b;
    }
}
