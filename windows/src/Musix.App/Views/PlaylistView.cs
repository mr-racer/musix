using Musix.Core.Store;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Musix.App.Ui;

namespace Musix.App.Views;

/// <summary>A playlist from the mirror, in its fractional-position order.</summary>
public sealed class PlaylistView : UserControl, IRefreshable
{
    private readonly string id;
    private readonly StackPanel body = M.V(26);

    public PlaylistView(string id)
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
        var p = m.Playlist(id);
        if (p is null) { body.Children.Add(M.T("Плейлист удалён", 15, Theme.B("MxTextMuted"))); return; }
        var tracks = m.PlaylistTracks(id).ToList();
        var ids = tracks.Select(t => t.Id).ToList();
        var (frame, image) = Img.Cover(200, 18);
        image.Source = Img.Source(p.Cover ?? tracks.FirstOrDefault()?.Cover, 512);
        var play = M.Btn(M.H(8, new FontIcon { Glyph = "", FontSize = 14 }, M.T("Слушать", 14, weight: FontWeights.SemiBold)),
            () => App.Shared.Player.PlayTracks(ids, 0, "playlist"), accent: true);
        var info = M.V(10, M.Eyebrow("Плейлист"), M.T(p.Name, 40, font: Theme.Display, wrap: true));
        if (!string.IsNullOrWhiteSpace(p.Description)) info.Children.Add(M.T(p.Description, 14, Theme.B("MxTextMuted"), wrap: true));
        info.Children.Add(M.T($"{Ru.Tracks(tracks.Count)} · {Ru.Minutes(tracks.Sum(t => t.DurationMs))}", 13, Theme.B("MxTextSubtle"), font: Theme.Mono));
        info.Children.Add(play.Margin(0, 10, 0, 0));
        body.Children.Add(M.H(32, frame, info.Align(HorizontalAlignment.Left, VerticalAlignment.Bottom)));
        body.Children.Add(new ItemsRepeater
        {
            ItemsSource = tracks.Select((t, i) => new At<TrackRow>(t, i)).ToList(),
            ItemTemplate = new Factory<At<TrackRow>, TrackLine>(() => new TrackLine(i => App.Shared.Player.PlayTracks(ids, i, "playlist"))),
            Layout = new StackLayout { Spacing = 2 },
        });
    }
}
