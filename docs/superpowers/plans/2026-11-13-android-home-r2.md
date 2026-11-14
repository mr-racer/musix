# Главная телефона r2 — план сборки HTML-макета

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать автономный HTML-макет `out/android-home-r2.html` новой телефонной главной MusiX по спеке r2. Макет r1 при этом остаётся побайтно прежним.

**Architecture:** Используется тот же конвейер `build.py`, что у r1, но с отдельным выходом r2. Фрагмент `<section id="page-home">` из `phone.html` подменяется фрагментом `home-r2.html`, а `home.js`/`home.css` — файлами r2. Публичные хуки, которые вызывает `phone.js` (`initHome`, `syncHomeMotion`, `homeRenderSheet`, `decorateHomeSheet`, `homeAnimations`), называются как в r1. Чистая логика «Альбома дня» (прогресс, фразы) живёт в отдельном модуле с unit-тестами под node. Всё движение строится на `createSpring` из vendor и анимирует только transform, opacity и clip-path, без раскладки в кадре.

**Tech Stack:** vanilla JS (ES2022, глобальные функции как в r1), CSS, Python 3 (bake/build), Node `node:test` (unit), Playwright + Chrome (`verify-*.mjs`, как в r1).

**Spec:** `/mnt/data/android-rebuild/docs/superpowers/specs/2026-11-13-android-home-phone-design.md` (локально `C:\musix\android-home-phone-design.md`).

**Рабочая папка:** `/mnt/data/android-rebuild/design/proposals/android-2026-11-13/`, далее `P/`. Ветка `android-rebuild`.

## Global Constraints

- Prod только на чтение; API не вызывается; данные — снимки в `/mnt/data/musix-snapshots/`, результат bake в git не попадает.
- `vendor/*` побайтно не меняется: `cd P/vendor && sha256sum -c SHA256SUMS` проходит после каждой задачи.
- r1 не меняется: `cd P/out && sha256sum -c android-home-review.html.sha256` проходит после каждой сборки.
- Размеры 360×780, 412×915, 448×998; темы тёмная/светлая; главная **не прокручивается** ни в одном состоянии.
- Все цели нажатия ≥ 48×48 px (в макете 1 px = 1 dp).
- Шрифты: подписи 13, текст 15, заголовки 18/24; Geist / Noto Sans / JetBrains Mono; токены — `design/gen/web/tokens.css`.
- В покое: 0 rAF и 0 бесконечных анимаций, кроме неба и сферы (как в r1); reduced motion — мгновенно с кроссфейдом 120 мс.
- Вибрация — только `haptic(kind)` из vendor. Обычные тапы, открытие меню, аккордеон и события без пальца (финал альбома) — без вибрации.
- Код и комментарии — на английском; весь текст UI — на русском, дословно по спеке §5.5.
- Сборка: `python3 P/build.py`; dev-адрес: `http://100.65.53.57:8765/android-home-r2.html` (служба `musix-android-review` раздаёт `P/out/`).

## Review Focus

1. Длинные кириллические названия в шаблонах фраз → не больше 2 строк на 360; шаблон, который не влез даже после сокращения, не выбирается (Task 4: `long`-фикстура).
2. Частое переключение аккордеона и нажатие на полоску посреди сжатия → нет застрявших промежуточных состояний и прыжков высоты (Task 5: 20 переключений, снимок `getBoundingClientRect` до и после).
3. Поиск открыт при раскрытой «Моей волне», затем «Назад» → закрывается только верхний слой (панель поиска), аккордеон остаётся раскрытым (Task 6).
4. Смена размера экрана или темы при раскрытом аккордеоне → высоты перемеряются, карточка не вылезает за мини-плеер (Task 5: смена `reviewSize` в открытом состоянии).
5. Без сети → кнопка альбома и вайбики показывают тост «Для воспроизведения нужна сеть», поиск по библиотеке работает (Task 4 и Task 6).

---

### Task 1: Каркас r2 — фикстуры альбомов и отдельный выход сборки

**Files:**
- Create: `P/bake_albums.py` — пишет `/mnt/data/musix-snapshots/2026-11-13-android-rebuild/albums.json`
- Create: `P/home-r2.html` (фрагмент `<section id="page-home" …>…</section>`), `P/home-r2.css`, `P/home-r2.js` (копия `home.js` с заголовком r2, затем правки в задачах 3–7)
- Modify: `P/build.py` — дописать выход r2, не трогая существующие
- Test: `P/test_build_r2.sh`

