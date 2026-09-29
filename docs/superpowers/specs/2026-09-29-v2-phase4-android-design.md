# v2 · Phase 4 — Android app (Kotlin + Jetpack Compose)

**Date:** 2026-09-29 · **Program:** `2026-09-29-musix-v2-program-design.md` (§4.2, §6 phase 4)
**Status:** draft for the owner's review
**Goal:** the native MusiX for Android on API v2:

- it looks like today's MusiX (the design must not suffer);
- it feels like Yandex Music / Spotify: instant start, 60 fps, offline-first, native
  gestures;
- it keeps everything the 1.0.0 player core already does: background playback, the
  notification with огонёк/вода, the lock screen, the watch.

**Exit criteria.**

- The **cutover scope** (§6) is complete on v2.
- The budgets in §8 are met on a Pixel 9-class device.
- The screenshot review against `design/golden/` is signed off by the owner.

---

## 1. Architecture — Google's reference shape (Now in Android)

```
app/                    single Activity, Navigation (type-safe), DI graph (Hilt)
core/designsystem       MusixTheme (GENERATED from design/tokens) + the components
core/model              immutable domain models
core/network            the GENERATED v2 client (openapi-generator kotlin, kotlinx.serialization,
                        OkHttp) + auth interceptor/authenticator
core/database           Room: the local mirror of /sync
core/data               repositories (Room = the single source of truth), SyncEngine, outbox
core/player             the Media3 service from MusiX 1.0.0, re-pointed at v2 (§3)
core/common             dispatchers, result types, logging
feature/<name>          one per surface: auth, home, stream, player, library, search, artist,
                        playlists, assistant, quiz, stats, settings, import, upload
```

- **UDF / MVVM:** a ViewModel exposes a `StateFlow<UiState>`, and the UI sends events.
  UI models are `@Immutable`, which keeps Compose recomposition minimal.
- **Coroutines + Flow** everywhere. There are no callbacks in the domain layer.
- The libraries (all standard, all free):
  - Hilt, Room, WorkManager, DataStore;
  - Coil 3, with blurhash placeholders and the right variant size requested (96/256/512/1024
    from the server);
  - Paging 3 for long lists (the full library, events);
  - Media3 (ExoPlayer + session);
  - kotlinx.serialization, OkHttp.
- The Capacitor shell and the WebView are **removed**. The UI talks to the player service
  through a `MediaController`, in-process, the same channel the watch and the notification
  use.

## 2. Offline-first data

- **Room is the source of truth.** Screens observe Room flows and render immediately. Sync
  only updates Room.
- **SyncEngine:**
  - the first run pages the full `/sync` (6k tracks ≈ 350 KB brotli);
  - after that it applies deltas;
  - triggers: a `sync.changed` push while the app is in the foreground (WebSocket), a
    WorkManager periodic job (15 min, network-constrained), and app start.
- **Mutations go into an outbox:** playlist edits, signals, listens and settings are Room
  rows plus WorkManager flushes, using idempotency keys. So they work offline and are never
  lost.
- **Auth:**
  - tokens live in DataStore, encrypted with a Keystore key;
  - an OkHttp `Authenticator` refreshes on 401, once and serialized;
  - refresh-family revocation means sign-out.
- **Server screen:** the v1 `ServerUrlField` idea as a first-run step (default `musixai.ru`).
  HTTPS only; LAN HTTP is not supported in release.

## 3. The player core — what changes from 1.0.0

1.0.0 is kept as-is where it is already right:

- `PlaybackService` owns the queue;
- `ListenerAwarePlayer`, the tail-drop semantics, the notification buttons;
- artwork as bytes (the watch fix), `<queries>`, the CacheWriter prefetch, the event outbox.

Changes:

