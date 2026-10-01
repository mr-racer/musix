using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace Musix.App.Ui;

/// <summary>
/// The design tokens (design/gen/windows/MusixTheme.xaml, embedded) loaded at start and read
/// by key; the fonts are the Android app's files, shipped next to the exe.
/// </summary>
public static class Theme
{
    private static ResourceDictionary? dict;

    public static void Load(Application app)
    {
        using var s = typeof(Theme).Assembly.GetManifestResourceStream("MusixTheme.xaml")!;
        using var r = new StreamReader(s);
        dict = (ResourceDictionary)XamlReader.Load(r.ReadToEnd());
        app.Resources.MergedDictionaries.Add(dict);
    }

    private static ResourceDictionary Themed => (ResourceDictionary)dict!.ThemeDictionaries[Dark ? "Dark" : "Light"];

    public static bool Dark { get; set; } = true;

    public static Color C(string key) => (Color)Themed[key];
    public static SolidColorBrush B(string key) => new(C(key));
    public static Brush Brush(string key) => Themed[key] is Brush b ? b : new SolidColorBrush((Color)Themed[key]);
    public static SolidColorBrush Hex(uint argb) => new(Color.FromArgb((byte)(argb >> 24), (byte)(argb >> 16), (byte)(argb >> 8), (byte)argb));

    /// <summary>A CSS colour as the server sends it: `#rrggbb` or `hsl(h, s%, l%)`. Null for anything else.</summary>
    public static Color? Parse(string? css)
    {
        if (string.IsNullOrWhiteSpace(css)) return null;
        css = css.Trim();
        if (css.StartsWith('#') && css.Length == 7 && uint.TryParse(css[1..], System.Globalization.NumberStyles.HexNumber, null, out var rgb))
            return Color.FromArgb(255, (byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb);
        var m = System.Text.RegularExpressions.Regex.Match(css, @"^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%");
        if (!m.Success) return null;
        double h = double.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture) % 360 / 360,
            sat = double.Parse(m.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture) / 100,
            l = double.Parse(m.Groups[3].Value, System.Globalization.CultureInfo.InvariantCulture) / 100;
        double q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
        double ch(double t) { t = (t + 1) % 1; return t < 1 / 6.0 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3.0 ? p + (q - p) * (2 / 3.0 - t) * 6 : p; }
        return Color.FromArgb(255, (byte)Math.Round(ch(h + 1 / 3.0) * 255), (byte)Math.Round(ch(h) * 255), (byte)Math.Round(ch(h - 1 / 3.0) * 255));
    }

    /// <summary>`oklch(l c h)` → sRGB, for the fact-class dots (the web's `oklch(72% 0.14 hue)`).</summary>
    public static Color Oklch(double l, double c, double hueDeg)
    {
        var h = hueDeg * Math.PI / 180;
        double a = c * Math.Cos(h), b = c * Math.Sin(h);
        double l_ = l + 0.3963377774 * a + 0.2158037573 * b, m_ = l - 0.1055613458 * a - 0.0638541728 * b, s_ = l - 0.0894841775 * a - 1.2914855480 * b;
        double L = l_ * l_ * l_, M = m_ * m_ * m_, S = s_ * s_ * s_;
        static byte E(double x) { x = Math.Clamp(x, 0, 1); x = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.Pow(x, 1 / 2.4) - 0.055; return (byte)Math.Round(x * 255); }
        return Color.FromArgb(255, E(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
            E(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S), E(-0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S));
    }

    public static SolidColorBrush WithAlphaBrush(string key, double a) => new(WithAlpha(C(key), a));

    public static Color WithAlpha(Color c, double a) => Color.FromArgb((byte)Math.Round(Math.Clamp(a, 0, 1) * 255), c.R, c.G, c.B);

    public static FontFamily Sans { get; } = new("ms-appx:///Fonts/geist_400.ttf#Geist");
    public static FontFamily Text { get; } = new("ms-appx:///Fonts/noto_sans_400.ttf#Noto Sans");
    public static FontFamily Display { get; } = new("ms-appx:///Fonts/playfair_display_400.ttf#Playfair Display");
    public static FontFamily SerifItalic { get; } = new("ms-appx:///Fonts/noto_serif_display_300_italic.ttf#Noto Serif Display");
    public static FontFamily Mono { get; } = new("ms-appx:///Fonts/jetbrains_mono_400.ttf#JetBrains Mono");
}