**Interfaces:**
- Produces: `window.PHONE_ALBUMS = { [trackId]: { album, artist, year, tracks: [{ t: string, d: number /*s*/, n: number /*track no*/ }] } }` — по одному альбому на каждую из 4 песен снимка (`data.json.tracks[i].id`), выборка из `metadata.db` по точному `album` и `artist` этой песни, сортировка по `disc_number, track_number`.
- Produces: файл `P/out/android-home-r2.html`. Внутри — `<body data-review-focus="home-r2">`, `<title>MusiX · Android: главная, раунд 2</title>` и CSS/JS r2 вместо `home.css`/`home.js`.

- [ ] **Step 1: Написать проверку сборки** `P/test_build_r2.sh`: `set -e`; `python3 bake_albums.py`; `python3 build.py`; проверить, что `out/android-home-r2.html` существует и содержит `data-review-focus="home-r2"`, `window.PHONE_ALBUMS=` и `id="homeAlbumDay"`; что `out/android-home-review.html.sha256` и `vendor/SHA256SUMS` сходятся (`sha256sum -c`); что в `albums.json` у альбома «Ray Of Light» 13 песен, а «Frozen» с `d=373`.
- [ ] **Step 2: Запустить — FAIL** (`bash P/test_build_r2.sh` → нет `bake_albums.py`).
- [ ] **Step 3: `bake_albums.py`.** Открыть `metadata.db` read-only и immutable, как в `bake.py`; ключи — `id` из `data.json`.
- [ ] **Step 4: `build.py`.** Второй проход собирает страницу из того же `phone.html`, но заменяет регэкспом блок `<section id="page-home"[\s\S]*?</section>` содержимым `home-r2.html`, а `home.css`/`home.js` — `home-r2.css`/`home-r2.js`; к CSS добавляется `album-day.css`, к JS — `album-day-model.js`, `album-day.js`, `morph-menu.js` (если файла ещё нет — пустая строка). Перед скриптами вставить `window.PHONE_ALBUMS=`. Выход r1 собирается, как раньше.
- [ ] **Step 5: Минимальный `home-r2.html`** = фрагмент page-home из r1 с `<div id="homeAlbumDay"></div>`. `home-r2.js` = копия `home.js`, из которой убраны ссылки на `homeAlbums`, `homeWeek*`, `homeFan`, `homeCounts` (этих элементов в r2 нет).
- [ ] **Step 6: Запустить — PASS**, открыть dev-адрес r2 и проверить, что в консоли нет ошибок (`node -e` с Playwright `pageerror` или вручную).
- [ ] **Step 7: Commit** `feat(android): scaffold home round 2 build and album fixtures`.

### Task 2: Модель «Альбома дня» — прогресс и фразы (чистые функции)

**Files:**
- Create: `P/album-day-model.js` (работает и как глобальный скрипт, и через `require`: в конце `if (typeof module !== 'undefined') module.exports = {...}`)
- Test: `P/album-day-model.test.mjs` (`node --test`)

**Interfaces:**
- Produces:
  - `adCountable(tracks: {d:number}[]) -> track[]` — `d > 60`.
  - `adProgress(tracks: {d:number, plays:number}[]) -> { heard, total, finishAt, left, fraction, done }`. `total` — число countable; `heard` — countable с `plays > 0`; `finishAt = Math.ceil(0.75 * total)`; `left = max(0, finishAt - heard)`; `fraction = heard / total`; `done = heard >= finishAt`.
  - `adButtonLabel(p) -> string`: `'Слушать'` при heard=0; `'Дослушать · {heard} из {total}'` в процессе; `'Ещё раз'` при done.
  - `adProgressPhrase(p) -> string|null`: null при heard=0 или done; при `left === 1` — «Последняя песня до финиша»; при `heard >= total/2` и `left > 1` — по очереди «Ещё **{left} песни** — и пластинка обыграна» / «Половина позади. Не сворачивай»; иначе — «Ещё **{left} песни** — и пластинка обыграна» (склонение песня/песни/песен).
  - `adPhrases(kind: 'one'|'never'|'long', f: Facts) -> string[]` — HTML со `<b>`; шаблоны дословно из спеки §5.5. `Facts = { song?, n?, k?, artist?, rank?, hours?, artistGender?: 'm'|'f'|'group'|null, otherAlbumsHeard?, plays?, monthGen?, days? }`. Шаблон с «старался(-ась)» включается, только если `artistGender` не null (m → «старался, записывал», f → «старалась, записывала», group → «старались, записывали»). «Все альбомы … затёрты» — только при `otherAlbumsHeard >= 2`.
  - `adFinalePhrases() -> string[]` — две фразы финала.
  - `adQuote(title: string, max: number) -> string` — `«…»`-обёртка, сокращение многоточием внутри кавычек до `max` символов.
  - `adNextIndex(len: number, prev: number, rnd: () => number) -> number` — случайный индекс, не равный `prev` (если `len > 1`).
  - `adPlural(n, [one, few, many]) -> string`.

