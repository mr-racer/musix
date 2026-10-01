using System.Text;
using Dapper;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Musix.App.Ui;
using Microsoft.UI.Xaml.Media.Imaging;
using Musix.App.Views;
using Musix.Core.Local;
using Windows.Graphics.Imaging;
using System.Runtime.InteropServices.WindowsRuntime;

namespace Musix.App.Services;

/// <summary>
/// `MusiX.exe --smoke &lt;dir&gt;` is CI's tour of every screen, because this app is written
/// on Linux and can't be run there. Steps:
/// 1. seed a throwaway mirror (albums, artists, tracks, playlists, covers from a local file);
/// 2. queue a generated silent WAV, so the player has a track;
/// 3. open each page, render it to `&lt;n&gt;-&lt;page&gt;.png`, and record any exception without dying;
/// 4. write `report.txt` and exit 0 when every page opened, 1 otherwise.
/// The library crash (Dapper's name mapping, 2026-10-01) only showed with rows: hence the seed.
/// </summary>
public static class Smoke
{
    public static string? Dir { get; set; }
    public static string? Page { get; private set; }
    private static readonly StringBuilder Report = new();
    private static int failures;

    public static void Failed(string where, Exception? e)
    {
        failures++;
        Note($"FAIL {Page ?? where}: {e?.GetType().Name}: {e?.Message}\n{e?.StackTrace}");
    }

    /// <summary>The report grows page by page, so a crash that takes the process down still leaves its trail.</summary>
    private static void Note(string line)
    {
        Report.AppendLine(line);
        try { if (Dir is not null) File.AppendAllText(Path.Combine(Dir, "report.txt"), line + "\n"); } catch (Exception) { }
    }

    public static void Seed(App app)
    {
        var c = app.Db.Conn;
        var cover = new Uri(Path.Combine(AppContext.BaseDirectory, "Assets", "musix.png")).AbsoluteUri;
        var urls = $$"""{"256": "{{cover}}", "512": "{{cover}}"}""";
        var palettes = new[] { "#7c5bff", "#d4783a", "#3aa7d4", "#c23b6e", "#5bbf6a", "#e0b341" };
        for (var i = 1; i <= 6; i++)
        {
            var pal = new System.Text.Json.Nodes.JsonObject
            {
                ["dominant"] = palettes[i - 1], ["vibrant"] = palettes[i - 1], ["muted"] = "#6b5a50",
                ["accent"] = new System.Text.Json.Nodes.JsonObject { ["dark"] = $"hsl({i * 50}, 55%, 38%)", ["light"] = $"hsl({i * 50}, 55%, 32%)" },
            }.ToJsonString();
            c.Execute("INSERT OR REPLACE INTO images(id, urls_json, palette_json, gen) VALUES (@id, @urls, @pal, 1)", new { id = $"img{i}", urls, pal });
        }
        c.Execute("INSERT OR REPLACE INTO artists(id, name, sort_name, image_id, gen) VALUES ('ar1', 'Massive Attack', 'massive attack', 'img1', 1), ('ar2', 'Земфира', 'земфира', 'img2', 1)");
        var albums = new[] { ("al1", "Mezzanine", 1998, "ar1", "img3"), ("al2", "Protection", 1994, "ar1", "img4"), ("al3", "Вендетта", 2005, "ar2", "img5") };
        foreach (var (id, title, year, artist, img) in albums)
            c.Execute("INSERT OR REPLACE INTO albums(id, title, year, album_artist_id, cover_image_id, gen) VALUES (@id, @title, @year, @artist, @img, 1)", new { id, title, year, artist, img });
        var n = 0;
        foreach (var (album, title, _, artist, img) in albums)
        {
            for (var k = 1; k <= 4; k++)
            {
                var id = $"t{++n}";
                var name = artist == "ar1" ? "Massive Attack" : "Земфира";
                c.Execute("""
                    INSERT OR REPLACE INTO tracks(id, title, sort_title, artist, artists_json, album_id, album, year, duration_ms, track_no, disc_no, cover_image_id, added_at, gen)
                    VALUES (@id, @t, @t, @name, @json, @album, @title, 2000, 240000, @k, 1, @img, @n, 1)
                    """, new { id, t = $"{title} — трек {k}", name, json = $$"""[{"id":"{{artist}}","name":"{{name}}"}]""", album, title, k, img, n });
                c.Execute("INSERT OR REPLACE INTO track_artists(track_id, artist_id, ord) VALUES (@id, @artist, 0)", new { id, artist });
            }
        }
        // the home page's last `/home` answer, as the store keeps it (the tour is offline)
        app.Db.PutKv("home.json", """
            {"wave": {"phrase": "Громкий вокальный рок и хип-хоп уступают место атмосферному электронному свингу"},
             "counts": {"albums": 516, "tracks": 5961},
             "recentlyAdded": [{"id": "t1", "coverImageId": "img3"}, {"id": "t5", "coverImageId": "img4"}, {"id": "t9", "coverImageId": "img5"}],
             "anchors": [{"id": "t1", "title": "Teardrop", "artistDisplay": "Massive Attack", "coverImageId": "img3", "artists": [{"id": "ar1", "name": "Massive Attack"}]},
                         {"id": "t5", "title": "Karmacoma", "artistDisplay": "Massive Attack", "coverImageId": "img4", "artists": [{"id": "ar1", "name": "Massive Attack"}]},
                         {"id": "t9", "title": "Хочешь?", "artistDisplay": "Земфира", "coverImageId": "img5", "artists": [{"id": "ar2", "name": "Земфира"}]}],
             "vibes": [{"id": "v1", "name": "Поповый рок", "tracks": [{"id": "t1", "coverImageId": "img3"}]},
                       {"id": "v2", "name": "Электронный хип-хоп", "tracks": [{"id": "t5", "coverImageId": "img4"}]},
                       {"id": "v3", "name": "Детский электробит", "tracks": [{"id": "t9", "coverImageId": "img5"}]}],
             "pulse": {"playedMs": 14820000, "dailyMs": [5400000, 9420000, 0, 0, 0, 0, 0], "topGenre": "Hip-Hop", "discoveries": 59}}
            """);
        c.Execute("INSERT OR REPLACE INTO playlists(id, name, description, cover_image_id, item_count, created_at, updated_at, gen) VALUES ('p1', 'Для дороги', 'Смоук', 'img6', 3, 0, 0, 1)");
        c.Execute("INSERT OR REPLACE INTO playlist_items(item_id, playlist_id, track_id, position, added_at, gen) VALUES ('i1','p1','t1','a',0,1), ('i2','p1','t5','b',0,1), ('i3','p1','t9','c',0,1)");
    }

