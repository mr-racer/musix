# The web redesign — the plan

Set by the owner on 2026-10-05, after the player «Кино» was finished: **the whole desktop
web app is redone in the player's design language**, screen by screen. This file is the
map of what exists, the order of work and the routine for one screen. It is updated as
screens are approved; the owner's wishes along the way go into `preferences.md`.

## Scope

- **In:** the web app at desktop sizes. Every screen, every window and menu, every
  transition between them.
- **Not now:** the Android app (it suits the owner as it is; it follows later, from the
  approved web screens). The web at phone width keeps working as it does, it is not designed
  in this pass.
- **Parked:** the Windows app. The owner's verdict: too raw, and the effects this design
  needs are unlikely there. Nothing is built for it and its design tokens are not a
  constraint.

## What the work is held to

1. **Finished to the small things.** The owner: «в стиле качественного и проработанного до
   мелочей дизайна, это очень важно». Every proposal also brings a few small delights and
   ideas of its own («прикольные мелочи и идеи»), named as such so he can keep or drop them.
2. **Physical** (principles.md, rule 10): nothing appears or vanishes at once, things answer
   the pointer and the press, what moves between places travels.
3. **Beauty and smoothness first.** The owner: better to use a little more of the processor
   than to look worse. Every animation runs at the screen's frame rate, 60 a second at
   least. Cost is still watched (nothing loops for no reason, nothing repaints a large layer
   per frame without need), but it is never the reason to drop or coarsen a move.