- [ ] **Step 1: Написать тесты:**
  - `adProgress` по треклисту MBDTF из `albums.json` (11 песен, все > 60 с, включая interlude 62 с) с 7 услышанными → `{heard:7,total:11,finishAt:9,left:2,done:false}`;
  - для Foals с двумя песнями 43 и 44 с они не входят в `total`;
  - 9 из 11 → `done:true`;
  - `adButtonLabel` для трёх случаев — точные строки;
  - `adProgressPhrase` при left=2 содержит `<b>2 песни</b>`, при left=1 — «Последняя песня до финиша», при done — null;
  - `adPhrases('never', {artist:'Foals', rank:4, hours:12, artistGender:null, otherAlbumsHeard:1})` не содержит «старал» и «затёрты», но содержит `<b>№4</b>`;
  - то же с `artistGender:'group', otherAlbumsHeard:2` содержит «старались, записывали» и «а этот как новенький»;
  - `adQuote('Monster (ft. Jay-Z, Rick Ross, Nicki Minaj & Bon Iver)', 24).length <= 26` и строка заканчивается `…»`;
  - `adNextIndex(5, 2, () => 0.45) !== 2`.
- [ ] **Step 2: Запустить — FAIL** (`cd P && node --test album-day-model.test.mjs`).
- [ ] **Step 3: Реализовать функции** по сигнатурам выше.
- [ ] **Step 4: Запустить — PASS.**
- [ ] **Step 5: Commit** `feat(android): album of the day model with progress and phrases`.

### Task 3: Раскладка r2 — шапка, герой, вайбики, состояния без прокрутки

**Files:**
- Modify: `P/home-r2.html`, `P/home-r2.css`, `P/home-r2.js`
- Create: `P/verify-home-r2.mjs` (каркас по образцу `verify-home.mjs`: те же размеры, темы, `pageerror`; снимки `out/checks/home-r2-*.png`, итог `home-r2-results.json`)

**Interfaces:**
- Consumes: `window.PHONE_ALBUMS` (Task 1); хуки r1 из `home.js`: `homeSegments`, `playHomeTrack`, `homeFlightToMini`, `createPhoneSky`, код сферы.
- Produces (DOM): `#homeWeatherText`, `#homeLibStack` (button, `data-page="library"`), `#homeSearchBtn`, settings-кнопка как в r1, `#homePhrase`, `#orb`, `#homeFlowTitle`, `#homeWaveToggle` (`aria-expanded`), `#homeWavePanel`, `#vibes` (горизонтальный ряд `.vibe-chip`), `#homeStack` — контейнер, где лежат `#vibes`, `#homeWavePanel`, `#homeAlbumDay`.
- Produces (JS): `window.homeReview` = API r1 плюс `setPick(kind: 'one'|'never'|'long'|'none')`, `setProgress(state: 'zero'|'mid'|'last'|'done')`, `fold(open: boolean)`, `metrics() -> {scroll, height, overlaps, smallTargets: string[]}`. Состояния `setState` = r1 без `many`, плюс `nopick`.

