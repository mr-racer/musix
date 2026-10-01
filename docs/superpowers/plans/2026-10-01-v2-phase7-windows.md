# Phase 7 — Windows client: plan

> Native execution, blocks in order, each ending with its check and a commit (Russian
> subject). Tests only for clear functionality: about 6 for this phase (the core).
> **This host is Linux**: the WinUI 3 XAML compiler runs only on Windows. So the core is a
> plain `net10.0` library built and tested here; the WinUI shell is written here and
> **built on the owner's PC** (or a Windows CI runner, if the owner wants one). Every block
> says which side verifies it.

**Spec:** `docs/superpowers/specs/2026-09-29-v2-phase7-windows-design.md`.
**Owner's direction (2026-09-30):** after the Android visual pass, take Windows as far as
possible alone, then the plan items that do not depend on it. Visual parity rule: v1's
desktop motion and polish (golden `design/golden/*-desktop-*`) are kept, not flattened.

## Global constraints

- .NET 10 LTS (the spec's "LTS current at start"), SDK at `/mnt/data/.dotnet`; NuGet cache
  on `/mnt/data` (the system disk is ~97 % full).
- The API client is the Kiota one from `contracts/openapi.json` (`contracts/codegen/csharp`).
- One store model with Android: the `/sync` mirror, the outbox, offline-first.
- Secrets: the refresh token only in the Credential Locker (`PasswordVault`); nothing logged.
- No GitHub push without the owner's word (a Windows CI runner would need one).

---

## Block 1 — `Musix.Core` (Linux, verified here)

- **What:** `v2/windows/src/Musix.Core`:
  - `Session`: server URL, login/refresh, `ITokenVault` (Locker on Windows, memory in tests);
  - `Api`: the Kiota client behind an `HttpClient` with Polly (retry, timeout, breaker);
  - `Store`: SQLite (`Microsoft.Data.Sqlite` + Dapper) — the sync mirror, images, outbox;
  - `Sync`: `GET /sync` paging into the mirror, idempotent by change seq;
  - `Playback`: the queue model and policy (list/stream, refill like Android
    `QueuePolicy`) behind `IPlaybackEngine`; listen events into the outbox, batched;
  - `Local`: library folders, TagLib# tags/covers, a watcher plus reconcile (path, size,
    mtime), FTS5 search;
  - `Uploads`: sha256 → `POST /uploads` ("already there" = skip) → chunked, resumable.
- **Done when:** `dotnet test` green. **Tests (6):** sync apply is idempotent; the outbox
  batches and keeps unsent events; reconcile follows a rename/move without duplicates;
  upload skips a known hash; stream refill fires at the policy's threshold; FTS finds a
  tag match.

## Block 2 — `Musix.App` shell (written here, built on Windows)

- **What:** WinUI 3, unpackaged, self-contained:
  - `MusixTheme.xaml` from `design/gen/windows`, Mica backdrop;
  - `MainWindow`: the left rail (`NavigationView`), the bottom player bar;
  - pages: home (the «Поток» orb), library (virtualized `ItemsRepeater`), album, artist,
    playlists, search, «На этом компьютере», uploads, settings, player;
  - `MediaPlayer` + `MediaPlaybackList` engine with SMTC, the thumbnail toolbar
    (огонёк/вода, prev/play/next), the tray (H.NotifyIcon), a CompactOverlay mini-player;
  - the v1 desktop motion that has a XAML analogue (connected animation for the album
    gatefold, composition animations for the cover flip and the orb).
- **Done when:** it builds and runs on the owner's PC; the screenshot review against the
  desktop goldens is the owner's.

## Block 3 — Updates and delivery (server side here)

- **What:** Velopack: `tools/windows/pack.ps1` (publish + `vpk pack`), the release feed under
  `downloads/windows/`, `GET /app/windows/latest` beside the Android one; the web admin
  shows the Windows download.
- **Done when:** the endpoint answers on staging with a test feed; the real feed is built on
  Windows.

## Block 4 — What does not depend on Windows

- The web client's visual pass (the same parity rule as Android: gatefold, artist hero,
  quiz, assistant, the collection map), verified with Playwright here.

## Review focus (end of phase)

1. The core never needs a network for local files; a server outage leaves local play intact.
2. No duplicate tracks between local and server copies (hash, never name).
3. The refresh token never leaves the Locker; logs carry no tokens or URLs with signatures.
4. A moved or renamed folder does not re-upload anything.
5. The shell's budgets (spec §7) are measured on the owner's PC, not assumed.

---

## Status (2026-10-01)

- **Block 1:** done (bca3558). 7 core tests, including the queue/engine alignment one (f64d2c9).
- **Block 2:** written and compiling on Linux (a6a7bd5, e8bf32f, 14b082f). **It has never run.**
  The first launch, the budgets and the screenshot review all happen on the owner's PC
  (`v2/windows/README.md`).
- **Block 3:** done (9e71b31). Velopack updates; `tools/windows/pack.ps1` on the PC; `tools/windows/publish.sh`
  on this host (prod's downloads directory, so a prod step: `--yes` on the owner's word).
  Checked on dev with a test feed.
- **Block 4:** web parity on the web's existing surfaces (4c45b20, 14b082f, e070d22):
  - the album gatefold with the vinyl;
  - the record sliding out on hover;
  - the player's vinyl-stack track change;
  - «Якоря вкуса»;
  - the artist cutout hero.

Rulings:
- **Quiz, assistant and the collection map stay off the web.** The phase 5 spec (approved)
  keeps them on the native clients. Block 4's mention of them conflicts with that spec, and
  the spec wins. Cost if wrong: one port per screen, whenever the owner asks.
- **No Kiota client in the shell.** `MusixHttp` and `JsonNode` cover the few screen calls,
  and a generated client would add build weight and nothing else. Cost if wrong: swapping
  call sites later.
- **Uploads are in «На этом компьютере», not on a page of their own.** Per-file and «всё
  новое» sending, with progress, live there. Cost if wrong: one small page.
