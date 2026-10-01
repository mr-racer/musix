using System.Text.Json;
using Dapper;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Musix.App.Services;
using Musix.App.Ui;
using Musix.Core.Api;
using Musix.Core.Local;
using Musix.Core.Playback;
using Musix.Core.Store;
using Musix.Core.Sync;
using Musix.Core.Uploads;

namespace Musix.App;

/// <summary>
/// The composition root: one store, one session, the sync and outbox loops, the player. The
/// app opens on the local mirror at once (spec §7: interactive home from the local store);
/// the network catches up behind it.
/// </summary>
public sealed class App : Application
{
    public static App Shared => (App)Current;

    public AppSettings Settings { get; } = AppSettings.Load();
    public Db Db { get; private set; } = null!;
    public Musix.Core.Session.Session Session { get; private set; } = null!;
    public MusixHttp Api { get; private set; } = null!;
    public SyncEngine Sync { get; private set; } = null!;
    public Musix.Core.Outbox.Outbox Outbox { get; private set; } = null!;
    public LocalLibrary Local { get; private set; } = null!;
    public Uploader Uploader { get; private set; } = null!;
    public MediaEngine Engine { get; private set; } = null!;
    public PlayerController Player { get; private set; } = null!;
    public MainWindow Window { get; private set; } = null!;
    public Tray? Tray { get; private set; }
    public Updates Updates { get; private set; } = null!;
    public ThumbBar? Thumbs { get; private set; }

    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(60) };
    private Timer? loop;
    private Timer? updates;

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        Resources.MergedDictionaries.Add(new XamlControlsResources());
        Theme.Dark = Settings.Theme != "light";
        Theme.Load(this);
        Connect(new Uri(Settings.Server));
        Window = new MainWindow();
        Window.Activate();
        Tray = new Tray(this);
        Thumbs = ThumbBar.Attach(Window, this);
        if (Session.SignedIn) Window.ShowShell(); else Window.ShowLogin();
    }

    /// <summary>(Re)builds the server-bound services; the store is per server, so switching servers never mixes accounts.</summary>
    public void Connect(Uri server)
    {
        Db?.Dispose();
        var key = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(server.Host)))[..12];
        Directory.CreateDirectory(AppSettings.Dir);
        Db = new Db(Path.Combine(AppSettings.Dir, $"musix-{key}.db"));
        Session = new Musix.Core.Session.Session(http, server, new WinTokenVault(), Environment.MachineName, "2.0.0");
        Api = new MusixHttp(http, server, Session);
        Sync = new SyncEngine(Api, Db);
        Outbox = new Musix.Core.Outbox.Outbox(Db, Api);
        Local = new LocalLibrary(Db, Path.Combine(AppSettings.Dir, "covers"));
        Uploader = new Uploader(Api, Local);
        Updates = new Updates(server);
        Engine?.Dispose();
        Engine = new MediaEngine(Api, id => CoverUrl(id, 512));
        Player = new PlayerController(Engine, Api, Db, (kind, key2, payload) => Outbox.Enqueue(kind, key2, payload));
        Player.Changed += () => Thumbs?.SetPlaying(Player.IsPlaying);
        Outbox.Enqueued += () => _ = Outbox.FlushAsync();
    }

    /// <summary>Starts the background loops: a sync and an outbox flush now and every two minutes, the folder watcher.</summary>
    public void StartLoops()
    {
        loop?.Dispose();
        loop = new Timer(async _ =>
        {
            try { await Sync.SyncAsync(); } catch (Exception) { /* offline: the mirror serves */ }
            try { await Outbox.FlushAsync(); } catch (Exception) { }
            try { await Uploader.LinkAsync(); } catch (Exception) { }
            Window.DispatcherQueue.TryEnqueue(() => Window.Refresh());
        }, null, TimeSpan.Zero, TimeSpan.FromMinutes(2));
        updates?.Dispose();
        updates = new Timer(async _ =>
        {
            try { if (await Updates.CheckAsync()) Window.DispatcherQueue.TryEnqueue(() => Window.ShowUpdate(Updates.Ready!)); }
            catch (Exception) { /* no feed, offline: the next check tries again */ }
        }, null, TimeSpan.FromSeconds(20), TimeSpan.FromHours(6));
        if (Settings.Folders.Count > 0)
            Local.Watch(Settings.Folders, TimeSpan.FromSeconds(5), t => t.ContinueWith(_ => Window.DispatcherQueue.TryEnqueue(() => Window.Refresh())));
    }

    public void StopLoops() { loop?.Dispose(); loop = null; updates?.Dispose(); updates = null; Local.StopWatching(); }

    /// <summary>The smallest variant at least <paramref name="px"/> wide (the mirror keeps the signed URLs).</summary>
    public Uri? CoverUrl(string? imageId, int px)
    {
        if (imageId is null) return null;
        var json = Db.Conn.QuerySingleOrDefault<string>("SELECT urls_json FROM images WHERE id = @imageId", new { imageId });
        if (json is null) return null;
        var urls = JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? [];
        var best = urls.Select(kv => (Px: int.TryParse(kv.Key, out var p) ? p : 0, kv.Value)).OrderBy(x => x.Px).ToList();
        var pick = best.FirstOrDefault(x => x.Px >= px);
        var url = pick.Value ?? best.LastOrDefault().Value;
        return url is null ? null : new Uri(url);
    }

    public void Quit()
    {
        StopLoops();
        Tray?.Dispose();
        Engine.Dispose();
        Db.Dispose();
        Exit();
    }
}
