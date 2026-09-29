# v2 · Phase 7 — Windows client (C# + WinUI 3)

**Date:** 2026-09-29 · **Program:** `2026-09-29-musix-v2-program-design.md` (§4.2, §6 phase 7)
**Status:** draft for the owner's review
**Goal:** a native MusiX for Windows 10/11 that:

- is **fast** (the owner's complaint about the web on desktop);
- plays **music from the PC's own disk** immediately and can **upload** it to the server,
  where it gets recommendations, facts and sound search;
- behaves like a real app: window, tray, media keys and the SMTC overlay, installer,
  auto-update;
- looks like today's MusiX.

**Exit criteria.**

- The owner uses it daily on the home PC: the v2 core features plus local files and
  upload.
- The budgets in §7 are met.
- The screenshot review against `design/golden/` (desktop) is signed off.

---

## 1. Stack — the current Microsoft-recommended shape

- **.NET 9 (or the LTS current at start) + WinUI 3** (Windows App SDK, latest stable),
  deployed **unpackaged, self-contained**.
- **MVVM** with `CommunityToolkit.Mvvm` (source-generated observable properties and commands).
- **DI and hosting:** `Microsoft.Extensions.Hosting`.
- **API client:** generated from `contracts/openapi.json` by **Kiota**, with `HttpClient` and
  a Polly resilience pipeline (retries, timeouts, circuit breaker).
- **Local store:** SQLite via `Microsoft.Data.Sqlite` (Dapper for queries). It holds the
  `/sync` mirror, the local-files index and the outbox. This is the same offline-first
  model as Android.
- **Tokens:** Windows Credential Locker (`PasswordVault`) for the refresh token.

## 2. Audio

- **`Windows.Media.Playback.MediaPlayer` with `MediaPlaybackList`:**
  - gapless transitions and the queue come from the platform;
  - FLAC, ALAC, AAC and MP3 decode natively in Media Foundation;
  - the tiers work exactly as on Android: the playback manifest, then signed URLs through
    `MediaSource.CreateFromUri`, with the cache below.
- **System Media Transport Controls:**
  - media keys, the Win+G/volume overlay and the lock screen come **for free** with
    `MediaPlayer`; metadata and the thumbnail come from the manifest/images.
  - **Custom buttons:** SMTC has no custom-button slots. The taskbar **thumbnail toolbar**
    carries огонёк/вода + prev/play/next, as Spotify/foobar-style players do.
- **Normalization:** the per-item `MediaPlaybackItem` volume from the manifest gain, as
  attenuation. Boost via an `AudioGraph` submix only if the owner wants it (default off on
  Windows).
- **Cache:** a disk cache keyed by track id + tier, pre-fetching the next item. Streams
  are persisted through a `RandomAccessStream` wrapper, the counterpart of Media3's
  CacheWriter.
- **Events:** the batched outbox → `POST /events/listens:batch`.

## 3. Local files

- **Library folders** chosen by the user. `FileSystemWatcher` handles live changes, plus a
  periodic reconcile (path, size, mtime). The index lives in the local SQLite.
- **Tags and covers:** TagLib# (FLAC, MP3, M4A/ALAC, OGG, WAV). Covers are extracted into
  the local cache.
- A section **«На этом компьютере»**:
  - plays at once, no server needed;
  - basic search over the local index (SQLite FTS5).
- **Upload** («Загрузить на сервер»), per file, album or folder:
  1. compute the sha256 locally;
  2. `POST /uploads` (phase 1 §5.2), which answers **"already on the server" → skip**;
  3. otherwise a resumable chunked upload in the background, with progress over WS;
  4. once registered on the server, the local track **links** to the server track (same
     sha256), so it gets the knowledge badges, facts and recommendations. Playback keeps
     preferring the local file (no network) while it exists.
- **Dedup across the two worlds is by content hash**, never by file name.

## 4. UI and design parity

- `design/gen/MusixTheme.xaml` (a ResourceDictionary): colors for both themes, typography,
  spacing, corner radii, the glass effects. **Mica/Acrylic** backdrops map onto the tokens'
  glass definitions; that is the Windows-native way to get the look the web fakes with
  `backdrop-filter`.
- Components per `design/components/*.md`, as templated controls or user controls.
- Surfaces, desktop layout (from the web's desktop design):
  - a left navigation rail;
  - home;
  - «Поток»;
  - player: a full-window mode plus a **mini-player** (compact overlay window,
    `AppWindow.Presenter = CompactOverlay`);
  - library;
  - search;
  - artist;
  - playlists;
  - «На этом компьютере»;
  - settings;
  - uploads;
  - later the assistant/quiz/stats, as on Android.
- **Virtualized lists** (`ItemsRepeater`) for the 6k-track library. Images through a
  memory + disk cache, requesting the right server variant; blurhash placeholders.
- **The tray icon** (H.NotifyIcon): play/pause, next, огонёк/вода, quit. Closing the window
  keeps playing, as a setting.

## 5. Packaging and updates

- **Velopack**: the open-source installer + updater for .NET. It gives:
  - a one-click `Setup.exe`, installed per user, no admin rights;
  - **delta updates**, served from the owner's own server: `downloads/windows/` next to
    the APK, and `GET /app/windows/latest`.
- Why not MSIX: sideloaded MSIX needs a trusted code-signing certificate on every PC, and
  App Installer updates are clumsier outside the Store. Velopack works unsigned, and
  **Authenticode signing** can be added later without changing anything else.
- The web's admin shows the Windows download next to the Android one.

## 6. What v1 does that v2 must not — phase 7's share

| v1 (web on desktop) | Windows client |
|---|---|
| A browser tab: no tray, no real media keys, dies with the tab | A native process with SMTC, a thumbnail toolbar, tray and a mini-player |
| Local music has to be uploaded or mounted first | It plays from disk at once; upload with hash dedup |
| The 877 KB bundle and re-renders | Native XAML, virtualized lists, a local store |
| Updates = reload the page | Velopack delta updates from the instance |

## 7. Budgets

| Measure | Budget |
|---|---|
| Cold start to interactive home (data from the local store) | < 1 s on the owner's PC |
| Scrolling the 6k-track library | 60 fps, no stutter on image load |
| Local file → first audio | < 300 ms |
| Stream start (`lossless` on LAN / `high` on WAN) | < 1 s |
| Idle memory while playing, window closed to the tray | < 200 MB |

## 8. Testing

- Unit tests on the ViewModels and services (xUnit).
- Integration tests of the generated client against the dev stack.
- UI automation for the main flows (WinAppDriver/Appium).
- A local-library test corpus: odd tags, huge folders, files renamed or moved while
  watched.

## 9. Work breakdown

1. Solution skeleton, the generated client, auth + server screen, the token XAML.
2. The local store + SyncEngine + outbox (a port of the Android design).
3. The audio engine: MediaPlaybackList, manifests, cache, SMTC, thumbnail toolbar, tray,
   mini-player.
4. Surfaces in order: home → player → «Поток» → library → search → artist → playlists →
   settings.
5. Local files: watcher, TagLib# index, «На этом компьютере», upload with dedup.
6. Velopack packaging + updates from the instance; budgets; the screenshot review.