4. **Adaptive.** Each screen is checked at three sizes and must look composed at each, not
   merely fit: a 14-inch laptop, a 16-inch laptop and a 32-inch monitor.

   | Size | Viewports checked |
   |---|---|
   | 14″ | 1512 × 982, 1536 × 864, and the floor 1280 × 720 |
   | 16″ | 1728 × 1117, 1920 × 1080 |
   | 32″ | 2560 × 1440 (the owner's) |

5. **One language.** The player is the reference: open space, cover-lit colour, the type
   scale, plates and float surfaces, the spring. A screen may have its own character; it
   may not have its own rules.

## The routine for one screen

1. **I name the screen** and what belongs to it: its states, its windows and menus, where
   it is entered from and where it leads.
2. **Two or three variants**, as a live mock on the owner's real data, with a switch
   between the variants and between the three screen sizes:
   - **A. Refined:** the screen as it is (for the home: as it was in v1), cleaned up and
     brought to the design code;
   - **B. In the new language:** rebuilt the way the player was;
   - **C. Alternative:** a different idea of the same screen.
   With each: the small delights it brings, and what it costs. The service screens
   (stages 7–9) get one variant in the new language instead of three.
3. **The owner reacts.** His words go into `preferences.md` the same day.
4. **The chosen variant is refined** until he says yes; its sources are saved under
   `design/reference/<screen>/`, and the screen's rules under `design/code/screens/`.
5. **It is built** from the mock, checked at the three sizes and with a slow network, shown
   on video, and rolled out when he says so.

## What exists now

Routes of the web app (`web/src/routes`), with what each holds and where it leads.

### The frame around every screen

| Piece | What it is | Leads to |
|---|---|---|
| Nav island | Главная, Плеер, Библиотека, Поиск (+ Админка for the owner); the blob | every section |
| Brand mark, settings button | top-left and bottom-left corners | home, settings |
| Mini player | the bar under every screen but the player: cover, title, transport, progress | the player |
| Album gatefold | an album opened over the page from its card (v1's vinyl sleeve): tracks, play, shuffle, add to playlist, play next | the artist, the album page, the player |
| «В плейлист» menu | on the album, in the gatefold, in the player | — |
| «Слушать на…» menu, «Играет на…» bar | hand the music to another device, or take it here | — |
| Page states | loading, empty, error, "no such page", the server in limited mode | — |
| Page changes | how one screen gives way to another (none designed today) | — |

### Listening

| Screen | Route | What it holds | Leads to |
|---|---|---|---|
| **Home** | `/` | done: `screens/home.md` (the sky, the orb, «Настроить волну» in place, вайбики as piles, the search with the «Библиотека / ИИ» switch, the library row, «Поставить альбом», the week) | the player (orb, вайбик, the mini player), an artist (a name in the phrase, search), an album (a pick, search), the library, the assistant (the search's AI side), settings |
| **Player** | `/player` | done: `screens/player.md` | an artist, an album, search (a producer), the queue and assistant windows |
| **Library** | `/library` | the summary, a filter, four tabs: albums (sorts), artists, tracks (sorts), playlists (with «Новый плейлист») | the gatefold (an album), an artist, a playlist, the player (a track) |
| **Album** | `/album/$id` | the cover in its light, play, shuffle, «В плейлист», numbered tracks | the artist, the player |
| **Artist** | `/artist/$id` | the name, the photo or cut-out figure in its light, the dossier, the AI bio, top tracks, albums | the gatefold, the player, the library |
| **Playlist** | `/playlist/$id` | rename in place, delete with a second click, drag to reorder, remove a row | the player, the library |
| **Search** | `/search` | the composer with its modes (всё, по тексту, по звучанию), year and sound chips, results: artists, tracks, by lyrics, by sound, albums | an artist, the gatefold, the player |

### The account and the server

| Screen | Route | What it holds |
|---|---|---|
| Settings | `/settings` | playback, the look, devices, the account; doors to upload and import; sign out |
| Upload | `/upload` | drop files, progress per file |
| Import | `/import` | Yandex Music: link by code, choose, progress |
| Sign in, register | `/login` | the two tabs, the invite |
| First run | `/setup` | the owner's account and the mode |
| Admin | `/admin/*` | members and invites, the AI policy and endpoint, the instance, folders and rescans, the queues and the disk, steps 2–3 of the first run |

### Joining the web in this plan (the owner, 2026-10-05)

They exist in v1 and in the Android app, not in the web today.

| Screen | What it is |
|---|---|
| **Assistant** («ИИ») | **the one surface for talking to the AI**: find a song by its words, by its sound, build a playlist, answer a question. It replaces today's search screen with its modes; the year and sound filters are dropped. The assistant window in the player stays. Before it is designed, the server side is checked: the assistant must do each of these as well as the old chat or better. |
| **Quick search** | not AI and not a page of modes: a fast search of the library (artists, albums, tracks) from the local mirror, the one the home's search field opens. |
| **Quiz** («Игра») | the quiz on one's own library. |
| **Statistics** | the library's listening statistics (v1's «Статистика»). |

## The order

| Stage | Screens | Why here |
|---|---|---|
| 1 | **Home**, with the frame it stands in: the nav island (now with Ассистент and Игра), the mini player, how pages change, and **quick search** (the home's field searches the library at once; a way to the assistant sits beside it) | the first thing seen; the frame is on every later screen. Variant A starts from v1's home |
| 2 | **Library**: four tabs, the album card, the **gatefold**, the album page, and **statistics** | the most used after the player; the gatefold is the main way into an album from anywhere |
| 3 | **Artist** | the richest page; shares the album card and the track rows with stage 2 |
| 4 | **Playlist**, and the track row everywhere (hover, actions, drag) | the row is shared by five screens |
| 5 | **Assistant**: first the check of the server (lyrics, sound, playlist, questions: as good as the old chat or better), then the page; the old search screen is removed | depends on the rows and cards of 2–4 |
| 6 | **Quiz** | its own little world; nothing depends on it |
| 7 | Settings, upload, import | quiet screens: forms, lists, progress. One variant each, in the new language |
| 8 | Sign in, first run | the entrance. One variant |
| 9 | Admin | the owner's tools. One variant |
| 10 | A pass over everything: page states, transitions between screens, then **the light theme** in one go | the owner chose dark first: each screen is designed and built dark, the light theme follows once the language has settled |

The player is revisited at stages 1 and 2 only where it meets them: the mini player turning
into the player, an album opened from the player.

## Done means

Approved by the owner on the mock; built; composed at 14, 16 and 32 inches; smooth at 60
frames a second; no dead ends (every state and every way in and out exists); its rules in
`screens/<screen>.md`; his words in `preferences.md`.
