using System.Numerics;
using System.Text.Json.Nodes;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Musix.Core.Store;

namespace Musix.App.Ui;


/// <summary>An item and its place in the list it was shown in (a tap plays the list from there).</summary>
public sealed record At<T>(T Item, int Index);

public interface IBind<in T>
{
    void Bind(T item);
}

/// <summary>
/// The ItemsRepeater's element factory, in code: elements are recycled through a pool and
/// re-bound, so a library of thousands of albums keeps a screenful of live tiles.
/// </summary>
public sealed class Factory<TItem, TEl>(Func<TEl> make) : IElementFactory where TEl : FrameworkElement, IBind<TItem>
{
    private readonly Stack<TEl> pool = new();

    public UIElement GetElement(ElementFactoryGetArgs args)
    {
        var e = pool.Count > 0 ? pool.Pop() : make();
        e.Bind((TItem)args.Data);
        return e;
    }

    public void RecycleElement(ElementFactoryRecycleArgs args) => pool.Push((TEl)args.Element);
}

public static class Img
{
    /// <summary>The smallest signed URL at least <paramref name="px"/> wide from an `images` map of a screen answer.</summary>
    public static Uri? Pick(JsonObject? images, string? id, int px)
    {
        if (id is null || images?[id]?["urls"] is not JsonObject urls) return null;
        var all = urls.Select(kv => (Px: int.TryParse(kv.Key, out var p) ? p : 0, Url: kv.Value?.GetValue<string>())).OrderBy(x => x.Px).ToList();
        var url = all.FirstOrDefault(x => x.Px >= px).Url ?? all.LastOrDefault().Url;
        return url is null ? null : new Uri(url);
    }

    public static ImageSource? Source(string? id, int px, JsonObject? images = null) =>
        (App.Shared.CoverUrl(id, px) ?? Pick(images, id, px)) is { } u ? new BitmapImage(u) { DecodePixelWidth = px } : null;

    public static ImageSource? File(string? path, int px) =>
        path is null ? null : new BitmapImage(new Uri(path)) { DecodePixelWidth = px };

    /// <summary>A rounded cover over the placeholder tint, so an empty or loading cover still has its shape.</summary>
    public static (Border Frame, Image Image) Cover(double size, double radius)
    {
        var img = new Image { Stretch = Stretch.UniformToFill };
        var b = new Border { Width = size, Height = size, CornerRadius = new CornerRadius(radius), Background = Theme.B("MxSurface2"), Child = img };
        return (b, img);
    }

    /// <summary>v1's hover: the tile lifts a little (an implicit scale transition, no storyboard).</summary>
    public static void Lift(FrameworkElement e, float to = 1.035f)
    {
        e.ScaleTransition = new Vector3Transition { Duration = TimeSpan.FromMilliseconds(220) };
        e.SizeChanged += (_, _) => e.CenterPoint = new Vector3((float)e.ActualWidth / 2, (float)e.ActualHeight / 2, 0);
        e.PointerEntered += (_, _) => e.Scale = new Vector3(to, to, 1);
        e.PointerExited += (_, _) => e.Scale = Vector3.One;
        e.PointerCanceled += (_, _) => e.Scale = Vector3.One;
    }

    public static string Clock(long ms) => ms <= 0 ? "" : $"{ms / 60000}:{ms / 1000 % 60:00}";
}

/// <summary>
/// An album in a grid, as v1's card (AtlasAlbumCard). On hover the record slides out from
/// behind the sleeve and turns, and the sleeve leans back with a violet glow. A tap opens the
/// gatefold from this cover. Playlist tiles keep the plain lift.
/// </summary>
public sealed class AlbumTile : StackPanel, IBind<AlbumRow>
{
    private readonly Image image;
    private readonly Border sleeve;
    private readonly Grid deck;
    private readonly Microsoft.UI.Xaml.Shapes.Rectangle glow = new() { Margin = new Thickness(-26), Opacity = 0, IsHitTestVisible = false };
    private readonly TextBlock title = M.T("", 14, weight: FontWeights.SemiBold);
    private readonly TextBlock sub = M.T("", 12.5, Theme.B("MxTextMuted"));
    private readonly double size;
    private Vinyl? disc;  // made on the first hover, so a grid of hundreds keeps no records
    private AlbumRow? row;