| 1.0.0 | Phase 4 |
|---|---|
| Stream URL `/api/v1/search/tracks/{id}/stream` + Bearer header | **Playback manifest:** `POST /playback/manifest` for the current + next 5 gives signed URLs. A `ResolvingDataSource` re-fetches the manifest on `403` / expiry. The cache key stays the track id + **tier** |
| One quality (the original) | Tier per network: `ConnectivityManager` → `wifi`/`cellular` → user settings (defaults: Wi-Fi lossless, cellular high 320, economy opt-in). A network change applies from the next track |
| No loudness handling | **Normalization:** per-item gain from the manifest → `player.volume = 10^(gain/20)` for attenuation. Boost only within the true-peak headroom, through a small `AudioProcessor`. The setting defaults to on |
| JSON track payloads from the SPA | Tracks from Room; the service reads the same repository |
| `/recommend/stream/next` v1 | `GET /stream/next` v2 (same semantics, state server-side) |
| Events POSTed one by one (with an outbox) | `POST /events/listens:batch` from the outbox |
| The WebView plugin bridge (`MusixPlayerPlugin`) | Gone. The Compose UI uses a `MediaController` directly |
| Artwork thumbnails fetched by the service | Image variants from the manifest/metadata. The 320 px bytes stay in `artworkData` for the watch |
| Up Next on the watch: empty | Phase 8 item (§ of the Android spec 2026-09-29 §11), not a phase 4 blocker |

## 4. Design — reproducing today's MusiX

- `MusixTheme` is generated from `design/tokens` (both themes). It is a custom
  `CompositionLocal` theme, **not** Material defaults; Material 3 is used only for
  primitives the design does not override.
- Every `design/components/*.md` component is built once in `core/designsystem`:
  - GlassCard (blur via `RenderEffect` on API 31+, a translucent fallback below);
  - AlbumCover, MosaicCover, ToggleSwitch, Segmented, Knob, Sparkline, CompletionRing,
    SkeuoArcGauge, OBStageBar, …
- **The identity surfaces** (component specs from phase 0):
  - the player: the cover and the vinyl swipe transition, the ambient field driven by the
    **server palette** and the огонёк/вода combustion;
  - the For-You hero and the wave orb;
  - taste islands;
  - the artist atlas hero (cutout on its field, photo blur by contour).
- **The spectrum wave:** the web one read an `AnalyserNode`. Android's `Visualizer` needs
  the RECORD_AUDIO permission, which is not acceptable for a player. Phase 4 renders it from
  a **per-track energy envelope** computed at ingest (a phase 2 `sonic` add-on: 10 Hz RMS in
  bands) and synced to the position. It looks the same and needs no permission.
- **Motion:** durations and curves come from the tokens. Predictive back and shared-element
  transitions (the cover from a list → the player) are where Compose improves on the web
  version.
- **Screenshot tests** (Roborazzi) render every screen in both themes for review against
  `design/golden/`. The bar is "reads as the same app", reviewed, not a pixel match.

## 5. Surfaces (from the v1 web inventory: 159 components, 28 over 200 lines)

| Surface | v1 source | Notes |
|---|---|---|
| Server + login / invite | `LoginScreen`, `ServerUrlField` | owner setup stays on the web |
| Home | `LandingScreen`, `ForYouHero`, islands, vibes, recent | one `GET /home` |
| «Поток» | `startStream`, the stream settings slider | server state, native refill |
| Player | `PlayerSection` (1799 lines) | cover, controls, lyrics (synced LRC highlighting), `FactsRail`, gems, producer/sample badges, queue (reorder, remove, play next), `SimilarityRail`, огонёк/вода, the AI chat drawer, lyric explain; one `GET /player/context` |
| Library | `LibrarySection`, `AlbumsGridTab`, `AlbumModal`, playlists | Paging over Room; sorts (слушаю чаще / год / А-Я), groups |
| Search | `SearchSection` | sections from `GET /search` |
| Recommend / For You | `RecommendSection` | islands as playlists, AI playlist prompt, axis knobs, album suggestions |
| Artist | `AtlasHero`, facts classes, discography | `GET /artists/{id}/page` |
| Stats | listening stats, rhythm, taste map, discoveries, gems, top pairs, engagement | aggregate endpoints |
| Assistant | `AssistantSection`, `AsxAnswerCard`, discoveries rail | turns over WS |
| Quiz | `QuizSection` | rounds, snippet playback through the player core in a separate "no-listen" mode (quiz invariant I-2) |
| Settings | `SettingsPanel` | quality per network, normalization, theme, language, devices (sign out others), cache size, updates |
| Import | `YandexImportFlow` | device-flow code, progress via WS |
| Upload | new | pick local audio → sha256 → resumable upload (phase 1 §5.2) |

