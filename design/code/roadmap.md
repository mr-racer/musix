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
| Album gatefold | единый альбом «Разворот» из карточки или по прямой ссылке: треки, слушать, играть следующим | the artist, the player |
| «В плейлист» menu | on the album, in the gatefold, in the player | — |
| «Слушать на…» menu, «Играет на…» bar | hand the music to another device, or take it here | — |
| Page states | loading, empty, error, "no such page", the server in limited mode | — |
| Page changes | how one screen gives way to another: `motion-and-performance.md` «Page changes» (2026-10-11) | every screen |

### Listening

| Screen | Route | What it holds | Leads to |
|---|---|---|---|
| **Home** | `/` | done: `screens/home.md` (the sky, the orb, «Настроить волну» in place, вайбики as piles, the search with the «Библиотека / ИИ» switch, the library row, «Поставить альбом», the week) | the player (orb, вайбик, the mini player), an artist (a name in the phrase, search), an album (a pick, search), the library, the assistant (the search's AI side), settings |
| **Player** | `/player` | done: `screens/player.md` | an artist, an album, search (a producer), the queue and assistant windows |
| **Library** | `/library` | принята и внедрена 2026-10-11: `screens/library.md` (the wall «Стена» of albums and artists with groups, the glass plate and the rail, the film «Не распечатаны», «Пластинка дня», the glass search, playlists filling the page, the statistics «А» with achievements) | the gatefold (an album), an artist, a playlist, the player (a song) |
| **Album** | `/album/$id` | единый «Разворот», тот же компонент, что открывается из карточки; старый отдельный экран заменён, выложено в production 2026-10-29 (`cafdc8e`) | the artist, the player |
| **Artist** | `/artist/$id` | built 2026-10-17: `screens/artist.md` («Кадр»: the editorial photo, the Grammy laurel, the discography by year, «Ты и …» as a collection, the quiz, the facts, the songs) | the gatefold, the player, the library |
| **Playlist** | `/playlist/$id` | rename in place, delete with a second click, drag to reorder, remove a row | the player, the library |
| **Search** | `/search` | совместимость старых ссылок: перенаправление в `/assistant` с сохранением вопроса `q` | the assistant |

### The account and the server

| Screen | Route | What it holds |
|---|---|---|
| Settings | `/settings` | приняты 2026-10-14 и реализованы: `screens/settings.md`; вкладки, аккаунт, Android-баннер, звук, главная, приватность, устройства, клавиши |
| Upload | `/upload` | перенаправление в библиотеку с `add=files`; актуальная поверхность «Добавить» |
| Import | `/import` | перенаправление в библиотеку с `add=yandex`; актуальное окно Яндекс Музыки |
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
| 2 | **Library**: albums (tiles or rows), artists, playlists, library search behind an icon (no tracks tab, 2026-10-11), the album card, the **gatefold** (done), the album page, and **statistics** | the most used after the player; the gatefold is the main way into an album from anywhere |
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

## Сверка реализации и решений — 2026-10-29

Рабочее дерево: `/mnt/data/v2-branch`, ветка `v2`, клиент `web/`. Старая рабочая копия
`feature/musix-v2` не используется. Основные принятые экраны сохраняют свои концепции и анимации.

| Поверхность | Текущий статус / следующий шаг |
|---|---|
| Главная, плеер, библиотека и статистика, артист, настройки | Обновлены; принятые композиции и анимации сохраняются. |
| Ассистент | Реализован в `/assistant`, источники макета — `design/reference/assistant/`; старый поиск уже заменён редиректом. Существующий экран сохраняется. |
| Альбом | Объединены все входы в существующую книжку: карточки, Enter в быстром поиске, плеер, прямой URL, новая вкладка. Адрес `/album/$id` сохранён; смена альбома обновляет его без повторного открытия книжки. По явному разрешению владельца выложено в production 2026-10-29, `cafdc8e`; результаты — `screens/gatefold.md`. |
| Отдельный плейлист | Владелец подтвердил: не переработан и не принят. Следующий по основному плану — 2–3 предварительных варианта; сохранить переименование, порядок и удаление треков. |
| Вход, регистрация, первый запуск | Не переработаны и не приняты. По одному предварительному варианту в текущем языке. |
| Админка (`/admin/*`) | Не переработана и не принята. Предварительный вариант с сохранением всех инструментов владельца. |
| Общая игра | Отдельного маршрута ещё нет; игра артиста реализована. Этап 6 остаётся самостоятельной задачей. |
| Светлая тема и общие состояния | Общий проход из этапа 10 остаётся в плане; состояния альбома проверяются в текущем этапе. |

Dev для проверки альбомов: `http://127.0.0.1:5180`, API снимка `:18010`, media `:18080`,
отдельный Compose-проект `musix-v2-dev`. Сервер на `:5173` на момент сверки принадлежал старой
рабочей копии и не служит подтверждением результата этой ветки. Выкладка — отдельное решение
владельца после проверки dev.

## Исправления по аудиту — 2026-10-31

Рабочая ветка этого этапа — `design-refresh`, `/home/ivan/musix-design`. Dev с её текущими
исходниками: `http://127.0.0.1:5181` (API снимка `:18010`, media `:18080`). `:5180`
продолжает обслуживать соседнюю рабочую копию и не показывает незакоммиченные изменения.

Первый этап реализован в dev, ожидает проверки владельца:
- Ассистент: ранний ответ больше не зависает; отмена прекращает старый polling.
- Настройки: ошибка сохранения откатывает изменение и показывает уведомление; быстрые
  клики сохраняют последний выбор вкладки; неудачное отключение не скрывает устройство.
- Плеер: полный текст фактов, прокрутка переполненной колонки, центрирование обложки,
  отдельное место под спектр. Принятые анимации обложки сохранены.

Проверки: TypeScript и сборка в отдельный outDir прошли; Vitest 6/6; Playwright 11/11
(альбомы, ассистент, настройки, плеер). Плеер проверен на 1280×720, 1366×768, 1512×982,
2560×1440 и мобильной эмуляции 390×844. Длинные факты и спектральные данные в регрессии
подставлены тестом; это не подтверждение готовности ML-данных снимка или FPS на всех устройствах.

Остались после первого этапа: проход светлой темы и контраста; фокус/resize альбома; узкая библиотека;
сообщения об ошибках аудио и fallback обложек. На снимке часть медиа возвращает 404 —
неисправность production этим не доказана. Production в этом этапе не изменялся.


### Второй этап: обе темы — 2026-10-31

Светлая тема реализована в dev `:5181`: главная, плеер и мини-плеер, ассистент, артист,
библиотека со статистикой/плейлистами, альбомный разворот, настройки, вход, setup и админка.
Согласованные композиции и анимации сохранены; обложки и фото остаются источником цвета.
Палитра и контраст исправлены в исходных токенах и сгенерированы штатным `design/gen/build.py`.
Нативные файлы темы обновлены генератором; клиенты Android/Windows в этом этапе не запускались.

Дополнительно: тема меняется при недоступном localStorage в пределах сессии, системный режим
доступен с клавиатуры, canvas обновляются на паузе. На телефоне у кнопки темы выделено место
рядом с верхними контролами плеера. Погодные частицы читаются на светлом фоне без сброса физики.

Проверки: TypeScript и сборка в отдельный `/mnt/data/.cache/musix-design-stage2-dist`,
Vitest 6/6; Playwright 14/14 (включая регрессии первого этапа). Тематические сценарии проверяют клавиатуру/системную тему, реальный
контраст подписей и Play, окна и canvas на паузе. Browser-проход обеих тем охватил основные
экраны и 5 разделов админки; owner и admin GET были подменены тестовыми данными без мутаций.
Снимки: `/mnt/data/.cache/musix-design-stage2/`. Дизайн-детектор проверен: замечания о spring/градиентах/декоре относятся к принятому визуальному языку; `broken-image` — к комментарию с `<img>`, не к элементу. Изображения и спектры снимка местами отсутствуют;
для регрессии canvas использованы синтетические данные. FPS на реальном устройстве не измерялся.

Дальше: фокус и resize альбомного окна, узкая библиотека, сообщение об ошибке аудио и fallback
обложек. Новый результат проверки: холодный переход `/library?add=yandex` иногда закрывает
импорт при очистке query; открытие через меню библиотеки работает. Нужна отдельная регрессия
на переход из настроек. Визуальной приёмки владельцем и выкладки этого этапа пока не было.

### Третий этап: адаптивность и восстановление после ошибок — 2026-10-31

Реализовано в dev `:5181`:
- Альбомный разворот: фокус с клавиатуры, возврат на карточку, доступный мини-плеер,
  resize и ориентация без повторного открытия, сохранение очереди и прокрутки.
  Enter на кнопке очереди больше не запускает строку; ранний Escape не конфликтует
  с незавершённым открытием.
- Библиотека: инструменты и поиск доступны от 320 px, меню помещаются в экран,
  переход к группе учитывает высоту шапки. Яндекс-окно сохраняет намерение из URL
  при медленном lazy import, поддерживает Back/Forward и вход из настроек.
- Ошибки аудио видны на главной, в полном и мини-плеере; есть рабочий повтор.
  Новый трек не возобновляет старый источник во время ожидания или после ошибки.
  Запоздавшие ответы не возвращают очередь после остановки/нового выбора;
  ручные добавления сохраняются. Повтор ошибки продолжения запрашивает продолжение.
- Мини-плеер учитывает высоту сообщения; на телефоне страница затухает под ним,
  поэтому контент не мешает читать название и ошибку.
- Недоступные обложки получают локальную замену в палитре альбома без сдвига геометрии.
  Новый URL повторяет загрузку, включая A → B → A. У артиста при ошибке фото остаётся
  фон без фотографии; недоступный логотип заменяется именем. Плавный край hero сохранён.

Проверки: TypeScript и сборка в `/mnt/data/.cache/musix-design-stage3-dist`, Vitest 6/6,
34 браузерных сценария прошли. Общий UI-прогон сначала дал 22/23: тест сброса прокрутки
импортировал второй экземпляр engine после HMR; теперь он использует store приложения
и ждёт появления спектра/окончательного размещения факта. Его точечный повтор прошёл.
Отдельно прошли 4 сценария ошибок аудио и 7 сценариев запоздавших ответов/очереди.
Генератор темы: `in sync`; `git diff --check` без замечаний.

Chrome: библиотека 320/390/768/1440 px; открытый альбом 1280×720 → 390×844 → 844×390
→ 1440×900, включая увеличение мини-плеера при ошибке. Ошибки плеера проверены в обеих
темах на 390×844 и 1280×720. Артефакты: `/mnt/data/.cache/musix-design-stage3/`.
Дизайн-детектор: замечания о spring и декоративной сетке относятся к принятому языку;
`broken-image` ссылается на комментарий с `<img>`, а не сломанный элемент.

Ограничения: телефон проверялся эмуляцией Chrome, Safari/Firefox и физические устройства
не запускались. Медиа снимка восстановлены частично; ошибки сети, аудио и Яндекс проверены
на управляемых fixtures, без настоящего импорта. FPS и поведение при длительной нагрузке
в этом этапе не измерялись — это следующий проход производительности. Визуальная приёмка
владельцем и новая выкладка не выполнялись; production не изменялся.

### Четвёртый этап: производительность — 2026-10-31

Подтверждённые расходы измерены до правок, затем исправлены в dev `:5181`:
- Виртуальная очередь монтируется при первом открытии, сохраняет drag, выбор/удаление,
  клавиатуру и положение. На fixture 1000 треков: скрытые строки 1000 → 0, открытые
  1000 → 14; TaskDuration открытия окна 157 → 32 мс. Исправлено перекрытие закрытия
  очереди общими верхними контролами desktop.
- Поиск больше не сканирует библиотеку при выборе результата. Оба поиска получают
  обновления после sync, смены аккаунта и commit другой вкладки. В сценарии 20 ArrowDown
  TaskDuration 166 → 35 мс. У стены отменяются устаревшие переходы и слушатели; у
  статистики исправлен график библиотеки целиком до 1965 года.
- Скрытый мобильный Spectrum не монтируется, позиция мини-плеера не перерисовывает
  весь компонент, невидимый spinner остановлен. Reduced motion сохраняется при возврате
  во вкладку. Ошибки предзагрузки используют backoff: 23 → 3 POST за 6 с, явный Next
  немедленный. Ограничены кеш манифестов и история исключений.
- Sync объединяет burst из 20 вызовов в два прохода и одно уведомление; ошибки,
  частично сохранённые данные и запоздавшие ответы другого аккаунта обработаны.
- Запросы и константы вынесены из UI артиста/настроек: статический entry JS −24,1%,
  начальная главная вместе с Shell: JS −12,5%, CSS −32%. У 500-й песни артиста задержка
  появления ограничена 216 мс вместо 8,838 с.

Проверки: 20/20 unit, TypeScript и isolated build
`/mnt/data/.cache/musix-design-stage4-dist`; 42 браузерных сценария проверены успешно.
Общий прогон дал 41/42: resize-тест альбома прочитал стиль уже заменённого DOM-узла.
В тесте разрешено дождаться завершённого кадра в пределах 250 мс (не прежней 450 мс
анимации); точечный повтор прошёл. Проверены обе темы, 1440/840/390 px очереди,
reduced motion, slow network, старые регрессии фактов/спектра и импорта.

Все результаты и границы сравнения — `motion-and-performance.md`, сырые артефакты
`/mnt/data/.cache/musix-design-stage4/`. Новая сборка проверялась отдельно от production.
Первый переход в библиотеку сохраняет long task около 52 мс; холодное закрытие прямой
ссылки альбома при 128 KiB/s по-прежнему ждёт загрузку библиотеки около 3,3 с. Полный
офлайн-precache ~5,6 MB сохранён. Ускорение всех переходов и гарантированные 60 FPS
не заявляются; физический телефон, Safari/Firefox и длительная сессия не проверялись.
Дизайн-детектор просмотрен: spring, цитатная линия и градиентные награды принадлежат
принятому визуальному языку; `broken-image` указывает на комментарий `<img>`.
Следующий шаг — проверка владельцем на своём экране и устройстве. Production не изменялся.

### Пятый этап: закрытие альбома и профиль первого входа — 2026-10-31

Основной приоритет — desktop, согласно новому пожеланию владельца; мобильный web
прошёл базовую проверку адаптации разворота.

При закрытии прямого входа в альбом библиотека загружается параллельно существующей
анимации. История, overlay и переход к артисту сохраняют поведение. Два новых E2E
подтверждают момент начала загрузки и отсутствие лишних запросов при переходе к артисту.
На ограниченной сети закрытие уже загрузившегося альбома: 1,72 → 1,31 с; раннее закрытие
остаётся около 2,85 с из-за конкуренции загрузок. Метод и границы — `motion-and-performance.md`.

Первый вход в библиотеку всё ещё даёт long task 50–54 мс. Проверенный вариант изменения
порядка layout не дал устойчивого ускорения и откатан; предыдущие исправления сохранены.

Проверки: 12 целевых браузерных сценариев, обе темы библиотеки, навигация/клавиатура/
адаптация альбома, TypeScript, отдельная сборка, diff-check. Дизайн-детектор показал только
advisory о принятой spring-анимации. Изменения находятся в dev `:5181`; production не менялся.
Артефакты: `/mnt/data/.cache/musix-design-stage5/`.

## Done means

Approved by the owner on the mock; built; composed at 14, 16 and 32 inches; smooth at 60
frames a second; no dead ends (every state and every way in and out exists); its rules in
`screens/<screen>.md`; his words in `preferences.md`.
