using Velopack;
using Velopack.Sources;

namespace Musix.App.Services;

/// <summary>
/// Velopack self-update from the server the app talks to (`/download/windows/`, published by
/// tools/windows/publish.sh): checked at start and every six hours, downloaded in the
/// background, applied only when the user agrees — never a restart behind their back.
/// A dev run (not installed) has nothing to update.
/// </summary>
public sealed class Updates(Uri server)
{
    private readonly UpdateManager mgr = new(new SimpleWebSource(new Uri(server, "download/windows/").ToString()));
    private UpdateInfo? ready;

    public bool Installed => mgr.IsInstalled;
    public string Version => mgr.IsInstalled ? mgr.CurrentVersion?.ToString() ?? "" : typeof(Updates).Assembly.GetName().Version?.ToString(3) ?? "";
    public string? Ready => ready?.TargetFullRelease.Version.ToString();

    /// <summary>True when a newer release is downloaded and waits for a restart.</summary>
    public async Task<bool> CheckAsync()
    {
        if (!mgr.IsInstalled) return false;
        if (ready is not null) return true;
        var info = await mgr.CheckForUpdatesAsync();
        if (info is null) return false;
        await mgr.DownloadUpdatesAsync(info);
        ready = info;
        return true;
    }

    public void ApplyAndRestart()
    {
        if (ready is not null) mgr.ApplyUpdatesAndRestart(ready.TargetFullRelease);
    }
}