    public AlbumTile(double size = 180, bool playlist = false)
    {
        this.size = size;
        Spacing = 8;
        Width = size;
        var (frame, img) = Img.Cover(size, 12);
        image = img;
        sleeve = frame;
        var sheen = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0, 0.1), EndPoint = new Windows.Foundation.Point(1, 0.9) };
        sheen.GradientStops.Add(new GradientStop { Offset = 0, Color = Windows.UI.Color.FromArgb(36, 255, 255, 255) });
        sheen.GradientStops.Add(new GradientStop { Offset = 0.34, Color = Windows.UI.Color.FromArgb(0, 255, 255, 255) });
        sheen.GradientStops.Add(new GradientStop { Offset = 0.68, Color = Windows.UI.Color.FromArgb(0, 0, 0, 0) });
        sheen.GradientStops.Add(new GradientStop { Offset = 1, Color = Windows.UI.Color.FromArgb(56, 0, 0, 0) });
        frame.Child = null;  // the image moves under the sheen; WinUI refuses an element that still has a parent (0x800F1000)
        frame.Child = new Grid { Children = { img, new Microsoft.UI.Xaml.Shapes.Rectangle { Fill = sheen, IsHitTestVisible = false } } };
        var g = new RadialGradientBrush();
        g.GradientStops.Add(new GradientStop { Offset = 0.45, Color = Windows.UI.Color.FromArgb(82, 124, 91, 255) });
        g.GradientStops.Add(new GradientStop { Offset = 1, Color = Windows.UI.Color.FromArgb(0, 124, 91, 255) });
        glow.Fill = g;
        glow.OpacityTransition = new ScalarTransition { Duration = TimeSpan.FromMilliseconds(500) };
        deck = new Grid { Width = size, Height = size, Children = { glow, frame } };
        Children.Add(deck);
        Children.Add(M.V(2, title, sub));
        if (playlist) Img.Lift(this);
        else
        {
            sleeve.TranslationTransition = new Vector3Transition { Duration = TimeSpan.FromMilliseconds(500) };
            sleeve.RotationTransition = new ScalarTransition { Duration = TimeSpan.FromMilliseconds(500) };
            sleeve.CenterPoint = new Vector3((float)size / 2, (float)size / 2, 0);
            PointerEntered += (_, _) => Hover(true);
            PointerExited += (_, _) => Hover(false);
            PointerCanceled += (_, _) => Hover(false);
        }
        Tapped += (_, _) =>
        {
            if (row is not { } r) return;
            if (playlist) App.Shared.Window.Go(() => new Views.PlaylistView(r.Id));
            else App.Shared.Window.OpenAlbum(r.Id, sleeve);
        };
    }

    /// <summary>The hover state without a pointer (the smoke tour's screenshot).</summary>
    internal void ShowRecord() => Hover(true);

    private void Hover(bool on)
    {
        if (on && disc is null && row is not null)
        {
            var d = size * 0.92;
            disc = new Vinyl(d, row.Cover)
            {
                HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(size * 0.06, size * 0.04, 0, 0),
                Translation = new Vector3(6, 0, 0), CenterPoint = new Vector3((float)d / 2, (float)d / 2, 0),
                TranslationTransition = new Vector3Transition { Duration = TimeSpan.FromMilliseconds(500) },
                RotationTransition = new ScalarTransition { Duration = TimeSpan.FromMilliseconds(500) },
            };
            deck.Children.Insert(1, disc);  // behind the sleeve
        }
        Canvas.SetZIndex(this, on ? 12 : 0);  // the record slides over the next tile
        if (disc is not null)
        {
            disc.Translation = on ? new Vector3((float)(size * 0.92 * 0.52), 0, 0) : new Vector3(6, 0, 0);
            disc.Rotation = on ? 10 : 0;
            disc.Spin(on);
        }
        sleeve.Translation = on ? new Vector3(-7, 0, 0) : Vector3.Zero;
        sleeve.Rotation = on ? -2 : 0;
        glow.Opacity = on ? 1 : 0;
    }

    public void Bind(AlbumRow r)
    {
        if (row?.Id != r.Id && disc is not null) { deck.Children.Remove(disc); disc = null; }  // a recycled tile: the label's colours change
        row = r;
        title.Text = r.Title;
        sub.Text = r.Year is { } y ? $"{r.Artist} · {y}" : r.Artist;
        image.Source = Img.Source(r.Cover, 256);
    }
}

