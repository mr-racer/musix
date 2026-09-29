# v2 · Phase 8 — Ecosystem

**Date:** 2026-09-29 · **Program:** `2026-09-29-musix-v2-program-design.md` (§2 "ecosystem", §6 phase 8)
**Status:** draft for the owner's review
**Goal:** the things the owner listed as "the ecosystem":

- **handing playback between devices**, like Spotify Connect;
- **Android Auto**;
- **widgets**;
- **the watch with its queue**;
- the desktop integration beyond phase 7.

Each item ships on its own. None blocks another.

---

## 1. Playback handoff — «Слушать на…»

The model is Spotify Connect's, on our own realtime channel (phase 1 §8):

- **Presence.** Every signed-in client with the WebSocket open publishes `device.presence`
  (id, name, platform, `can_play`, `volume`). `GET /devices/active` lists them, and each
  client shows a device picker in the player.
- **One active player per account.** It publishes `playback.state` (track id, position,
  playing, queue revision) on change and every 10 s while playing. The server keeps the
  last state per account in `playback_sessions`, so a new device can "continue where it
  stopped" even if the old one is gone.
- **Transfer:**
  1. `POST /playback/transfer {toDevice, play: true}`;
  2. the server sends `playback.take {queue, index, positionMs}` to the target;
  3. the target starts, publishes `playback.state`;
  4. the server sends `playback.release` to the old player, which pauses and hands over.
- **Remote control:** any device can send `playback.command` (play/pause/next/seek/signal)
  to the active one. The active player validates and applies it through its own queue
  owner (the Media3 service, `MediaPlaybackList`, the web store). **The queue owner rule
  holds:** the command goes to the player that owns the queue.
- **Android in the background:** the socket is closed when the app is backgrounded (phase 1
  §8). An incoming transfer to a phone in the background needs a push. Without Google FCM,
  which would add a third-party dependency and Google's services, the phone keeps the
  socket open **only while its player service is in the foreground**, i.e. while playing.
  A sleeping phone is not a target, which is the same limit Spotify Connect has for
  devices that are not running the app.

## 2. Android Auto

- `MediaLibraryService` already exists (phase 4 §3). It gets a **browse tree**:
  - «Поток» (a playable item that starts the wave);
  - «Недавнее»;
  - «Плейлисты» → playlists;
  - «Альбомы», «Исполнители»;
  - «Вайбики» (each one starts a seeded «Поток»).
- **Search** via `onSearch`, using `GET /search`.
- **Custom actions:** огонёк/вода appear through the media button preferences already
  defined. Auto renders up to the three compact slots plus an overflow.
- **Artwork:** Auto requires content URIs or bitmaps. It reuses the artwork bytes (the watch
  fix), and a `ContentProvider` serves cached cover variants by id.
- **Sideloading caveat:** Android Auto shows apps from unknown sources only with Auto's
  developer settings enabled. That is documented in the app's help for friends.

## 3. Widgets (Android, Glance)

- A **now-playing widget** (2×2, 4×2): cover, title/artist, play/pause/next, огонёк. It is
  bound to the MediaSession through `MediaController` state.
- **«Поток» one-tap:** starts the wave from the home screen.
- Updates happen on playback state changes only. No periodic polling.

## 4. The watch — Up Next

The open issue from the Android spec 2026-09-29 §11. Everything else (controls, artwork,
огонёк/вода in the overflow) already works.

1. **Evidence first:** with the phone on the server's LAN,
   `adb shell dumpsys media_session` for MusiX and for YouTube Music (whose Up Next works).
   Compare the queue size, queue title, active queue item id, session extras, flags, and
   whether the Wear companion is connected as a trusted controller.
2. Fix only what the difference shows. The candidates, with no guessing before step 1:
   - the legacy queue's item ids;
   - the active item id;
   - the queue window size (Wear reads "the next 24");
   - a missing `MediaSession` extra the companion keys on.
3. If the system controls cannot show a third-party queue, a small **Wear OS app**
   (Compose for Wear OS + Horologist media UI) becomes the option. It uses the Data Layer
   to reach the phone's session. That is a separate spec, and only if the owner wants it
   after step 1.

## 5. Desktop extras (beyond phase 7)

- **Handoff** between the PC and the phone via §1: "продолжить на телефоне" from the tray.
- **Global hotkeys:** configurable, beyond the media keys.
- **Discord Rich Presence:** optional, and only if the owner wants it.

## 6. What v1 does that v2 must not — phase 8's share

| v1 | Ecosystem |
|---|---|
| Each device is an island; the only shared state is the server's history | Presence, a persisted playback session, transfer and remote control over one channel |
| Fixes for the watch by trial | Evidence from `dumpsys` before any change |

## 7. Work breakdown (each item independent)

1. Handoff: `playback_sessions`, the WS messages, the device picker in the Android, Windows
   and web players.
2. The Android Auto browse tree + search + the artwork provider.
3. Glance widgets.
4. The watch: the dumpsys comparison, the targeted fix, and the Wear-app decision.
5. Desktop: handoff from the tray, hotkeys.
