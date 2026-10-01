using System.Runtime.InteropServices;

namespace Musix.App.Services;

/// <summary>
/// The taskbar thumbnail toolbar (ITaskbarList3) under the window preview: назад,
/// пауза/играть, дальше, огонёк. Buttons can be added only after the shell has made the
/// taskbar button ("TaskbarButtonCreated"), and clicks arrive as WM_COMMAND, so the window
/// is subclassed (comctl32 SetWindowSubclass).
/// </summary>
public sealed partial class ThumbBar
{
    private const uint Prev = 1, Toggle = 2, Next = 3, Fire = 4;
    private const int WM_COMMAND = 0x0111, THBN_CLICKED = 0x1800;
    private const uint THB_ICON = 0x2, THB_TOOLTIP = 0x4, THB_FLAGS = 0x8;

    private readonly IntPtr hwnd;
    private readonly Action<uint> onClick;
    private readonly uint created = RegisterWindowMessage("TaskbarButtonCreated");
    private readonly SubclassProc proc;  // kept alive: the native side holds only a pointer
    private readonly Dictionary<string, IntPtr> icons = [];
    private ITaskbarList3? taskbar;
    private bool added, playing;

    private ThumbBar(IntPtr hwnd, Action<uint> onClick)
    {
        this.hwnd = hwnd;
        this.onClick = onClick;
        proc = Proc;
        SetWindowSubclass(hwnd, proc, 1, IntPtr.Zero);
    }

    public static ThumbBar Attach(Microsoft.UI.Xaml.Window window, App app) =>
        new(WinRT.Interop.WindowNative.GetWindowHandle(window), id =>
        {
            switch (id)
            {
                case Prev: app.Player.Previous(); break;
                case Toggle: app.Player.Toggle(); break;
                case Next: app.Player.Next(); break;
                case Fire: app.Player.React("fire"); break;
            }
        });

    public void SetPlaying(bool on)
    {
        if (on == playing && added) return;
        playing = on;
        if (!added || taskbar is null) return;
        var b = new[] { Button(Toggle, on ? "pause" : "play", on ? "Пауза" : "Играть") };
        taskbar.ThumbBarUpdateButtons(hwnd, 1, b);
    }

    private IntPtr Proc(IntPtr h, uint msg, IntPtr wParam, IntPtr lParam, IntPtr id, IntPtr data)
    {
        if (msg == created) Add();
        else if (msg == WM_COMMAND && ((long)wParam >> 16 & 0xFFFF) == THBN_CLICKED) onClick((uint)((long)wParam & 0xFFFF));
        return DefSubclassProc(h, msg, wParam, lParam);
    }

    private void Add()
    {
        try
        {
            taskbar ??= (ITaskbarList3)new TaskbarList();
            taskbar.HrInit();
            var buttons = new[]
            {
                Button(Prev, "prev", "Назад"), Button(Toggle, playing ? "pause" : "play", playing ? "Пауза" : "Играть"),
                Button(Next, "next", "Дальше"), Button(Fire, "fire", "Огонёк"),
            };
            if (added) taskbar.ThumbBarUpdateButtons(hwnd, (uint)buttons.Length, buttons);  // Explorer restarted
            else taskbar.ThumbBarAddButtons(hwnd, (uint)buttons.Length, buttons);
            added = true;
        }
        catch (Exception) { /* no taskbar (a server SKU, a restricted shell): the tray and SMTC still work */ }
    }

    private ThumbButton Button(uint id, string icon, string tip) => new()
    {
        Mask = THB_ICON | THB_TOOLTIP | THB_FLAGS, Id = id, Icon = Icon(icon), Tip = tip, Flags = 0,
    };

    private IntPtr Icon(string name)
    {
        if (icons.TryGetValue(name, out var h)) return h;
        var path = Path.Combine(AppContext.BaseDirectory, "Assets", $"thumb_{name}.ico");
        h = LoadImage(IntPtr.Zero, path, 1 /* IMAGE_ICON */, 16, 16, 0x10 /* LR_LOADFROMFILE */);
        icons[name] = h;
        return h;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ThumbButton
    {
        public uint Mask;
        public uint Id;
        public uint Bitmap;
        public IntPtr Icon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Tip;
        public uint Flags;
    }

    [ComImport, Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ITaskbarList3
    {
        // ITaskbarList
        void HrInit();
        void AddTab(IntPtr hwnd);
        void DeleteTab(IntPtr hwnd);
        void ActivateTab(IntPtr hwnd);
        void SetActiveAlt(IntPtr hwnd);
        // ITaskbarList2
        void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fullscreen);
        // ITaskbarList3
        void SetProgressValue(IntPtr hwnd, ulong completed, ulong total);
        void SetProgressState(IntPtr hwnd, int flags);
        void RegisterTab(IntPtr tab, IntPtr mdi);
        void UnregisterTab(IntPtr tab);
        void SetTabOrder(IntPtr tab, IntPtr insertBefore);
        void SetTabActive(IntPtr tab, IntPtr mdi, uint reserved);
        void ThumbBarAddButtons(IntPtr hwnd, uint count, [MarshalAs(UnmanagedType.LPArray)] ThumbButton[] buttons);
        void ThumbBarUpdateButtons(IntPtr hwnd, uint count, [MarshalAs(UnmanagedType.LPArray)] ThumbButton[] buttons);
        void ThumbBarSetImageList(IntPtr hwnd, IntPtr imageList);
        void SetOverlayIcon(IntPtr hwnd, IntPtr icon, [MarshalAs(UnmanagedType.LPWStr)] string description);
        void SetThumbnailTooltip(IntPtr hwnd, [MarshalAs(UnmanagedType.LPWStr)] string tip);
        void SetThumbnailClip(IntPtr hwnd, IntPtr clip);
    }

    [ComImport, Guid("56fdf344-fd6d-11d0-958a-006097c9a090"), ClassInterface(ClassInterfaceType.None)]
    private class TaskbarList;

    private delegate IntPtr SubclassProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam, IntPtr id, IntPtr data);

    [DllImport("comctl32.dll")]
    private static extern bool SetWindowSubclass(IntPtr hwnd, SubclassProc proc, nuint id, IntPtr data);

    [DllImport("comctl32.dll")]
    private static extern IntPtr DefSubclassProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessage(string name);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int cx, int cy, uint load);
}
