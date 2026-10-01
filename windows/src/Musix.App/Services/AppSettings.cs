using System.Text.Json;

namespace Musix.App.Services;

/// <summary>Per-user settings in %LocalAppData%\MusiX\settings.json (never a secret: tokens live in the Locker).</summary>
public sealed class AppSettings
{
    public string Server { get; set; } = "https://musixai.ru/";
    public List<string> Folders { get; set; } = [];
    public bool CloseToTray { get; set; } = true;
    public string Theme { get; set; } = "dark";
    public bool Hotkeys { get; set; } = true;
    public Dictionary<string, string> HotkeyMap { get; set; } = [];  // action → "Ctrl+Alt+Space"; missing = the default

    public static string Dir { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MusiX");
    private static string FilePath => Path.Combine(Dir, "settings.json");

    public static AppSettings Load()
    {
        try { return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath)) ?? new(); }
        catch (Exception) { return new(); }
    }

    public void Save()
    {
        Directory.CreateDirectory(Dir);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}