- [ ] **Step 1: Тест в `verify-home-r2.mjs`.** Для 3 размеров × 2 тем × состояний `ready|loading|empty|error|offline|long|one|nopick` проверить `metrics()`: `scroll <= height + 1`, `overlaps` пуст, `smallTargets` пуст (все видимые `button`, `[role=button]`, `a` ≥ 48×48). Шапка: `#homeWeatherText` = `'−3° · снег'` при `setSky('day','snow')` и пуст при погоде `none`.
- [ ] **Step 2: Запустить — FAIL.**
- [ ] **Step 3: Разметка и стили по спеке §5.1–5.4.**
  - Шапка 48: погода текстом, сценарий-карта `{clear:'+4° · ясно', cloudy:'+2° · облачно', rain:'+6° · дождь', snow:'−3° · снег'}`.
  - Стопка — 3 обложки по 32 px веером в зоне 48.
  - Фраза — ≤ 2 строк, 24 px на 360 / 26 на 412 / 28 на 448.
  - Сфера 88/104/112.
  - Строка-спойлер «Моя волна: {пресет}{ · настроение} ▾».
  - Чипы вайбиков высотой 48: стопка 2–3 обложек по 32 + название, `overflow-x:auto` с `scroll-snap`.
  - Состояния `loading`/`empty`/`error` используют `#homeStatus` r1; `nopick` скрывает `#homeAlbumDay`.
- [ ] **Step 4: Запустить — PASS** и посмотреть снимки `home-r2-ready-dark-360.png` и `-412.png`.
- [ ] **Step 5: Commit** `feat(android): home round 2 layout without scrolling`.

### Task 4: Карточка «Альбом дня» и налитая кнопка

**Files:**
- Create: `P/album-day.js`, `P/album-day.css`
- Modify: `P/home-r2.js` (вызов рендера и сценарии), `P/verify-home-r2.mjs`

**Interfaces:**
- Consumes: всё из Task 2; `playHomeTrack(t, image, collection)`; `openSheet('album', track)` (разворот r1).
- Produces:
  - `renderAlbumDay(host: HTMLElement, pick: Pick) -> AlbumDayCard`, где `Pick = { kind, trackId, facts: Facts, plays: number[] /* по трекам альбома */ }`;
  - `AlbumDayCard = { setProgress(plays: number[]), setPlaying(on: boolean), shufflePhrase(), foldValue(f: number) /* Task 5 */, el }`.
- Фикстуры (`AD_FIXTURES` в `album-day.js`, подписаны в панели как сценарии):
  - `one` — Ray Of Light, песня Frozen 47 раз, ещё 2 песни по 1 разу (heard 3/13);
  - `never` — альбом Exits (Foals), rank 4, 12 ч, `artistGender:'group'`, `otherAlbumsHeard:1`;
  - `long` — MBDTF, 32 прослушивания, последний раз 12 марта 2026, дней — от 2026-03-12 до 2026-11-13.
  - Прогресс `zero|mid|last|done` задаёт `plays` так, чтобы heard было 0 / 7 / `finishAt-1` / `finishAt`.

- [ ] **Step 1: Тесты.**
  - На 360 и 412 для каждого `kind` перебрать все шаблоны (`shufflePhrase` по кругу): `.ad-phrase` ≤ 2 строк (`height <= 2 * lineHeight + 1`). Повторить с `long`-фикстурой: длинное название песни «Monster (ft. Jay-Z, Rick Ross, Nicki Minaj & Bon Iver)» и артист «Everything Everything Orchestra».
  - Кнопка: в `mid` текст `'Дослушать · 7 из 11'`. `.ad-fill` с `clip-path` даёт видимую ширину ≈ 7/11 кнопки (±2 px). Риска `.ad-notch` стоит на 75 % ширины (±1 px) во всех четырёх состояниях.
  - Клик по кнопке в `ready` → `phoneReview.current()` = первая неуслышанная песня альбома. В `offline` → тост «Для воспроизведения нужна сеть».
  - Клик по обложке → открыт шит `album`.
  - В покое `document.getAnimations().filter(a => a.effect.target.closest('#homeAlbumDay') && a.playState === 'running')` пуст. После `setPlaying(true)` есть ровно одна (волна кромки); после `setPlaying(false)` — снова пусто.
- [ ] **Step 2: Запустить — FAIL.**
- [ ] **Step 3: Реализовать.**
  - Карточка по §5.5: обложка 96/120/128 (один `<img>` на всё время жизни карточки), «Альбом дня», название, «Артист · год», `.ad-phrase` + 🔀 (48 px; кроссфейд 180 мс; `adNextIndex`), кнопка 48 px.
  - Налитая кнопка устроена так:
    - базовый слой с текстом;
    - `.ad-fill` (цвет `palette.accent`) с `clip-path: inset(0 calc((1 - var(--p)) * 100%) 0 0 round 999px)` и копией текста в инверсном цвете;
    - `.ad-notch` на `left: 75%`;
    - `--p` анимируется `createSpring` при изменении прогресса;
    - волна кромки — SVG-маска, у которой WAAPI сдвигает `translateX` только при `setPlaying(true)` и только если главная видима (подключить к `syncHomeMotion`).
  - Отбор шаблонов по ширине: отрендерить шаблон в скрытом измерителе той же ширины; если в нём больше 2 строк, повторить с `adQuote(title, 20)`; если всё равно больше 2 строк — шаблон исключается.
