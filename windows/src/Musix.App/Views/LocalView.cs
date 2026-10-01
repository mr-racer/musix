using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Musix.App.Ui;
using Musix.Core.Local;
using Musix.Core.Uploads;

namespace Musix.App.Views;

/// <summary>
/// «На этом компьютере» (spec §3): the library folders, the index with an instant search,
/// playback straight from disk, and «Загрузить на сервер» — by content hash, so a file the
/// server already has is linked, never sent again.
/// </summary>
public sealed class LocalView : Grid, IRefreshable
{
    private static CancellationTokenSource? uploading;
    private readonly StackPanel folders = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly AutoSuggestBox search = new() { PlaceholderText = "Название, артист, альбом", Width = 320, QueryIcon = new SymbolIcon(Symbol.Find) };
    private readonly TextBlock summary = M.T("", 13, Theme.B("MxTextSubtle"), font: Theme.Mono);
    private readonly ProgressBar progress = new() { Width = 240, Visibility = Visibility.Collapsed };
    private readonly TextBlock status = M.T("", 13, Theme.B("MxTextMuted"));
    private readonly Button upload;
    private readonly ScrollViewer scroll = new() { Padding = new Thickness(40, 0, 40, 40) };
    private List<LocalTrack> shown = [];

    public LocalView()
    {
        RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        upload = M.Btn(M.H(8, new FontIcon { Glyph = "", FontSize = 14 }, M.T("Загрузить новое на сервер", 14)), () => _ = UploadAll(), accent: true);
        var add = M.Btn(M.H(8, new FontIcon { Glyph = "", FontSize = 14 }, M.T("Добавить папку", 14)), () => _ = AddFolder());
        var rescan = M.Btn(M.H(8, new FontIcon { Glyph = "", FontSize = 14 }, M.T("Пересканировать", 14)), () => _ = Rescan());
        search.TextChanged += (_, e) => { if (e.Reason == AutoSuggestionBoxTextChangeReason.UserInput) Refresh(); };
        var head = M.V(14,
            M.H(16, M.T("На этом компьютере", 34, font: Theme.Display), summary.Align(HorizontalAlignment.Left, VerticalAlignment.Bottom).Margin(0, 0, 0, 7)),
            M.T("Файлы с твоего диска играют сразу, без сети. Загрузка на сервер сверяет содержимое: то, что там уже есть, не отправляется второй раз.",
                14, Theme.B("MxTextMuted"), wrap: true),
            new ScrollViewer { Content = folders, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalScrollMode = ScrollMode.Enabled },
            M.H(10, add, rescan, upload, progress.Align(HorizontalAlignment.Left, VerticalAlignment.Center), status.Align(HorizontalAlignment.Left, VerticalAlignment.Center)),
            search);
        head.Padding = new Thickness(40, 36, 40, 18);
        SetRow(scroll, 1);
        Children.Add(head);
        Children.Add(scroll);
        Refresh();
    }

    public void Refresh()
    {
        folders.Children.Clear();
        foreach (var f in App.Shared.Settings.Folders)
        {
            var chip = M.Btn(M.H(8, new FontIcon { Glyph = "", FontSize = 13 }, M.T(f, 13), new FontIcon { Glyph = "", FontSize = 11 }), () => RemoveFolder(f));
            chip.CornerRadius = new CornerRadius(18);
            ToolTipService.SetToolTip(chip, "Убрать папку из библиотеки (файлы на диске не трогаются)");
            folders.Children.Add(chip);
        }
        var lib = App.Shared.Local;
        var all = lib.All();
        summary.Text = $"{Ru.Plural(all.Count, "файл", "файла", "файлов")} · {all.Count(f => f.ServerTrackId is not null)} на сервере";
        shown = search.Text.Trim() is { Length: > 0 } q ? lib.Search(q, 500).ToList() : all.ToList();
        if (App.Shared.Settings.Folders.Count == 0)
        {
            scroll.Content = M.V(10,
                M.T("Добавь папку с музыкой — например, «Музыка» или папку загрузок.", 15, Theme.B("MxTextMuted"), wrap: true),
                M.T("MusiX прочитает теги и обложки и будет следить за папкой: новые файлы появятся сами.", 13, Theme.B("MxTextSubtle"), wrap: true)).Margin(0, 20, 0, 0);
            return;
        }
        scroll.Content = new ItemsRepeater
        {
            ItemsSource = shown.Select((t, i) => new At<LocalTrack>(t, i)).ToList(),
            ItemTemplate = new Factory<At<LocalTrack>, LocalLine>(() => new LocalLine(i => App.Shared.Player.PlayLocal(shown, i), id => _ = UploadOne(id))),
            Layout = new StackLayout { Spacing = 2 },
        };
    }

