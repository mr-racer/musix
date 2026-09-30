# Phase 4 — Android app: plan

> Native execution, blocks in order, each ending with its check and a commit (Russian
> subject). Tests only for clear functionality: about 7 for this phase (the project budget
> is ~100; 70 are spent).

**Spec:** `docs/superpowers/specs/2026-09-29-v2-phase4-android-design.md`.
**Starting point:** the 1.0.0 player core (`frontend/android/.../player/`, ~1.5k lines of
Kotlin), the phase 1 Kotlin codegen config (`v2/contracts/codegen/kotlin`), the generated
`MusixTheme.kt` (`v2/design/gen/android`), golden shots (`/mnt/data/musix-snapshots/golden`),
the dev api on the migrated data (api-snap on `musix_mig`).
**Goal:** `v2/android/`, a native Compose app on API v2 that installs over 1.0.0, with the
cutover scope complete, budgets measured, and a screenshot review ready for the owner.

## Global constraints

- Toolchain: `/mnt/data/android/env.sh` (JDK 21, SDK 36), Gradle 8.14.3, AGP 8.13, Kotlin
  2.4.20, Media3 1.11.1 (the 1.0.0 versions, already cached). Package id `ru.musixai.app`,
  the same key (`/mnt/data/android/keys`, never in the repo, never printed); debug is
  `ru.musixai.app.dev` so it coexists with 1.0.0.
- This process cannot open `/dev/kvm`, but Docker can: the emulator runs headless in
  `/mnt/data/android/emu-docker` with `--device /dev/kvm --network host`; `adb reverse`
  maps the dev nginx port into the emulator.
- The prod phone is not on the LAN: the budgets are measured on the emulator and marked
  as such. The Pixel 9 check is phase 6's.
- **Cutover scope by usage (spec §6, from the snapshot + the prod access log):**
  - the friends' libraries come entirely from Yandex import (1801 tracks) and uploads;
  - 3 friends play the quiz;
  - the stats screens get light use;
  - no assistant calls in the log window.
  So the scope is auth, home, «Поток», player, library, playlists, search, artist, settings
  **+ import, upload, quiz, stats**. The assistant and the player's chat drawer follow.
- Per account: sign-out or an account switch wipes Room, the outbox and the media cache.
  Users never see other users' tracks.

---

## Block 1 — Skeleton, client, auth

- **What:** `v2/android/` with `build-logic` convention plugins and a version catalog.
  - Modules: `app`, `core:{common,model,network,database,data,player,designsystem}`,
    `feature:*`.
  - `core:network` generates the client from `contracts/openapi.json` using the
    openapi-generator Gradle plugin and the phase 1 config (jvm-okhttp4 + kotlinx).
  - `core:designsystem` compiles `design/gen/android` as a source dir.
  - Auth:
    - server screen (default `musixai.ru`, HTTPS only in release);
    - login and invite registration;
    - tokens in DataStore, AES-GCM with a Keystore key;
    - an OkHttp `Authenticator` with one serialized refresh; a revoked family signs out.
  - `make android` / `make android-check`; `tools/android/emu.sh up|down|shot`.
- **Subtleties:** the generated client is synchronous, so calls wrap in `Dispatchers.IO`.
  One `OkHttpClient` serves the API, Coil and Media3.
- **Done when:** the debug APK builds, and login against the dev api works on the emulator
  (screenshot). **Test:** parallel 401s → one refresh.

## Block 2 — Room + SyncEngine + outbox

- **What:**
  - Room mirrors `/sync` (tracks, artists, albums, playlists and items, settings, signal
    state).
  - The SyncEngine:
    - the first run pages the full sync, then applies deltas by cursor;
    - triggers: app start, the WS `sync.changed` while in the foreground, WorkManager
      periodic (15 min, network).
  - The outbox holds listens, signals, playlist edits and settings as Room rows with
    idempotency keys. A WorkManager flush sends them in batches (`listens:batch`).
- **Subtleties:** deletes and tombstones in the delta; a cursor the server rejects triggers
  a full resync; the outbox survives process death.
- **Done when:** a fresh install on the migrated owner account mirrors 5961 tracks, and
  airplane-mode edits land after reconnect. **Tests (2):** SyncEngine on a recorded
  `/sync` fixture (full, then delta with a delete); outbox replay is idempotent.

## Block 3 — Player core on v2

