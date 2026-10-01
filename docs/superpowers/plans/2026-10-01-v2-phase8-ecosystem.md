# Phase 8 — Ecosystem: plan

> Native execution. Blocks in order, each ends with its check and a commit (Russian subject).
> Tests only for clear functionality: about 4 for this phase.

**Spec:** `docs/superpowers/specs/2026-09-29-v2-phase8-ecosystem-design.md`.
**Owner's direction (2026-09-30):** after Windows, take the plan items that don't depend on
it. Every item ships on its own.

## Global constraints

- **Prod is read-only.** Phase 8 is built and checked on dev and staging. Its prod rollout
  ships with the cutover (phase 6) or after it, on the owner's word.
- **The queue owner rule:** a remote command goes to the player that owns the queue and is
  applied there. No other client edits that queue.
- **One store of truth across processes.** Prod runs 4 uvicorn workers with a per-process
  hub, so presence and the playback session live in Postgres and travel by NOTIFY. Process
  memory holds neither.
- No new third-party services: no FCM and no Google Cast.

---

## Block 1 — Handoff «Слушать на…» (server + web, then Android, then Windows)

- **Server** (`contexts/handoff`, migration 0021):
  - Tables:
    - `device_online` (device, account, can_play, seen_at): upserted on connect and on
      heartbeat, deleted on close;
    - `playback_sessions` (account PK, device, state jsonb, updated_at).
  - WS client messages:
    - `device.hello {canPlay}`;
    - `playback.state {state}`: upserts the session and fans out to the account's other
      devices;
    - `playback.command {target, command, …}`: goes to the target device only.
  - REST:
    - `GET /devices/active`: online devices, and which one is the active player;
    - `GET /playback/session`;
    - `POST /playback/transfer {toDevice, play}`: `playback.take` to the target and
      `playback.release` to the previous player.
- **Web:**
  - the player publishes its state on change and every 10 s while playing;
  - it adopts a `take` (queue, index, position);
  - it pauses on `release` and applies `command`s;
  - the device picker «Слушать на…» sits in the player.
- **Android:** the same in `PlaybackService` + `Realtime`, with a picker in the player. It
  is a target only while its service is foreground (spec §1).
- **Windows:** the same in `PlayerController` + a WS client; «Продолжить на телефоне» in
  the tray.
- **Done when:**
  - two web sessions of one account hand the music over both ways;
  - the emulator takes music from the web and gives it back;
  - Windows compiles.
- **Tests (2):**
  - transfer sends `take` to the target only and `release` to the old player;
  - a command for another device never reaches this one.

## Block 2 — Android Auto

- **What:**
  - a `MediaLibraryService` browse tree: «Поток», «Недавнее», «Плейлисты», «Альбомы»,
    «Исполнители», «Вайбики»;
  - `onSearch` through `GET /search`;
  - a `ContentProvider` for artwork by image id;
  - огонёк/вода as the custom actions that already exist.
- **Done when:** a `MediaBrowser` client on the emulator walks the tree and plays from it
  (the instrumented check, since this host has no head unit). **Test (1):** the root lists
  the six nodes.

## Block 3 — Glance widgets

- **What:**
  - now playing in 2×2 and 4×2 (cover, titles, play/pause/next, огонёк);
  - «Поток» one-tap.
  - Updates come from MediaController state changes only.
- **Done when:** pinned on the emulator's launcher, it follows playback.

## Block 4 — Desktop extras (Windows; written here)

- Global hotkeys (`RegisterHotKey`), configurable in Settings.
- «Продолжить на телефоне» in the tray (Block 1).
- **Done when:** it compiles. The owner's PC verifies it.

## Not here: the watch (spec §4)

Step 1 is `dumpsys media_session` on the owner's phone with the watch paired, compared
against YouTube Music's session. This host has neither device, so the item waits for the
owner. Nothing is changed by guessing.