- [ ] **Step 4: Запустить — PASS**, снимки `home-r2-album-{one,never,long}-{zero,mid,done}-412.png`.
- [ ] **Step 5: Commit** `feat(android): album of the day card with filled progress button`.

### Task 5: Аккордеон «Моя волна» ↔ полоска альбома

**Files:**
- Modify: `P/home-r2.js`, `P/home-r2.css`, `P/album-day.js`, `P/album-day.css`, `P/verify-home-r2.mjs`

**Interfaces:**
- Consumes: `AlbumDayCard.foldValue(f)` (определяется здесь); `homeSegments(...)`, `saveHomeWave()` из r1.
- Produces: `homeFold: { open(), close(), toggle(), value(): number, isOpen(): boolean }`; `homeReview.fold(open)` вызывает его.

**Алгоритм (без раскладки в кадре).** `#homeStack` имеет фиксированную высоту `H = vibesH + gap + cardH`. Её считают при раскладке и при `ResizeObserver` фона: смена размера или темы. Дети позиционированы абсолютно. Одна пружина `f ∈ [0, 1]` (`createSpring`, жёсткость и затухание как у `--spring` r1) задаёт:
- вайбики: `opacity: 1 - 2f`, `translateY(-8f px)`;
- панель волны: `clip-path: inset(0 0 calc((1 - f) * 100%) 0)`, содержимое `opacity: (f - .35) / .65`;
- карточка: `translateY` к позиции под панелью; фон-пластина `clip-path` сжимается от `cardH` до 56;
- `foldValue(f)` внутри карточки: обложка `scale(lerp(1, 40/96, f))` и `translate` к левому краю полоски; название — `translate` в строку полоски; фраза, 🔀 и кнопка — `opacity: 1 - 3f`; `.ad-strip` (подписи «Альбом дня · {название}», «{heard}/{total} ▸» и полоса прогресса 3 px с риской) — `opacity: (f - .6) / .4`.

Повторный вызов посреди движения меняет `target` той же пружины, скорость сохраняется. При reduced motion `f` задаётся сразу, а смена состояний — кроссфейдом 120 мс.

Сегменты «Что играть»: если хоть одна кнопка даёт `scrollWidth > clientWidth`, ряд получает класс `.grid` (2×2). Измерение — при раскладке, а не на глаз.

- [ ] **Step 1: Тесты.**
  - В `ready` на 360/412/448: `fold(true)`, ждать покоя → `metrics()` чист, `#homeWavePanel` полностью внутри `#homeStack`, `#homeAlbumDay` видимой высотой 56 ± 1, нижняя граница стека ≤ верхней границы `#mini`.
  - 20 переключений `#homeWaveToggle` с интервалом 60 мс, затем покой → состояние соответствует чётности кликов, а `getBoundingClientRect` карточки совпадает со снимком того же состояния до серии (±1 px).
  - `src` обложки карточки за серию не меняется (`MutationObserver`).
  - Нажатие на `.ad-strip` при открытой волне → `isOpen()` = false.
  - Выбор пресета и настроения сохраняется после `reload` (ключ r1).
  - На 360 у сегментов нет обрезки: либо одна строка, либо `.grid`.
  - Review Focus 4: в открытом состоянии сменить `reviewSize` 412 → 360 → проверки раскладки снова проходят.
- [ ] **Step 2: Запустить — FAIL.**
- [ ] **Step 3: Реализовать** по алгоритму выше. Убрать шит `tune` из `homeRenderSheet` (r2 его не открывает).
- [ ] **Step 4: Запустить — PASS**, снимки `home-r2-fold-{360,412,448}.png` и `home-r2-fold-mid-412.png` (снимок на `f = 0.5`, через `spring.set`).
- [ ] **Step 5: Commit** `feat(android): fold the album card while the wave tuner is open`.

### Task 6: Перетекающее меню `MorphMenu` и поиск

