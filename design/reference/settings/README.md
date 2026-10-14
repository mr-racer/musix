# Settings — the mock

Stage 7 of the web redesign (`design/code/roadmap.md`), brought forward by the owner on
2026-10-12. His brief is in `design/code/preferences.md` (that date). One variant, as for every
service screen. Live: https://claude.ai/artifact/9BbWFUbTxUt2QNmrADaki9

Round 1 (2026-10-12), scenes behind the mock's switcher (bottom right):
- **Настройки**: open page, no cards — sections as type and hairlines; Звук (loudness with
  seven bars that meet at one level), Небо на главной (the city field + a small window of that
  city's sky by its local hour), Устройства (his real list; stale duplicates folded under
  «Старые входы» with «Отключить все старые»; revoke is a second click), Аккаунт (Yandex link,
  sign out with a door that opens). The one object: a cover-lit card with a phone showing the
  Android player and a white QR sticker (dots, rounded eyes, the mark in the middle; a wave on
  hover; click copies the link); on a phone a «Скачать» button replaces the code.
- **The theme button** beside the gear: a sun that becomes a moon (the bite slides in, the rays
  draw in); click toggles with a circular reveal from the button; hold ~0.8 s = «как в системе»
  (a ring fills); a glass caption after 450 ms says what a click will do.
- **Библиотека**: «+» glass button beside search. Its menu: Из Яндекс Музыки / Обновить из
  Яндекса (+N) / С компьютера. The ring around «+» is the progress of everything coming in;
  the menu shows the files. Files dragged onto the page: the wall goes out of focus, an open
  sleeve waits; dropped, it flies into «+». A file already in the library is not sent again.
- **Яндекс**: a window over the library (out of focus behind it), grown from «+»: «Уже в MusiX»
  (mirrored playlists, +N new, «Обновить все») and «Можно перенести» (checkboxes; «Перенести»
  makes the rows travel up into the mirrored list and fill there).
- «Идеи» toggles the proposed settings (marked «идея», with what each needs).

The library background is a still of the built wall; the Yandex playlist names are examples.

Round 2 (2026-10-13, version 2 of the same artifact), after the owner's fixes:
- The page ends above the mini player (the scroll area stops 92 px above the bottom and fades).
- The phone banner is horizontal at the top, under the title: text, the QR sticker, the phone
  cut by the banner's bottom edge. It folds into one line («Показать код»); in the app it starts
  folded once the account has an Android device. The phone plays the listener's favourite song
  (`/stats` listening.topTrack): its cover, artist, backdrop and accent; the avatar takes the same
  accent. No labels under the transport. Copy: «Та же библиотека, «Поток» и статистика доступны
  на Android — с бесшовным прослушиванием любимых песен.»; under it only Android 7+, version, size.
- The account sits under the banner: email + sign out, then Яндекс Музыка / Пароль / Мои данные.
- Options ranked Звук (levelling, Автоплейлист,
  achievement sound) and Приватность under it → Главная (city + sky, snow and rain); incognito: the mini
  player wears a mask pill with a countdown) → Устройства → Горячие клавиши. Two columns by
  default; «Вкладки» in the mock's switcher shows the tabbed alternative.
- The inbox: one row per song, one status at a time in the server's order (отправка → звук →
  факты), drawn as three segments; the title, artist and cover appear once the server has read
  the tags; a row is playable (▶) from «Собираю факты» on, and the ring around «+» counts a song
  as in at that point; a duplicate says «Уже в библиотеке»; a broken file says so and offers a
  retry. Rows update in place; the list has the app's thin scrollbar and soft edges.
