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

    public static FontFamily Sans { get; } = new("ms-appx:///Fonts/geist_400.ttf#Geist");
    public static FontFamily Text { get; } = new("ms-appx:///Fonts/noto_sans_400.ttf#Noto Sans");
    public static FontFamily Display { get; } = new("ms-appx:///Fonts/playfair_display_400.ttf#Playfair Display");
    public static FontFamily SerifItalic { get; } = new("ms-appx:///Fonts/noto_serif_display_300_italic.ttf#Noto Serif Display");
    public static FontFamily Mono { get; } = new("ms-appx:///Fonts/jetbrains_mono_400.ttf#JetBrains Mono");
}