    /// <summary>A 30 s silent 16-bit WAV, so the player has a real current item with no network.</summary>
    private static string SilentWav(string dir)
    {
        var path = Path.Combine(dir, "silence.wav");
        const int rate = 44100, seconds = 30;
        var data = rate * 2 * seconds;
        using var w = new BinaryWriter(File.Create(path));
        w.Write("RIFF"u8.ToArray()); w.Write(36 + data); w.Write("WAVE"u8.ToArray());
        w.Write("fmt "u8.ToArray()); w.Write(16); w.Write((short)1); w.Write((short)1); w.Write(rate); w.Write(rate * 2); w.Write((short)2); w.Write((short)16);
        w.Write("data"u8.ToArray()); w.Write(data); w.Write(new byte[data]);
        return path;
    }

    public static async void Run(App app)
    {
        var dir = Dir!;
        Directory.CreateDirectory(dir);
        File.Delete(Path.Combine(dir, "report.txt"));
        var win = app.Window;
        var wav = SilentWav(dir);
        PlayerView? player = null;
        var pages = new (string Name, Action Open, int Settle)[]
        {
            ("home", () => win.Go(() => new HomeView(), root: true), 2000),
            ("library-albums", () => { LibraryView.Tab = "albums"; win.Go(() => new LibraryView(), root: true); }, 2000),
            ("library-artists", () => { LibraryView.Tab = "artists"; win.Go(() => new LibraryView(), root: true); }, 2000),
            ("library-tracks", () => { LibraryView.Tab = "tracks"; win.Go(() => new LibraryView(), root: true); }, 2000),
            ("library-playlists", () => { LibraryView.Tab = "playlists"; win.Go(() => new LibraryView(), root: true); }, 2000),
            ("gatefold", () => { LibraryView.Tab = "albums"; win.Go(() => new LibraryView(), root: true); win.OpenAlbum("al1", null); }, 1800),
            ("album-deck", () =>
            {
                win.CloseAlbum();
                var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 22, Padding = new Thickness(40) };
                foreach (var a in app.Mirror.Albums()) { var t = new AlbumTile(); t.Bind(a); row.Children.Add(t); }
                row.Loaded += (_, _) => ((AlbumTile)row.Children[0]).ShowRecord();
                win.Go(() => row, root: true);
            }, 1500),
            // the cutout hero with the app icon standing in for an artist's transparent PNG
            ("artist-burst", () => win.Go(() => new Grid
            {
                Children =
                {
                    new ArtistBurst(285),
                    new ArtistFigure(new Uri(Path.Combine(AppContext.BaseDirectory, "Assets", "musix.png")), 285) { HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 0, 80, 0) },
                },
            }, root: true), 2000),
            ("artist", () => { win.CloseAlbum(); win.Go(() => new ArtistView("ar1", "Massive Attack")); }, 2000),
            ("playlist", () => win.Go(() => new PlaylistView("p1")), 2000),
            ("local", () => win.Go(() => new LocalView(), root: true), 2000),
            ("search", () => win.Go(() => new SearchView("massive"), root: true), 2000),
            ("settings", () => win.Go(() => new SettingsView(), root: true), 2000),
            ("player", () =>
            {
                var names = new[] { "Teardrop", "Angel", "Inertia Creeps", "Dissolved Girl" };
                app.Player.PlayLocal(names.Select((t, k) => new LocalTrack(k + 1, wav, 1, 0, null, t, "Massive Attack", "Mezzanine", 1998, null, 30_000, k + 1, 1, null, null)).ToList(), 0);
                player = new PlayerView();
                win.Go(() => player);
            }, 2500),
            // mid-change: the old cover receding into the stack, the new one swinging in
            ("player-next", () => app.Player.Next(), 520),
            ("player-lyrics", () => player?.ToggleLyrics(), 1500),
        };
        var i = 0;
        foreach (var (name, open, settle) in pages)
        {
            Page = name;
            try
            {
                open();
                await Task.Delay(settle);  // entrance animations settle
                await Shot(win.Content, Path.Combine(dir, $"{++i:00}-{name}.png"));
                Note($"ok   {name}");
            }
            catch (Exception e) { Failed(name, e); }
        }
        Page = null;
        Note(failures == 0 ? "ALL PAGES OK" : $"{failures} FAILURE(S)");
        Environment.Exit(failures == 0 ? 0 : 1);
    }

    private static async Task Shot(UIElement root, string path)
    {
        var rtb = new RenderTargetBitmap();
        await rtb.RenderAsync(root);
        var pixels = (await rtb.GetPixelsAsync()).ToArray();
        await using var file = File.Create(path);
        var enc = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, file.AsRandomAccessStream());
        enc.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)rtb.PixelWidth, (uint)rtb.PixelHeight, 96, 96, pixels);
        await enc.FlushAsync();
    }
}
