# v2 · Phase 5 — Web client (TypeScript + React)

**Date:** 2026-09-29 · **Program:** `2026-09-29-musix-v2-program-design.md` (§4.2, §6 phase 5)
**Status:** draft for the owner's review
**Goal:** a lean web client on API v2 for two jobs the owner named:

1. **listening from a computer without installing anything;**
2. **the admin:** first-run setup, members and invites, AI policy, instance settings,
   library management.

It replaces the 23k-line SPA. It looks like today's MusiX.

**Exit criteria.**

- Everything in §2 works on v2.
- The budgets in §5 are met.
- The screenshot review against `design/golden/` (desktop 1440×900 and phone 412×915) is
  signed off.

---

## 1. Stack — standard, boring, fast

- **TypeScript (strict), React 19, Vite.**
- **TanStack Router** with file-based, **route-level code splitting**.
- **TanStack Query** for server state: cache, dedup, background refetch, ETag-aware fetch.
- The **generated v2 client** (openapi-typescript + openapi-fetch).
- **Styling:** `design/gen/tokens.css` (CSS custom properties) + CSS Modules. No runtime
  CSS-in-JS and no inline style objects. Components follow `design/components/*.md`.
- **Local store:** IndexedDB (Dexie) for the `/sync` mirror, so the library renders instantly
  on revisit.
- **Realtime:** one WebSocket client, shared by all routes. It invalidates TanStack Query keys
  on `sync.changed` / `job.*` events.
- **PWA:** a service worker caches **the app shell and static assets only**. Media and
  `/api` are never intercepted, keeping the v1 invariant.
- Testing: Vitest (units), Playwright (flows + screenshots), Lighthouse CI budgets.

## 2. Scope

**Listening (all users):**
- home, «Поток», the player (lyrics, facts, queue, огонёк/вода), library (albums, artists,
  tracks, playlists), search, artist page, settings (quality, normalization, theme,
  language, devices);
- uploads from the computer via drag-and-drop, as resumable chunked uploads (phase 1 §5.2).

**Admin (owner):**
- the first-run setup wizard (the v1 `SetupWizard` flow);
- members and invites;
- AI policy and the LLM endpoint;
- instance settings;
- library management: folder grants, rescan, indexing progress over WS, rendition backlog;
- the Yandex import;
- a small ops page: queue depths, disk budget, rendition coverage, `/metrics` highlights.

**Out of the web's scope** (the native clients carry them): the assistant, the quiz and
the stats tabs. They can come back to the web later if usage says so; the v2 API already
serves them.

## 3. Playback in the browser

- One `<audio>` element owned by a player store (Zustand); UI components subscribe to
  slices.
- Signed URLs come from `POST /playback/manifest`. The tier per connection is read from
  the Network Information API where available, else the setting. The next track is
  preloaded by a second hidden `<audio>` with `preload="auto"` once the current track
  passes 50%, so boundaries are gapless-ish without the v1 blob prefetch.
- The **Media Session API** gives OS media keys and the lock screen. Recovery on a media
  error re-requests the manifest; that is the web half of the v1 recovery, minus the ?st=
  token problem.
- **Normalization:** a `GainNode` per the manifest gain. The AudioContext is created in the
  user gesture, and **not used on mobile browsers**, the v1 lesson (a suspended context
  = silence). Mobile browsers get plain element volume attenuation instead.
- **The spectrum wave:** from the precomputed energy envelope (phase 4 §4), not an
  `AnalyserNode`, so it is the same everywhere and costs no audio routing.

## 4. The admin, efficiently

- Admin routes are a separate code-split chunk and never load for members.
- Indexing progress, imports and the rendition backlog are **WS push**, not the v1 2–3 s
  polling loops.

## 5. Budgets

| Measure | Budget |
|---|---|
| JS for the player route (gzip) | ≤ 250 KB (v1: 877 KB / 260 KB gzip for everything) |
| LCP, home, desktop, cold | < 1.5 s on LAN / < 2.5 s on the LTE profile |
| INP | < 200 ms |
| Library of 6k tracks | virtualized lists (TanStack Virtual), 60 fps scroll |
| Requests to render home | 1 (`GET /home`), after the shell |

## 6. What v1 does that v2 must not — phase 5's share

| v1 | v2 web |
|---|---|
| One 877 KB bundle; every section mounted | Route-level splitting; mount on demand |
| 405 `useState` in one file; props drilled through `App` | Query cache for server state, a small store for the player, a component per spec |
| Inline style objects | CSS Modules on generated tokens |
| Cover color from a canvas probe | The server palette |
| Blob prefetch of whole tracks into memory | A second `<audio>` preload + HTTP caching of signed URLs |
| Polling | WS invalidation |
| An AudioContext for the spectrum (a mobile-silence hazard) | The precomputed envelope |

## 7. Work breakdown

1. Scaffold, the router, the generated client, the token CSS, the WS client, the auth flow.
2. The player store + manifest playback + Media Session + normalization.
3. Listening surfaces in order: home → player → «Поток» → library → search → artist →
   settings → uploads.
4. Admin: setup wizard → members/invites → AI policy → library management → import → ops.
5. Budgets (Lighthouse CI), Playwright flows, screenshot review.