public sealed class ArtistTile : StackPanel, IBind<ArtistRow>
{
    private readonly ImageBrush photo = new() { Stretch = Stretch.UniformToFill };
    private readonly TextBlock name = M.T("", 14, weight: FontWeights.SemiBold);
    private readonly TextBlock sub = M.T("", 12.5, Theme.B("MxTextMuted"));
    private ArtistRow? row;

    public ArtistTile(double size = 160)
    {
        Spacing = 8;
        Width = size;
        Children.Add(new Microsoft.UI.Xaml.Shapes.Ellipse { Width = size, Height = size, Fill = photo, Stroke = Theme.B("MxBorder"), StrokeThickness = 1 });
        name.HorizontalAlignment = sub.HorizontalAlignment = HorizontalAlignment.Center;
        Children.Add(M.V(2, name, sub));
        Img.Lift(this);
        Tapped += (_, _) => { if (row is { } r) App.Shared.Window.Go(() => new Views.ArtistView(r.Id, r.Name)); };
    }

    public void Bind(ArtistRow r)
    {
        row = r;
        name.Text = r.Name;
        sub.Text = Ru.Tracks(r.N);
        photo.ImageSource = Img.Source(r.Image, 256);
    }
}

/// <summary>A track line: number or cover, title over artist, album, duration; a tap plays the list from it.</summary>
public sealed class TrackLine : Grid, IBind<At<TrackRow>>
{
    private readonly TextBlock no = M.T("", 12.5, Theme.B("MxTextSubtle"), font: Theme.Mono);
    private readonly Image image;
    private readonly Border frame;
    private readonly TextBlock title = M.T("", 14, weight: FontWeights.Medium);
    private readonly TextBlock artist = M.T("", 12.5, Theme.B("MxTextMuted"));
    private readonly TextBlock album = M.T("", 12.5, Theme.B("MxTextMuted"));
    private readonly TextBlock dur = M.T("", 12.5, Theme.B("MxTextSubtle"), font: Theme.Mono);
    private At<TrackRow>? at;

    public TrackLine(Action<int> play, bool numbered = false)
    {
        Padding = new Thickness(10, 7, 14, 7);
        CornerRadius = new CornerRadius(10);
        ColumnSpacing = 14;
        Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(numbered ? 28 : 44) });
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(3, GridUnitType.Star) });
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        (frame, image) = Img.Cover(44, 8);
        UIElement lead = numbered ? no.Align(HorizontalAlignment.Right, VerticalAlignment.Center) : frame;
        var names = M.V(1, title, artist);
        names.VerticalAlignment = album.VerticalAlignment = dur.VerticalAlignment = VerticalAlignment.Center;
        SetColumn(names, 1); SetColumn(album, 2); SetColumn(dur, 3);
        Children.Add(lead); Children.Add(names); Children.Add(album); Children.Add(dur);
        PointerEntered += (_, _) => Background = Theme.B("MxSurface");
        PointerExited += (_, _) => Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        Tapped += (_, _) => { if (at is { } a) play(a.Index); };
    }

    public void Bind(At<TrackRow> a)
    {
        at = a;
        var t = a.Item;
        no.Text = t.TrackNo?.ToString() ?? "";
        title.Text = t.Title;
        artist.Text = t.Artist;
        album.Text = t.Album ?? "";
        dur.Text = Img.Clock(t.DurationMs);
        if (frame.Visibility == Visibility.Visible) image.Source = Img.Source(t.Cover, 96);
        var playing = App.Shared.Player.Current?.ServerTrackId == t.Id;
        title.Foreground = playing ? Theme.B("MxAccent") : Theme.B("MxText");
    }
}

public static class Ru
{
    /// <summary>Russian plural: 1 трек, 2 трека, 5 треков.</summary>
    public static string Plural(long n, string one, string few, string many)
    {
        var m10 = n % 10; var m100 = n % 100;
        var w = m10 == 1 && m100 != 11 ? one : m10 is >= 2 and <= 4 && m100 is < 12 or > 14 ? few : many;
        return $"{n} {w}";
    }

    public static string Tracks(long n) => Plural(n, "трек", "трека", "треков");
    public static string Albums(long n) => Plural(n, "альбом", "альбома", "альбомов");
    public static string Minutes(long ms) => ms >= 3_600_000 ? $"{ms / 3_600_000} ч {ms / 60000 % 60} мин" : $"{ms / 60000} мин";
}
