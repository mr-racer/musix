using Dapper;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Musix.App.Ui;

namespace Musix.App.Views;

/// <summary>
/// The library from the mirror — albums, artists, tracks, playlists — with a filter that
/// folds case and ё in C# (SQLite's lower() is ASCII only). It opens instantly offline.
/// </summary>
public sealed class LibraryView : Grid, IRefreshable
{
    private static string tab = "albums";
    private static string sort = "added";
    private readonly SelectorBar tabs = new();
    private readonly AutoSuggestBox filter = new() { PlaceholderText = "Найти в библиотеке", Width = 300, QueryIcon = new SymbolIcon(Symbol.Find) };
    private readonly ComboBox order = new() { MinWidth = 150 };
    private readonly ScrollViewer scroll = new() { Padding = new Thickness(40, 0, 40, 40) };
    private readonly TextBlock count = M.T("", 13, Theme.B("MxTextSubtle"), font: Theme.Mono);

    public LibraryView()
    {
        RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        foreach (var (key, text) in new[] { ("albums", "Альбомы"), ("artists", "Артисты"), ("tracks", "Треки"), ("playlists", "Плейлисты") })
            tabs.Items.Add(new SelectorBarItem { Text = text, Tag = key, IsSelected = key == tab });
        tabs.SelectionChanged += (_, _) => { tab = (string)tabs.SelectedItem.Tag; Refresh(); };
        foreach (var (key, text) in new[] { ("added", "Недавние"), ("title", "А–Я"), ("year", "По году") })
            order.Items.Add(new ComboBoxItem { Content = text, Tag = key });
        order.SelectedIndex = sort switch { "title" => 1, "year" => 2, _ => 0 };
        order.SelectionChanged += (_, _) => { sort = (string)((ComboBoxItem)order.SelectedItem).Tag; Refresh(); };
        filter.TextChanged += (_, e) => { if (e.Reason == AutoSuggestionBoxTextChangeReason.UserInput) Refresh(); };
        var head = new Grid { Padding = new Thickness(40, 36, 40, 18), RowSpacing = 14 };
        head.RowDefinitions.Add(new RowDefinition());
        head.RowDefinitions.Add(new RowDefinition());
        var title = M.H(16, M.T("Библиотека", 34, font: Theme.Display), count.Align(HorizontalAlignment.Left, VerticalAlignment.Bottom).Margin(0, 0, 0, 7));
        var tools = M.H(12, filter, order);
        tools.HorizontalAlignment = HorizontalAlignment.Right;
        head.Children.Add(title);
        head.Children.Add(tools);
        Grid.SetRow(tabs, 1);
        head.Children.Add(tabs);
        SetRow(scroll, 1);
        Children.Add(head);
        Children.Add(scroll);
        Refresh();
    }

    private static string Fold(string s) => s.Replace('ё', 'е').Replace('Ё', 'Е');

    private bool Match(params string?[] fields)
    {
        var q = Fold(filter.Text.Trim());
        return q.Length == 0 || q.Split(' ', StringSplitOptions.RemoveEmptyEntries).All(w => fields.Any(f => f is not null && Fold(f).Contains(w, StringComparison.OrdinalIgnoreCase)));
    }

    public void Refresh()
    {
        var c = App.Shared.Db.Conn;
        order.Visibility = tab == "albums" ? Visibility.Visible : Visibility.Collapsed;
        switch (tab)
        {
            case "albums":
                var orderBy = sort switch { "title" => "a.title COLLATE NOCASE", "year" => "a.year DESC, a.title", _ => "7 DESC" };
                var albums = c.Query<AlbumRow>($"""
                    SELECT a.id, a.title, a.year, a.cover_image_id, coalesce(ar.name, min(t.artist)), count(t.id), max(t.added_at)
                    FROM albums a JOIN tracks t ON t.album_id = a.id LEFT JOIN artists ar ON ar.id = a.album_artist_id
                    GROUP BY a.id ORDER BY {orderBy}
                    """).Where(a => Match(a.Title, a.Artist)).ToList();
                count.Text = Ru.Albums(albums.Count);
                Show(albums, new Factory<AlbumRow, AlbumTile>(() => new AlbumTile()), new UniformGridLayout { MinItemWidth = 180, MinColumnSpacing = 22, MinRowSpacing = 26 });
                break;
            case "artists":
                var artists = c.Query<ArtistRow>("""
                    SELECT ar.id, ar.name, ar.image_id, count(ta.track_id) AS n FROM artists ar JOIN track_artists ta ON ta.artist_id = ar.id
                    GROUP BY ar.id ORDER BY n DESC
                    """).Where(a => Match(a.Name)).ToList();
                count.Text = Ru.Plural(artists.Count, "артист", "артиста", "артистов");
                Show(artists, new Factory<ArtistRow, ArtistTile>(() => new ArtistTile()), new UniformGridLayout { MinItemWidth = 160, MinColumnSpacing = 22, MinRowSpacing = 26 });
                break;
            case "tracks":
                var tracks = c.Query<TrackRow>("SELECT id, title, artist, album, duration_ms, cover_image_id, track_no FROM tracks ORDER BY added_at DESC")
                    .Where(t => Match(t.Title, t.Artist, t.Album)).ToList();
                var ids = tracks.Select(t => t.Id).ToList();
                count.Text = Ru.Tracks(tracks.Count);
                Show(tracks.Select((t, i) => new At<TrackRow>(t, i)).ToList(),
                    new Factory<At<TrackRow>, TrackLine>(() => new TrackLine(i => App.Shared.Player.PlayTracks(ids, i, "library"))), new StackLayout { Spacing = 2 });
                break;
            default:
                var lists = c.Query<PlaylistRow>("SELECT id, name, cover_image_id, item_count FROM playlists ORDER BY updated_at DESC").Where(p => Match(p.Name)).ToList();
                count.Text = Ru.Plural(lists.Count, "плейлист", "плейлиста", "плейлистов");
                Show(lists.Select(p => new AlbumRow(p.Id, p.Name, null, p.Cover, Ru.Tracks(p.N), p.N, 0)).ToList(),
                    new Factory<AlbumRow, AlbumTile>(() => new AlbumTile(playlist: true)), new UniformGridLayout { MinItemWidth = 180, MinColumnSpacing = 22, MinRowSpacing = 26 });
                break;
        }
    }

    private void Show(object items, IElementFactory template, Layout layout) =>
        scroll.Content = new ItemsRepeater { ItemsSource = items, ItemTemplate = template, Layout = layout };
}
