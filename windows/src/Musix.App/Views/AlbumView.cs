using Musix.Core.Store;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Animation;
using Musix.App.Ui;

namespace Musix.App.Views;

/// <summary>An album from the mirror (offline as well): the cover flies in from the tile it was opened from.</summary>
public sealed class AlbumView : UserControl, IRefreshable
{
    private readonly string id;
    private readonly StackPanel body = M.V(26);

    public AlbumView(string id)
    {
        this.id = id;
        body.Padding = new Thickness(40, 36, 40, 40);
        Content = new ScrollViewer { Content = body };
        Refresh();
    }

    public void Refresh()
    {
        body.Children.Clear();
        var m = App.Shared.Mirror;
        var a = m.Album(id);
        if (a is null) { body.Children.Add(M.T("Альбома больше нет в библиотеке", 15, Theme.B("MxTextMuted"))); return; }
        var tracks = m.AlbumTracks(id).ToList();
        var ids = tracks.Select(t => t.Id).ToList();
        var (frame, image) = Img.Cover(232, 18);
        image.Source = Img.Source(a.Cover, 512);
        image.Loaded += (_, _) =>
        {
            try { ConnectedAnimationService.GetForCurrentView().GetAnimation("cover")?.TryStart(image); } catch (Exception) { }
        };
        var artist = new HyperlinkButton { Content = M.T(a.Artist ?? tracks.FirstOrDefault()?.Artist ?? "", 15, Theme.B("MxTextMuted")), Padding = new Thickness(0) };
        if (a.ArtistId is { } aid) artist.Click += (_, _) => App.Shared.Window.Go(() => new ArtistView(aid, a.Artist ?? ""));
        var facts = string.Join(" · ", new[] { a.Year?.ToString(), Ru.Tracks(tracks.Count), Ru.Minutes(tracks.Sum(t => t.DurationMs)) }.Where(s => s is not null));
        var play = M.Btn(M.H(8, new FontIcon { Glyph = "", FontSize = 14 }, M.T("Слушать", 14, weight: FontWeights.SemiBold)), () => App.Shared.Player.PlayTracks(ids, 0, "album"), accent: true);
        var shuffle = M.Btn(M.H(8, new FontIcon { Glyph = "", FontSize = 14 }, M.T("Вперемешку", 14)), () => App.Shared.Player.PlayTracks(ids.OrderBy(_ => Random.Shared.Next()).ToList(), 0, "album"));
        var head = M.H(32, frame, M.V(10,
            M.Eyebrow("Альбом"),
            M.T(a.Title, 40, weight: FontWeights.Normal, font: Theme.Display, wrap: true),
            artist,
            M.T(facts, 13, Theme.B("MxTextSubtle"), font: Theme.Mono),
            M.H(10, play, shuffle).Margin(0, 10, 0, 0)).Align(HorizontalAlignment.Left, VerticalAlignment.Bottom));
        body.Children.Add(head);
        var list = new ItemsRepeater
        {
            ItemsSource = tracks.Select((t, i) => new At<TrackRow>(t, i)).ToList(),
            ItemTemplate = new Factory<At<TrackRow>, TrackLine>(() => new TrackLine(i => App.Shared.Player.PlayTracks(ids, i, "album"), numbered: true)),
            Layout = new StackLayout { Spacing = 2 },
        };
        body.Children.Add(list);
    }
}