**Files:**
- Create: `P/morph-menu.js` (общий компонент, без знаний о поиске)
- Modify: `P/home-r2.js` (контент поиска: перенос `homeSearchResults` и `askFromHome` из r1 в панель), `P/home-r2.css`, `P/home-r2.html`, `P/verify-home-r2.mjs`

**Interfaces:**
- Produces: `createMorphMenu({ anchor: HTMLElement, panel: HTMLElement, stage: HTMLElement, radiusFrom = 24, radiusTo = 20, onOpen?: () => void, onClose?: () => void }) -> { open(), close(), isOpen(): boolean, progress(): number }`.
  - Панель заранее разложена в конечном прямоугольнике (`position:absolute` в `#phone`) и скрыта через `visibility`.
  - Пружина `t ∈ [0, 1]` → `clip-path: inset(top right bottom left round r)` от прямоугольника `anchor` (относительно панели) до 0; `r` от `radiusFrom` к `radiusTo`. Глиф anchor — `opacity: 1 - t / .3`; содержимое — `opacity: (t - .4) / .6`; при открытии дети `[data-morph-item]` проявляются лесенкой по 30 мс (WAAPI, `translateY(6px) → 0`).
  - Закрытие: содержимое гаснет за 100 мс, затем `t → 0` той же пружиной.
  - Свой скрим `.morph-scrim` (42 %).
  - Закрывают тап по скриму, `Escape` и `popstate`: при открытии `history.pushState({morph: 1}, '')`, при закрытии не через «Назад» — `history.back()`.
  - Если вызвать `open()` посреди закрытия, анимация продолжится с текущей скорости.
  - Фокус: при открытии — на первый `[autofocus]` в панели, при закрытии — обратно на anchor.
- Панель поиска `#homeSearchPanel` занимает от верха шапки до `min(70 % высоты, верх клавиатуры − 8)`, по ширине — экран минус 16 px с каждой стороны. Клавиатура в макете: панель просмотра «Клавиатура» показывает плашку `#reviewKeyboard` высотой 280 px внизу `#phone` и задаёт `--ime`. Вне режима просмотра — `visualViewport` на телефоне.

- [ ] **Step 1: Тесты.**
  - Клик `#homeSearchBtn` → после покоя `isOpen()`, фокус в `#homeSearchInput`, у `#homeSearchPanel` `clip-path` = `inset(0px … round 20px)`.
  - Ввод `Mad` → 1 артист, `<mark>Mad</mark>`; ввод `<img onerror=alert(1)>` → 0 `img` и показано «В фонотеке пока нет совпадений».
  - Переключение «ИИ» → «Спросить» передаёт текст ассистенту (как r1).
  - `Escape` закрывает панель, фокус возвращается на `#homeSearchBtn`.
  - Открыть → сразу `close()` → через 80 мс `open()` → покой → открыто, `pageerror` нет.
  - Review Focus 3: `fold(true)`, открыть поиск, `page.goBack()` → поиск закрыт, `homeFold.isOpen() === true`.
  - Review Focus 5: в `offline` поиск по библиотеке находит `Frozen`.
  - С клавиатурой-плашкой нижняя граница панели ≤ верхней границы `#reviewKeyboard` − 8.
  - В покое после закрытия у панели нет `running`-анимаций.
- [ ] **Step 2: Запустить — FAIL.**
- [ ] **Step 3: Реализовать `morph-menu.js` и подключить поиск.** Клавиша `/` открывает морф вместо шита r1.
- [ ] **Step 4: Запустить — PASS**, снимки `home-r2-search-{open,ai,keyboard}-412.png` и `home-r2-search-mid-412.png` (t = 0.5).
- [ ] **Step 5: Commit** `feat(android): morph menu component, used by home search`.

### Task 7: Финал — «Обыграна ✓» и JoiPro-событие

**Files:**
- Modify: `P/album-day.js`, `P/album-day.css` (стили `.joipro*` перенесены из `vendor/tactile.css` с комментарием-источником; vendor не меняется), `P/home-r2.html` (кнопка панели «Сыграть песню»), `P/verify-home-r2.mjs`