## 6. Cutover scope — decided by usage, not by guess

The phase 0 benches and HAR runs, together with the v1 access logs, give per-feature usage
for the owner's instance. **Every surface with real usage by the friends goes into the
cutover scope** (phase 6 cannot remove something people use). The rest may follow in
point releases after the cutover.

The expected minimum: auth, home, «Поток», player (with lyrics, facts, queue, reactions),
library, playlists, search, artist, settings.

## 7. App updates (sideloaded)

- `GET /app/android/latest` returns `{versionCode, versionName, url, sha256, notes}`, next to
  `/download/musix.apk`. The phase 1 server serves it from `downloads/`.
- In-app update: check on start and daily, show a prompt, download, verify the sha256, then
  install via `PackageInstaller` (the `REQUEST_INSTALL_PACKAGES` permission). This is the
  standard pattern for apps outside Play.
- The same signing key (`/mnt/data/android/keys`) and the same package id `ru.musixai.app`,
  so v2 installs **over** 1.0.0.

## 8. Budgets

| Measure | Budget | How |
|---|---|---|
| Cold start to the first frame of home with data | < 1.5 s (Pixel 9-class) | Macrobenchmark `StartupTimingMetric`, Baseline Profiles shipped |
| Jank | < 1% janky frames scrolling the 6k-track library and the album grid | Macrobenchmark `FrameTimingMetric`, JankStats in debug |
| Stream start | < 1 s Wi-Fi / < 2 s LTE (`high`) | tap → `onIsPlayingChanged` timestamp |
| APK size | < 20 MB | R8 full mode, resource shrinking |
| Memory while playing in the background | < 150 MB PSS | `dumpsys meminfo` |
| Background playback, screen off, 60 min of «Поток» | zero stops, ≥ 10 boundaries crossed | the 1.0.0 emulator checklist |

## 9. What v1 does that v2 must not — phase 4's share

| v1 / 1.0.0 | Phase 4 |
|---|---|
| The UI is a 877 KB web bundle in a WebView | Native Compose, Baseline Profiles, R8 |
| Every screen fetches on open | Room first, `/sync` deltas, one BFF call where needed |
| The spectrum from an `AnalyserNode` (needs audio capture on Android) | A precomputed energy envelope |
| Cover color computed on device | The server palette |
| One quality; no normalization | Tiers per network; LUFS gain |
| Bearer on every media request | Signed URLs from manifests |
| Update = send the APK by hand | An in-app update check with a sha256 |

## 10. Testing

- Unit: ViewModels with Turbine, repositories with an in-memory Room, the SyncEngine against
  recorded `/sync` fixtures.
- The player core: the 1.0.0 JVM tests plus manifest/tier/normalization tests.
- Compose UI tests for the flows: login, start «Поток», queue edit, playlist edit offline
  then sync.
- Screenshot tests (Roborazzi), Macrobenchmark, Baseline Profile generation in CI (an
  emulator on the home box, once `/dev/kvm` is usable by the CI user).

## 11. Work breakdown

1. Module skeleton, the generated client, auth + the server screen, `MusixTheme` generation.
2. Room schema + SyncEngine + outbox.
3. The player core on v2 (manifest, tiers, normalization, the events batch, stream v2).
4. The design system components.
5. Surfaces in cutover-scope order: home → player → «Поток» → library/playlists → search →
   artist → settings.
6. The update mechanism; budgets; screenshot review.
7. Post-cutover surfaces: stats, assistant, quiz, import, upload (if not already required
   by §6).