    private async Task AddFolder()
    {
        var picker = new Windows.Storage.Pickers.FolderPicker { SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.MusicLibrary };
        picker.FileTypeFilter.Add("*");
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(App.Shared.Window));
        if (await picker.PickSingleFolderAsync() is not { } folder) return;
        var s = App.Shared.Settings;
        if (s.Folders.Any(f => string.Equals(f, folder.Path, StringComparison.OrdinalIgnoreCase))) return;
        s.Folders.Add(folder.Path);
        s.Save();
        await Rescan();
    }

    private void RemoveFolder(string f)
    {
        App.Shared.Settings.Folders.Remove(f);
        App.Shared.Settings.Save();
        _ = Rescan();
    }

    private async Task Rescan()
    {
        status.Text = "Сканирую…";
        progress.IsIndeterminate = true;
        progress.Visibility = Visibility.Visible;
        try
        {
            var r = await App.Shared.Local.ReconcileAsync(App.Shared.Settings.Folders);
            status.Text = $"+{r.Added} · изменено {r.Updated} · перемещено {r.Moved} · удалено {r.Removed}";
            App.Shared.Local.Watch(App.Shared.Settings.Folders, TimeSpan.FromSeconds(5), t => t.ContinueWith(_ => DispatcherQueue.TryEnqueue(Refresh)));
        }
        catch (Exception e) { status.Text = $"Не вышло: {e.Message}"; }
        finally { progress.Visibility = Visibility.Collapsed; Refresh(); }
    }

    private async Task UploadOne(long id)
    {
        try
        {
            var r = await App.Shared.Uploader.UploadAsync(id);
            status.Text = r == UploadOutcome.AlreadyThere ? "Уже на сервере" : "Отправлено — сервер обработает файл";
            await App.Shared.Uploader.LinkAsync();
        }
        catch (Exception e) { status.Text = $"Не загрузилось: {e.Message}"; }
        Refresh();
    }

    /// <summary>Sends every file the server doesn't have yet, one at a time; a second click stops.</summary>
    private async Task UploadAll()
    {
        if (uploading is not null) { uploading.Cancel(); return; }
        var todo = App.Shared.Local.All().Where(f => f.ServerTrackId is null).ToList();
        if (todo.Count == 0) { status.Text = "Всё уже на сервере"; return; }
        uploading = new CancellationTokenSource();
        var ct = uploading.Token;
        progress.IsIndeterminate = false;
        progress.Maximum = todo.Count;
        progress.Value = 0;
        progress.Visibility = Visibility.Visible;
        int sent = 0, there = 0, failed = 0;
        try
        {
            foreach (var f in todo)
            {
                ct.ThrowIfCancellationRequested();
                status.Text = $"{progress.Value + 1} из {todo.Count}: {f.Title}";
                try
                {
                    if (await App.Shared.Uploader.UploadAsync(f.Id, ct: ct) == UploadOutcome.AlreadyThere) there++; else sent++;
                }
                catch (Exception) when (!ct.IsCancellationRequested) { failed++; }
                progress.Value++;
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            uploading = null;
            progress.Visibility = Visibility.Collapsed;
            status.Text = $"Отправлено {sent} · уже были {there}" + (failed > 0 ? $" · ошибок {failed}" : "");
            try { await App.Shared.Uploader.LinkAsync(); } catch (Exception) { }
            Refresh();
        }
    }
}

/// <summary>A file line: title over artist, album, duration, and its server state.</summary>
public sealed class LocalLine : Grid, IBind<At<LocalTrack>>
{
    private readonly Image image;
    private readonly TextBlock title = M.T("", 14, weight: FontWeights.Medium);
    private readonly TextBlock artist = M.T("", 12.5, Theme.B("MxTextMuted"));
    private readonly TextBlock album = M.T("", 12.5, Theme.B("MxTextMuted"));
    private readonly TextBlock dur = M.T("", 12.5, Theme.B("MxTextSubtle"), font: Theme.Mono);
    private readonly FontIcon linked = new() { Glyph = "", FontSize = 14, Foreground = Theme.B("MxGreen") };
    private readonly Button send;
    private At<LocalTrack>? at;

    public LocalLine(Action<int> play, Action<long> upload)
    {
        Padding = new Thickness(10, 7, 10, 7);
        CornerRadius = new CornerRadius(10);
        ColumnSpacing = 14;
        Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        foreach (var w in new[] { new GridLength(44), new GridLength(3, GridUnitType.Star), new GridLength(2, GridUnitType.Star), GridLength.Auto, new GridLength(40) })
            ColumnDefinitions.Add(new ColumnDefinition { Width = w });
        var (frame, img) = Img.Cover(44, 8);
        image = img;
        send = M.Glyph("", () => { if (at is { } a) upload(a.Item.Id); }, 34, "Загрузить на сервер");
        ToolTipService.SetToolTip(linked, "Есть на сервере");
        var names = M.V(1, title, artist);
        foreach (var (e, col) in new (FrameworkElement, int)[] { (frame, 0), (names, 1), (album, 2), (dur, 3), (linked, 4), (send, 4) })
        {
            SetColumn(e, col);
            e.VerticalAlignment = VerticalAlignment.Center;
            Children.Add(e);
        }
        PointerEntered += (_, _) => Background = Theme.B("MxSurface");
        PointerExited += (_, _) => Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        DoubleTapped += (_, _) => { if (at is { } a) play(a.Index); };
    }

    public void Bind(At<LocalTrack> a)
    {
        at = a;
        var t = a.Item;
        title.Text = t.Title;
        artist.Text = t.Artist;
        album.Text = t.Album ?? "";
        dur.Text = Img.Clock(t.DurationMs ?? 0);
        image.Source = Img.File(t.CoverPath, 96);
        linked.Visibility = t.ServerTrackId is null ? Visibility.Collapsed : Visibility.Visible;
        send.Visibility = t.ServerTrackId is null ? Visibility.Visible : Visibility.Collapsed;
        title.Foreground = App.Shared.Player.Current?.Id == $"local:{t.Id}" ? Theme.B("MxAccent") : Theme.B("MxText");
    }
}
