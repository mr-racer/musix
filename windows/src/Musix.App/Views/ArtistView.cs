using System.Numerics;
using System.Text.Json.Nodes;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Musix.App.Ui;
using Musix.Core.Store;
using Windows.Foundation;
using Windows.UI;

namespace Musix.App.Views;

/// <summary>
/// v1's artist atlas (golden artist-desktop, web/src/routes/_app/artist.$id.tsx):
/// - the hero: the name large at the left; at the right the cutout standing in its light
///   (rays, flare, sparks, cursor parallax), or the round photo when there is no cutout;
/// - below: the dossier, the AI bio, the top tracks and the albums.
/// The mirror's part (name, photo, albums) shows at once and offline. The server's page and
/// bio fill in the rest when they answer.
/// </summary>
public sealed class ArtistView : UserControl
{
    private readonly string id;
    private readonly Grid hero = new() { ColumnSpacing = 24, MinHeight = 380, Padding = new Thickness(52, 0, 0, 0) };
    private readonly StackPanel text = M.V(8);
    private readonly TextBlock nameText;
    private readonly TextBlock tags = M.T("", 13, Theme.Hex(Theme.Dark ? 0xFFD9D2FFu : 0xFF5B48A0u), FontWeights.SemiBold, spacing: 0.16);
    private readonly TextBlock decades = M.T("", 12, Theme.B("MxTextMuted"), spacing: 0.08);
    private readonly TextBlock counts = M.T("", 12, Theme.B("MxTextMuted"), spacing: 0.08);
    private readonly Grid figureSlot = new() { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
    private readonly Grid body = new() { ColumnSpacing = 36, Padding = new Thickness(52, 0, 0, 0) };
    private readonly StackPanel dossier = M.V(14);
    private readonly StackPanel main = M.V(30);
    private readonly StackPanel bio = M.V(10);
    private readonly StackPanel top = M.V(12);
    private readonly GradientStop tint = new() { Offset = 0 };
    private ArtistBurst? burst;
    private ArtistFigure? figure;

    public ArtistView(string id, string name)
    {
        this.id = id;
        var m = App.Shared.Mirror;
        var albums = m.ArtistAlbums(id, name).ToList();
        var ids = m.ArtistTrackIds(id).ToList();

        nameText = new TextBlock { Text = name, FontFamily = Theme.Text, FontWeight = FontWeights.Light, FontSize = 72, LineHeight = 76, TextWrapping = TextWrapping.WrapWholeWords, CharacterSpacing = -20 };
        tags.Margin = new Thickness(0, 8, 0, 0);
        counts.Text = $"{Ru.Albums(albums.Count)} · {Ru.Tracks(ids.Count)}";
        text.Children.Add(nameText);
        text.Children.Add(tags);
        text.Children.Add(decades);
        text.Children.Add(counts);
        text.Children.Add(PlayPill(() => App.Shared.Player.PlayTracks(ids.OrderBy(_ => Random.Shared.Next()).ToList(), 0, "artist")));
        text.VerticalAlignment = VerticalAlignment.Center;
        hero.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        hero.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(0.9, GridUnitType.Star) });
        Grid.SetColumn(figureSlot, 1);
        hero.Children.Add(text);
        hero.Children.Add(figureSlot);
        hero.Background = new SolidColorBrush(Color.FromArgb(0, 0, 0, 0));  // the parallax follows the cursor over all of it
        hero.PointerMoved += (_, e) =>
        {
            var p = e.GetCurrentPoint(hero).Position;
            double hx = p.X / Math.Max(1, hero.ActualWidth) - 0.5, hy = p.Y / Math.Max(1, hero.ActualHeight) - 0.5;
            burst?.Lean(hx, hy);
            if (figure is not null) figure.Translation = new Vector3((float)(hx * 3), (float)(hy * 2), 0);
        };
        Portrait(Img.Source(m.ArtistImage(id), 900));

        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(0) });
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var dossierCard = M.Card(dossier, radius: 18, pad: 18);
        dossierCard.VerticalAlignment = VerticalAlignment.Top;
        dossierCard.Visibility = Visibility.Collapsed;
        Grid.SetColumn(main, 1);
        body.Children.Add(dossierCard);
        body.Children.Add(main);
        main.Children.Add(bio);
        main.Children.Add(top);
        if (albums.Count > 0)
            main.Children.Add(M.V(12, Eyebrow("Альбомы"), new ItemsRepeater
            {
                ItemsSource = albums,
                ItemTemplate = new Factory<AlbumRow, AlbumTile>(() => new AlbumTile()),
                Layout = new UniformGridLayout { MinItemWidth = 180, MinColumnSpacing = 22, MinRowSpacing = 26 },
            }));

        var crumbs = M.T($"БИБЛИОТЕКА  /  АРТИСТЫ  /  {name.ToUpperInvariant()}", 10.5, Theme.B("MxTextSubtle"), spacing: 0.18);
        crumbs.Margin = new Thickness(52, 0, 0, 0);
        var page = M.V(28, crumbs, hero, body);
        page.Padding = new Thickness(0, 22, 40, 40);
        var root = new Grid();
        root.Children.Add(Glow());
        root.Children.Add(new ScrollViewer { Content = page });
        Content = root;
        SizeChanged += (_, _) => nameText.FontSize = Math.Clamp(ActualWidth * 0.06, 48, 84);
        _ = LoadPage();
        _ = LoadBio();
    }

    /// <summary>v1 `.atlasGlow`: the photo's tint high-right, a violet haze top-left.</summary>
    private Grid Glow()
    {
        var g = new Grid { Background = Theme.B("MxBg"), IsHitTestVisible = false };
        var t = new RadialGradientBrush { Center = new Point(0.72, 0.3), GradientOrigin = new Point(0.72, 0.3), RadiusX = 0.4, RadiusY = 0.55 };
        t.GradientStops.Add(tint);
        t.GradientStops.Add(new GradientStop { Offset = 0.7, Color = Color.FromArgb(0, 0, 0, 0) });
        if (Theme.Dark)
        {
            var haze = new RadialGradientBrush { Center = new Point(0.1, 0.1), GradientOrigin = new Point(0.1, 0.1), RadiusX = 0.6, RadiusY = 0.6 };
            haze.GradientStops.Add(new GradientStop { Offset = 0, Color = Theme.Parse("#1b1730")!.Value });
            haze.GradientStops.Add(new GradientStop { Offset = 0.7, Color = Color.FromArgb(0, 27, 23, 48) });
            g.Children.Add(new Rectangle { Fill = haze });
        }
        g.Children.Add(new Rectangle { Fill = t });
        SetTint(Theme.Parse("#d4a55a")!.Value);
        return g;
    }

    private void SetTint(Color c) => tint.Color = Theme.WithAlpha(c, Theme.Dark ? 0.28 : 0.18);

    /// <summary>The round photo in a glow of its tint, vignetted into the page (no cutout).</summary>
    private void Portrait(ImageSource? photo)
    {
        figureSlot.Children.Clear();
        if (photo is null) return;
        var size = 400;
        var glow = new Ellipse { Width = size + 220, Height = size + 220 };
        var gb = new RadialGradientBrush();
        gb.GradientStops.Add(new GradientStop { Offset = 0.45, Color = Theme.WithAlpha(tint.Color, 0.9) });
        gb.GradientStops.Add(new GradientStop { Offset = 1, Color = Color.FromArgb(0, 0, 0, 0) });
        glow.Fill = gb;
        var vignette = new RadialGradientBrush { Center = new Point(0.5, 0.4), GradientOrigin = new Point(0.5, 0.4) };
        vignette.GradientStops.Add(new GradientStop { Offset = 0.55, Color = Color.FromArgb(0, 0, 0, 0) });
        vignette.GradientStops.Add(new GradientStop { Offset = 1, Color = Theme.WithAlpha(Theme.C("MxBg"), 0.7) });
        figureSlot.Children.Add(glow);
        figureSlot.Children.Add(new Ellipse { Width = size, Height = size, Fill = new ImageBrush { ImageSource = photo, Stretch = Stretch.UniformToFill } });
        figureSlot.Children.Add(new Ellipse { Width = size, Height = size, Fill = vignette });
    }

    private static Button PlayPill(Action play)
    {
        var key = new Grid { Width = 36, Height = 36 };
        var kb = new RadialGradientBrush();
        kb.GradientStops.Add(new GradientStop { Offset = 0, Color = Theme.Parse("#8a96ff")!.Value });
        kb.GradientStops.Add(new GradientStop { Offset = 1, Color = Theme.Parse("#4f46e0")!.Value });
        key.Children.Add(new Ellipse { Fill = kb });
        key.Children.Add(new Icon("Play", 14, Theme.Hex(0xFFFFFFFFu)).Align(HorizontalAlignment.Center, VerticalAlignment.Center));
        var b = new Button
        {
            Content = M.H(14, key, M.T("ВКЛЮЧИТЬ АРТИСТА", 12.5, weight: FontWeights.SemiBold, spacing: 0.18).Align(HorizontalAlignment.Left, VerticalAlignment.Center)),
            CornerRadius = new CornerRadius(999), Padding = new Thickness(8, 8, 22, 8), Margin = new Thickness(0, 18, 0, 0),
            Background = Theme.WithAlphaBrush("MxSurface", 0.7), BorderBrush = Theme.B("MxBorderStrong"), BorderThickness = new Thickness(1),
        };
        b.Click += (_, _) => play();
        return b;
    }

    private static TextBlock Eyebrow(string s) => M.T(s.ToUpperInvariant(), 11, Theme.B("MxTextSubtle"), FontWeights.Medium, spacing: 0.22);

    private async Task LoadPage()
    {
        try
        {
            if (await App.Shared.Api.GetJsonAsync($"api/v2/artists/{id}/page") is not JsonObject page) return;
            var images = page["images"] as JsonObject;
            var artist = page["artist"];
            var imageId = artist?["imageId"]?.GetValue<string>();
            var vibrant = App.Shared.Palette(imageId)?.Vibrant ?? Theme.Parse(images?[imageId ?? ""]?["palette"]?["vibrant"]?.GetValue<string>());
            if (vibrant is { } v) SetTint(v);
            var hue = HueOf(vibrant ?? Theme.Parse("#d4a55a")!.Value);
            var topTracks = (page["topTracks"]?.AsArray() ?? []).OfType<JsonObject>().ToList();
            var genre = topTracks.Select(t => t["genre"]?.GetValue<string>()).OfType<string>().GroupBy(g => g).OrderByDescending(g => g.Count()).FirstOrDefault()?.Key;
            var origin = page["country"]?.GetValue<string>();
            tags.Text = string.Join(" · ", new[] { genre, origin is null ? null : (Flag(page["countryCode"]?.GetValue<string>()) + origin).Trim() }.OfType<string>()).ToUpperInvariant();
            var years = topTracks.Concat((page["appearsOn"]?.AsArray() ?? []).OfType<JsonObject>())
                .Select(t => t["year"] is JsonValue y && y.TryGetValue<int>(out var n) ? n : 0).Where(y => y > 0).ToList();
            if (years.Count > 0) decades.Text = $"Десятилетия в твоей библиотеке · {years.Min() / 10 * 10}s–{years.Max() / 10 * 10}s";
            var albumCount = page["albums"]?.AsArray().Count ?? 0;
            if (page["trackCount"] is JsonValue tc && tc.TryGetValue<int>(out var trackCount)) counts.Text = $"{Ru.Albums(albumCount)} · {Ru.Tracks(trackCount)}";
            if (Img.Pick(images, artist?["cutoutId"]?.GetValue<string>(), 900) is { } cutout)
            {
                burst = new ArtistBurst(hue) { Margin = new Thickness(-52, -140, -40, -180) };
                Grid.SetColumnSpan(burst, 2);
                hero.Children.Insert(0, burst);
                burst.EnableLean();
                figureSlot.Children.Clear();
                figure = new ArtistFigure(cutout, hue);
                figureSlot.Children.Add(figure);
            }
            else if (Img.Pick(images, imageId, 900) is { } photo) Portrait(new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(photo));

            var rows = topTracks.Take(10).Select(t => new TrackRow(
                t["id"]!.GetValue<string>(), t["titleDisplay"]?.GetValue<string>() ?? t["title"]!.GetValue<string>(), t["artistDisplay"]?.GetValue<string>() ?? "",
                t["album"]?.GetValue<string>(), t["durationMs"]?.GetValue<long>() ?? 0, t["coverImageId"]?.GetValue<string>(), null)).ToList();
            if (rows.Count == 0) return;
            var ids = rows.Select(t => t.Id).ToList();
            top.Children.Add(Eyebrow("Треки"));
            for (var i = 0; i < rows.Count; i++)
            {
                var line = new TrackLine(n => App.Shared.Player.PlayTracks(ids, n, "artist"));
                line.Bind(new At<TrackRow>(rows[i], i));
                top.Children.Add(line);
            }
        }
        catch (Exception) { /* offline: the mirror's part stands */ }
    }

    private static readonly (string Key, string Label)[] Dossier =
        [("name_origin", "Откуда название"), ("formed_place", "Откуда"), ("formed_year", "Год основания"), ("grammy_wins", "Грэмми"), ("status", "Статус"), ("active_from", "Активны с")];

    private async Task LoadBio()
    {
        try
        {
            if (await App.Shared.Api.GetJsonAsync($"api/v2/artists/{id}/bio") is not JsonObject b) return;
            if (b["text"]?.GetValue<string>() is { Length: > 0 } t)
            {
                var ai = new Border { CornerRadius = new CornerRadius(999), BorderBrush = Theme.Hex(0x809A7BFFu), BorderThickness = new Thickness(1), Padding = new Thickness(8, 2, 8, 2),
                    Child = M.T("AI", 9, Theme.Hex(0xFFB9A6FFu), spacing: 0.1), VerticalAlignment = VerticalAlignment.Center };
                var para = new TextBlock { Text = t, FontSize = 15.5, LineHeight = 25, TextWrapping = TextWrapping.WrapWholeWords, MaxWidth = 720, MaxLines = 6, TextTrimming = TextTrimming.WordEllipsis, HorizontalAlignment = HorizontalAlignment.Left };
                var more = new HyperlinkButton { Content = M.T("читать дальше ↓", 12.5, Theme.B("MxAccentLight")), Padding = new Thickness(0) };
                more.Click += (_, _) => { para.MaxLines = 0; more.Visibility = Visibility.Collapsed; };
                bio.Children.Add(M.H(10, Eyebrow("Биография").Align(HorizontalAlignment.Left, VerticalAlignment.Center), ai));
                bio.Children.Add(para);
                bio.Children.Add(more);
            }
            var facets = b["facets"] as JsonObject;
            var rows = Dossier.Select(d => (d.Label, Value: facets?[d.Key] is JsonValue v ? v.ToString() : null)).Where(r => !string.IsNullOrWhiteSpace(r.Value)).ToList();
            if (rows.Count == 0) return;
            dossier.Children.Add(Eyebrow("Досье"));
            foreach (var (label, value) in rows)
                dossier.Children.Add(M.V(4,
                    M.H(6, new Ellipse { Width = 6, Height = 6, Fill = new SolidColorBrush(Theme.Oklch(0.8, 0.15, 110)), VerticalAlignment = VerticalAlignment.Center },
                        M.T(label.ToUpperInvariant(), 10.5, Theme.B("MxTextSubtle"), FontWeights.SemiBold, spacing: 0.16)),
                    M.T(value!.Trim('"'), 13.5, wrap: true)));
            body.ColumnDefinitions[0].Width = new GridLength(280);
            ((FrameworkElement)body.Children[0]).Visibility = Visibility.Visible;
        }
        catch (Exception) { /* no bio yet, or offline */ }
    }

    private static double HueOf(Color c)
    {
        double r = c.R / 255.0, g = c.G / 255.0, b = c.B / 255.0, max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b)), d = max - min;
        if (d == 0) return 75;
        var h = max == r ? (g - b) / d % 6 : max == g ? (b - r) / d + 2 : (r - g) / d + 4;
        return (h * 60 + 360) % 360;
    }

    /// <summary>A flag from the ISO code (regional indicator letters).</summary>
    private static string Flag(string? cc) => cc is { Length: 2 }
        ? string.Concat(cc.ToUpperInvariant().Select(ch => char.ConvertFromUtf32(0x1F1E6 + ch - 'A'))) + " " : "";
}
