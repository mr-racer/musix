using System.Runtime.InteropServices;

namespace Musix.App.Services;

/// <summary>
/// Global hotkeys (phase 8 §5), on top of the media keys that SMTC already handles. They are
/// registered with RegisterHotKey on the main window, and WM_HOTKEY arrives through a window
/// subclass. A combo is text like "Ctrl+Alt+Space", kept in the settings and edited there.
/// A combo another app holds fails to register; that action shows as busy and is left out.
/// </summary>
public sealed class Hotkeys : IDisposable
{
    public static readonly (string Action, string Label, string Default)[] Actions =
    [
        ("toggle", "Пауза / играть", "Ctrl+Alt+Space"),
        ("next", "Следующий трек", "Ctrl+Alt+Right"),
        ("prev", "Предыдущий трек", "Ctrl+Alt+Left"),
        ("fire", "Огонёк", "Ctrl+Alt+F"),
        ("water", "Вода", "Ctrl+Alt+W"),
        ("show", "Показать MusiX", "Ctrl+Alt+M"),
    ];

    private const int WM_HOTKEY = 0x0312;
    private const uint MOD_ALT = 1, MOD_CONTROL = 2, MOD_SHIFT = 4, MOD_WIN = 8, MOD_NOREPEAT = 0x4000;
    private readonly IntPtr hwnd;
    private readonly App app;
    private readonly SubclassProc proc;
    private readonly Dictionary<int, string> registered = [];

    public Hotkeys(Microsoft.UI.Xaml.Window window, App app)
    {
        hwnd = WinRT.Interop.WindowNative.GetWindowHandle(window);
        this.app = app;
        proc = Proc;
        SetWindowSubclass(hwnd, proc, 2, IntPtr.Zero);
    }

    /// <summary>The actions whose combo another app already holds.</summary>
    public IReadOnlyList<string> Busy { get; private set; } = [];

    /// <summary>(Re)registers everything from the settings; off = none.</summary>
    public void Apply()
    {
        foreach (var id in registered.Keys) UnregisterHotKey(hwnd, id);
        registered.Clear();
        var busy = new List<string>();
        if (!app.Settings.Hotkeys) { Busy = busy; return; }
        var next = 1;
        foreach (var (action, _, def) in Actions)
        {
            var combo = app.Settings.HotkeyMap.GetValueOrDefault(action, def);
            if (Parse(combo) is not { } k) continue;
            if (RegisterHotKey(hwnd, next, k.Mods | MOD_NOREPEAT, k.Vk)) registered[next++] = action;
            else busy.Add(action);
        }
        Busy = busy;
    }

    private IntPtr Proc(IntPtr h, uint msg, IntPtr wParam, IntPtr lParam, IntPtr id, IntPtr data)
    {
        if (msg == WM_HOTKEY && registered.TryGetValue((int)wParam, out var action))
        {
            var p = app.Player;
            switch (action)
            {
                case "toggle": p.Toggle(); break;
                case "next": p.Next(); break;
                case "prev": p.Previous(); break;
                case "fire": p.React("fire"); break;
                case "water": p.React("water"); break;
                case "show": app.Window.ShowWindow(); break;
            }
            return IntPtr.Zero;
        }
        return DefSubclassProc(h, msg, wParam, lParam);
    }

    /// <summary>"Ctrl+Alt+Space" → modifiers and a virtual key; null if it isn't a combo.</summary>
    public static (uint Mods, uint Vk)? Parse(string combo)
    {
        uint mods = 0, vk = 0;
        foreach (var part in combo.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            switch (part.ToLowerInvariant())
            {
                case "ctrl": mods |= MOD_CONTROL; break;
                case "alt": mods |= MOD_ALT; break;
                case "shift": mods |= MOD_SHIFT; break;
                case "win": mods |= MOD_WIN; break;
                default:
                    if (!Enum.TryParse<Windows.System.VirtualKey>(part, true, out var key)) return null;
                    vk = (uint)key;
                    break;
            }
        }
        return vk != 0 && mods != 0 ? (mods, vk) : null;  // a bare key would steal it from every app
    }

    public void Dispose()
    {
        foreach (var id in registered.Keys) UnregisterHotKey(hwnd, id);
        registered.Clear();
    }

    private delegate IntPtr SubclassProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam, IntPtr id, IntPtr data);

    [DllImport("comctl32.dll")]
    private static extern bool SetWindowSubclass(IntPtr hwnd, SubclassProc proc, nuint id, IntPtr data);

    [DllImport("comctl32.dll")]
    private static extern IntPtr DefSubclassProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hwnd, int id, uint mods, uint vk);

    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr hwnd, int id);
}