**Interfaces:**
- Consumes: `createJoiPro(host, { kicker, title, subtitle, action, art, colors, onAction })` из vendor (блик выключен: `setShine` не вызывается); `adFinalePhrases()`.
- Produces: `AlbumDayCard.onHeard(trackIndex)` — увеличивает plays песни; при пересечении `finishAt` запускает финал. `homeReview.hearOne()` слушает следующую неуслышанную песню.
- Финал:
  - кнопка перетекает в «Обыграна ✓»: ширина до ширины содержимого, текст кроссфейдом 180 мс, одна пружина;
  - через 500 мс поверх карточки в её границах появляется JoiPro с полями: kicker «Пластинка обыграна», title — название альбома, subtitle — фраза финала, action «Разворот» (открывает шит `album`), art — обложка, colors `[palette.accent.dark, palette.vibrant]`;
  - закрывается тапом вне JoiPro или через 6 с;
  - после закрытия кнопка остаётся «Обыграна ✓» и залита до `fraction`;
  - **без вибрации** при финале (событие без пальца); `confirm` даёт только сама кнопка JoiPro (vendor).

- [ ] **Step 1: Тесты.**
  - `setProgress('last')` → `hearOne()` → кнопка содержит «Обыграна»; JoiPro виден и не выходит за `#homeAlbumDay` (±1 px); `.jp-title` = название альбома.
  - Журнал `haptic` (`hapticState` из vendor или перехват `navigator.vibrate`) за финал пуст.
  - Через 6.5 с JoiPro скрыт, rAF JoiPro остановлены (`live`-счётчик vendor = 0).
  - Повторный `hearOne()` после финала финал не повторяет.
  - Reduced motion: финал без частиц, сразу конечное состояние.
- [ ] **Step 2: Запустить — FAIL.**
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить — PASS**, снимки `home-r2-finale-{button,joipro}-412.png`.
- [ ] **Step 5: Commit** `feat(android): album finale with morphing button and JoiPro event`.

### Task 8: Панель просмотра, документация раунда, полный прогон

**Files:**
- Modify: `P/home-r2.js` (тексты панели для `data-review-focus="home-r2"`), `P/build.py` (ссылки), `P/README.md` (раздел «Открыть»)
- Create: `P/home-review-r2/README.md`, `P/home-review-r2/manifest.json`
- Modify: `design/code/preferences.md` — реакции и решения владельца от 2026-11-13 (рутина §5.1 п. 3 спеки ребилда): главная без прокрутки, аккордеон, «Альбом дня» на 1 день, 75 % без песен ≤ 60 с, налитая кнопка, правки фраз, `MorphMenu`. `design/code/components.md` — `MorphMenu` и налитая кнопка со статусом «предложено, макет r2». Отдельную карточку в витрине не делаю: vendor-витрина неизменна, а демонстрацию даёт сам r2 — это моё решение.

**Interfaces:**
- Панель просмотра r2 содержит:
  - размер, состояние главной, Поток, время, погоду, тему;
  - «Альбом дня: тип» (`one|never|long|none`) и «Прогресс» (`zero|mid|last|done`);
  - кнопки «Сыграть песню» (`hearOne`) и «Альбом играет» (переключатель `setPlaying`);
  - чекбокс «Клавиатура»;
  - строку «Сценарии макета: прослушивания, место артиста, тип дня, погода».
  - Нерелевантные контролы r1 (плеер, очередь, ассистент) скрываются, как в r1.
- Параметры URL: `?pick=`, `?progress=`, `?time=`, `?weather=`, `?theme=`, `?home=`.

- [ ] **Step 1: Тест.** В `verify-home-r2.mjs` пройти по всем значениям каждого контрола панели без `pageerror`; `?pick=long&progress=mid` открывает нужный сценарий; файл открывается через `file://` и при reduced motion (как r1).
- [ ] **Step 2: Запустить — FAIL** (нет контролов).
- [ ] **Step 3: Реализовать панель.** Написать `home-review-r2/README.md`:
  - ссылки на сценарии;
  - что изменилось относительно r1 и почему (отзыв владельца);
  - границы макета: сценарии и что проверяется только в APK — предиктивное «Назад», настоящая вибрация, 120 Гц.
  
  В `manifest.json` — status «Предложение, не принято», parent commit, sha256 исходников r1, которые не менялись.
- [ ] **Step 4: Полный прогон:**
  - `cd P && bash test_build_r2.sh && node --test album-day-model.test.mjs && node verify-home-r2.mjs && node verify-home.mjs && node verify.mjs && node verify-design.mjs` → везде PASS;
  - `sha256sum out/android-home-r2.html > out/android-home-r2.html.sha256`.
- [ ] **Step 5: Commit** `docs(android): home round 2 review notes`.
