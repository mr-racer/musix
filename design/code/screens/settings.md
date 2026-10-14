# The settings and «Добавить» in the library (approved 2026-10-14)

The mock: `design/reference/settings/` (live: https://claude.ai/artifact/9BbWFUbTxUt2QNmrADaki9),
built with **tabs** (the owner's pick over two columns). His words: `preferences.md`,
2026-10-12 to 2026-10-14.

## The settings
- Open space, no cards: «Настройки» 46 px, then the one object, then the account, then the
  options as tabs (Звук · Главная · Приватность · Устройства · Клавиши; the line glides with a
  spring, what leaves blurs to its side in 180 ms, what comes arrives into focus in 520 ms).
- The page ends above the mini player: a veil fades it there, nothing slides under the bar.
- **The phone banner**: horizontal, 272 px, lit by the listener's favourite song (`/stats`
  listening.topTrack: its backdrop, its accent `--fav`; kept in localStorage so it is lit from
  the first frame). The text, the white QR sticker (rounded dots and eyes, the mark in the
  middle, a wave on hover, click copies the link), the phone cut by the bottom edge, tilting
  toward the pointer. It folds into one line («Показать код»); **folded by default once the
  account has an Android device**; the choice is remembered. The QR encoder loads only when the
  banner is open. Low screens shrink the phone and the code (≤900 px and ≤800 px high).
- **The account**: the avatar in the `--fav` accent, the email, «Участник · слушает здесь с …»
  (the first listen), «Выйти» with a door that opens on hover. Under it three cells: Яндекс
  Музыка (unlink asks twice; not linked → the library's Yandex window), Пароль (a glass card;
  every other device is signed out), Мои данные (a zip: history and library CSV, playlists M3U).
- Звук: levelling (seven bars meet at one level), Автоплейлист (a finished list or album goes
  on with similar songs; `playback.autoplay`), the achievement sound (`sound.achievements`).
  **No crossfade** (the Android app would need two players).
- Главная: the city (the server's geocoding, a glass list) with a small window of that city's
  sky at its local hour; snow and rain (`home.precip`; off = only the sky's colour).
- Приватность: «Слушать инкогнито» (`privacy.incognito = {from, until}`, 6 h); the server drops
  listens inside the window; the mini player wears a mask pill with the countdown.
- Устройства: live ones; older sign-ins of the same device folded under «Старые входы · N»
  with «Отключить все старые»; revoking asks twice and the row folds away.
- Клавиши: the real ones (lib/hotkeys.ts): Space, ← →, Shift ← →, /, L, Q.
- The theme is its own button beside the gear: a sun that becomes a moon; click = circular
  reveal from the button; hold ~0.8 s = «как в системе»; a glass caption after 450 ms.

## «Добавить» in the library
- A glass «+» after the search button (the bar's right padding grew for the theme button).
  Its ring is the progress of everything coming in (a song counts once playable; facts never
  hold it); the badge counts songs that arrived since the menu was last opened; «+» gulps.
- The menu grows out of «+»: the inbox, Из Яндекс Музыки, Обновить из Яндекса (+N, asked from
  `/imports/yandex/fresh` when the menu first opens), С компьютера.
- The inbox: one row per song, **one status at a time** in the server's order — в очереди →
  проверяю файл · % → отправляю · % · МБ/с → обрабатываю звук → собираю факты (playable, ▶) →
  готово · N фактов; «уже в библиотеке»; an error with a retry. Three segments draw it. The
  server's steps come from `GET /uploads?ids=` on a `sync` event and every 3 s (8 s while only
  facts are awaited). The list has the app's thin scrollbar and soft edges.
- Files dragged anywhere on the library: the wall goes out of focus, an open sleeve waits;
  dropped, it flies into «+». Folders count, all the way down.
- The Yandex window: over the library (a backdrop-blur scrim; the island, the corner and the
  mini player stay sharp), grown from «+». «Уже в MusiX» (mosaics from the mirror, +N, «Обновить
  все»), «Можно перенести» (checkboxes, «Выбрать песни» unfolds the picker); «Перенести» makes
  the rows travel up and fill. Not linked: the device code, its characters arriving one by one.
- The old `/upload` and `/import` addresses open «Добавить» in the library.
