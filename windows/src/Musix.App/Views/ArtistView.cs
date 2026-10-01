using System.Text.Json.Nodes;
using Dapper;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Musix.App.Ui;

namespace Musix.App.Views;

/// <summary>An artist: the mirror's albums at once, the server's page (most played, the origin) when it answers.</summary>
public sealed class ArtistView : UserControl
{
    private readonly string id;
    private readonly StackPanel body = M.V(28);
    private readonly StackPanel top = M.V(4);
    private readonly TextBlock origin = M.T("", 13, Theme.B("MxTextSubtle"), font: Theme.Mono);

    public ArtistView(string id, string name)
    {
        this.id = id;
        body.Padding = new Thickness(40, 36, 40, 40);
        Content = new ScrollViewer { Content = body };
        var c = App.Shared.Db.Conn;
        var image = c.QuerySingleOrDefault<string?>("SELECT image_id FROM artists WHERE id = @id", new { id });
        var albums = c.Query<AlbumRow>("""
            SELECT a.id, a.title, a.year, a.cover_image_id, @name, count(t.id), max(t.added_at)
            FROM albums a JOIN tracks t ON t.album_id = a.id WHERE a.album_artist_id = @id GROUP BY a.id ORDER BY a.year DESC
            """, new { id, name }).ToList();
        var ids = c.Query<string>("""
            SELECT t.id FROM tracks t JOIN track_artists ta ON ta.track_id = t.id WHERE ta.artist_id = @id ORDER BY t.album, t.disc_no, t.track_no
            """, new { id }).ToList();
        var photo = new Microsoft.UI.Xaml.Shapes.Ellipse { Width = 168, Height = 168, Fill = new ImageBrush { ImageSource = Img.Source(image, 512), Stretch = Stretch.UniformToFill } };
        var play = M.Btn(M.H(8, new FontIcon { Glyph = "", FontSize = 14 }, M.T("Слушать всё", 14, weight: FontWeights.SemiBold)),
            () => App.Shared.Player.PlayTracks(ids.OrderBy(_ => Random.Shared.Next()).ToList(), 0, "artist"), accent: true);
        body.Children.Add(M.H(30, photo, M.V(10,
            M.Eyebrow("Артист"),
            M.T(name, 48, font: Theme.Display, wrap: true),
            origin,
            M.T($"{Ru.Tracks(ids.Count)} · {Ru.Albums(albums.Count)}", 13, Theme.B("MxTextSubtle"), font: Theme.Mono),
            play.Margin(0, 8, 0, 0)).Align(HorizontalAlignment.Left, VerticalAlignment.Center)));
        body.Children.Add(top);
        if (albums.Count > 0)
        {
            body.Children.Add(M.Eyebrow("Альбомы"));
            body.Children.Add(new ItemsRepeater
            {
                ItemsSource = albums,
                ItemTemplate = new Factory<AlbumRow, AlbumTile>(() => new AlbumTile()),
                Layout = new UniformGridLayout { MinItemWidth = 180, MinColumnSpacing = 22, MinRowSpacing = 26 },
            });
        }
        _ = LoadPage();
    }

    private async Task LoadPage()
    {
        try
        {
            if (await App.Shared.Api.GetJsonAsync($"api/v2/artists/{id}/page") is not JsonObject page) return;
            if (page["country"]?.GetValue<string>() is { } country) origin.Text = Flag(page["countryCode"]?.GetValue<string>()) + country;
            var tracks = (page["topTracks"]?.AsArray() ?? []).OfType<JsonObject>().Take(5).Select(t => new TrackRow(
                t["id"]!.GetValue<string>(), t["titleDisplay"]?.GetValue<string>() ?? t["title"]!.GetValue<string>(), t["artistDisplay"]?.GetValue<string>() ?? "",
                t["album"]?.GetValue<string>(), t["durationMs"]?.GetValue<long>() ?? 0, t["coverImageId"]?.GetValue<string>(), null)).ToList();
            if (tracks.Count == 0) return;
            var ids = tracks.Select(t => t.Id).ToList();
            top.Children.Add(M.Eyebrow("Вы слушаете чаще всего").Margin(0, 0, 0, 8));
            for (var i = 0; i < tracks.Count; i++)
            {
                var line = new TrackLine(n => App.Shared.Player.PlayTracks(ids, n, "artist"));
                line.Bind(new At<TrackRow>(tracks[i], i));
                top.Children.Add(line);
            }
        }
        catch (Exception) { /* offline: the mirror's part stands */ }
    }

    /// <summary>A flag from the ISO code (regional indicator letters).</summary>
    private static string Flag(string? cc) => cc is { Length: 2 }
        ? string.Concat(cc.ToUpperInvariant().Select(ch => char.ConvertFromUtf32(0x1F1E6 + ch - 'A'))) + "  " : "";
}