- **What:** port `PlaybackService`, `ListenerAwarePlayer`, `QueuePolicy`,
  `ListenAccumulator`, the notification with огонёк/вода, and artwork bytes for the watch.
  Then re-point them:
  - `POST /playback/manifest` for the current + next 5, and a `ResolvingDataSource` that
    re-resolves on 403 or expiry. The cache key is track id + tier;
  - the tier per network (Wi-Fi lossless, cellular high; economy opt-in). A network change
    applies from the next track;
  - the normalization gain: `volume = 10^(gain/20)` for attenuation, and a boost only within
    the true-peak headroom, through a small `AudioProcessor`;
  - «Поток» via `GET /stream/next`, reactions via `/tracks/{id}/signals`, listens via the
    outbox;
  - a quiz «no-listen» mode;
  - the UI reaches the service through a `MediaController`.
- **Subtleties:** keep 1.0.0's tail-drop and boundary semantics exactly (its JVM tests come
  along); a manifest item's `fallbacks` are tried before an error.
- **Done when:** on the emulator «Поток» plays with the screen off across ≥ 3 boundaries,
  and the notification reactions work. **Tests (2):** tier choice + re-resolve on 403;
  normalization gain math.

## Block 4 — Design system + server add-on

- **What:**
  - `core:designsystem`: `MusixTheme` (dark and light, a CompositionLocal, not Material
    defaults) and every `design/components/*.md` component the cutover surfaces use
    (GlassCard with a `RenderEffect` blur on API 31+, AlbumCover/MosaicCover with Coil 3 and
    blurhash, ToggleSwitch, Segmented, Knob, Sparkline, CompletionRing, SkeuoArcGauge,
    OBStageBar, SectionHeader, Skel, Spinner, Empty, HintBadge …).
  - The identity pieces:
    - the ambient field from the server palette;
    - combustion;
    - the vinyl transition;
    - the spectrum drawn from the energy envelope.
  - Server: `GET /tracks/{id}/envelope` (immutable, ETag = the media sha), plus a backfill
    of `intel:envelope` for migrated media files at idle priority.
- **Done when:** a Roborazzi gallery of the components in both themes renders.

## Block 5 — Surfaces (cutover scope)

- **What**, in order:
  1. home (`GET /home`, For-You hero, wave orb, вайбики);
  2. player (cover/vinyl, controls, scrubber, synced LRC, FactsRail, producer/sample
     badges, queue reorder/remove/play-next, огонёк/вода);
  3. «Поток» (start, settings slider);
  4. library (Paging over Room, sorts, groups, albums grid and modal);
  5. playlists (offline edits);
  6. search (sections of `GET /search`);
  7. artist atlas (`/artists/{id}/page`);
  8. settings (quality per network, normalization, theme, language, devices, cache size,
     updates);
  9. import (Yandex device flow, progress over WS);
  10. upload (pick → sha256 → resumable);
  11. quiz (snippets in no-listen mode);
  12. stats (pulse, rhythm, taste map, engagement).

  Each screen follows UDF: a ViewModel exposes `StateFlow<UiState>`, UI models are
  `@Immutable`, and Room comes first.
- **Subtleties:**
  - shared-element cover → player;
  - predictive back;
  - a phone layout only (tablet is not in scope).
- **Done when:** every screen renders in Roborazzi in both themes next to its golden shot,
  and the flows work on the emulator on migrated data. **Test (1):** the Compose flow
  «playlist edit offline → sync» (Robolectric).

## Block 6 — Updates, release, budgets, review

- **What:**
  - In-app update: `GET /app/android/latest` → prompt → download → sha256 →
    `PackageInstaller`.
  - Release build: R8 full mode, resource shrinking, a Baseline Profile, the same key,
    `versionCode 2` (built, not published: that is phase 6).
  - Budgets on the emulator: cold start, jank on the 6k library, stream start, APK size,
    background PSS, and 60 min of «Поток» with the screen off (≥ 10 boundaries, zero stops).
  - The screenshot review page for the owner: v2 next to golden, both themes.
- **Done when:** the release APK installs over 1.0.0 on the emulator (data kept), the
  budget table is filled (emulator-marked), and the review page is published.

## Block 7 — Post-cutover surfaces

- **What:** the assistant (turns over WS, answer cards, the discoveries rail), and the
  player's chat drawer and lyric explain.
- **Done when:** an assistant turn completes on the emulator with the dev LLM (one small
  test turn).

## Review focus (end of phase)

1. Screen-off playback through «Поток» boundaries: no 1.0.0 regression (tail-drop, refill,
   the notification buttons, the watch artwork).
2. Auth races: parallel 401s → one refresh; a revoked family → sign-out, and local data is
   wiped.
3. Offline mutations are never lost (process death, reboot), and their replay is
   idempotent.
4. A signed URL expiring mid-track or a 403 → re-resolve with no audible gap; a network
   change switches the tier from the next track.
5. Account isolation on the device: another user's tracks never appear after an account
   switch (Room, outbox, media cache).
