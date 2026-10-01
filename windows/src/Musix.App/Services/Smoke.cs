using System.Text;
using Dapper;
using Microsoft.UI.Xaml;
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
        Report.AppendLine($"FAIL {Page ?? where}: {e?.GetType().Name}: {e?.Message}");
        Report.AppendLine(e?.StackTrace);
    }

    public static void Seed(App app)
    {
        var c = app.Db.Conn;
        var cover = new Uri(Path.Combine(AppContext.BaseDirectory, "Assets", "musix.png")).AbsoluteUri;
        var urls = $$"""{"256": "{{cover}}", "512": "{{cover}}"}""";
        for (var i = 1; i <= 6; i++)
            c.Execute("INSERT OR REPLACE INTO images(id, urls_json, gen) VALUES (@id, @urls, 1)", new { id = $"img{i}", urls });
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
        var win = app.Window;
        var wav = SilentWav(dir);
        var pages = new (string Name, Action Open)[]
        {
            ("home", () => win.Go(() => new HomeView(), root: true)),
            ("library-albums", () => { LibraryView.Tab = "albums"; win.Go(() => new LibraryView(), root: true); }),
            ("library-artists", () => { LibraryView.Tab = "artists"; win.Go(() => new LibraryView(), root: true); }),
            ("library-tracks", () => { LibraryView.Tab = "tracks"; win.Go(() => new LibraryView(), root: true); }),
            ("library-playlists", () => { LibraryView.Tab = "playlists"; win.Go(() => new LibraryView(), root: true); }),
            ("album", () => win.Go(() => new AlbumView("al1"))),
            ("artist", () => win.Go(() => new ArtistView("ar1", "Massive Attack"))),
            ("playlist", () => win.Go(() => new PlaylistView("p1"))),
            ("local", () => win.Go(() => new LocalView(), root: true)),
            ("search", () => win.Go(() => new SearchView("massive"), root: true)),
            ("settings", () => win.Go(() => new SettingsView(), root: true)),
            ("player", () =>
            {
                app.Player.PlayLocal([new LocalTrack(1, wav, 1, 0, null, "Teardrop", "Massive Attack", "Mezzanine", 1998, null, 30_000, 3, 1, null, null)], 0);
                win.Go(() => new PlayerView());
            }),
        };
        var i = 0;
        foreach (var (name, open) in pages)
        {
            Page = name;
            try
            {
                open();
                await Task.Delay(2000);  // entrance animations settle
                await Shot(win.Content, Path.Combine(dir, $"{++i:00}-{name}.png"));
                Report.AppendLine($"ok   {name}");
            }
            catch (Exception e) { Failed(name, e); }
        }
        Page = null;
        Report.AppendLine(failures == 0 ? "ALL PAGES OK" : $"{failures} FAILURE(S)");
        File.WriteAllText(Path.Combine(dir, "report.txt"), Report.ToString());
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
