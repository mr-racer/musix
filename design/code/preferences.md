# What the owner likes — a running record

Read before proposing anything. Every reaction of the owner to a mock or to a built screen
is added here the same day, in his words where they are short. Newest block at the bottom.
A later entry overrides an earlier one. Rules that follow from several entries move into
the other files; this one keeps the evidence.

## 2026-10-04 — the player probes

**Wants**
- v1's signature moves kept: click the cover to pause, the flip to lyrics, the vinyl track
  change, the blurred cover as the background.
- An open, spatial layout. «Не хочется блоковость вообще в целом развивать». A «high-end
  удобный дизайн».
- The fuller colour of the cover-lit background («Эфир»); the cinematic title-card layout
  («Кино 3 / Афиша» — «самое крутое»).
- Credits as quiet labelled groups («плашки с информацией о жанре, продюсере — прикольно»).
- Artist, album and producers visibly as links.
- Samples both ways, playable at once when in the library. Producers over song authors
  («общий продюсер — это часто схожий звук»).
- The assistant on demand, in its own window with question templates. One surface for all
  AI answers.
- On the phone: one screen, no scrolling, new things in sheets; previous / next on the cover.

**Does not want**
- Glass panels around columns; liquid glass everywhere («много liquid glass — это не очень
  хорошо»): glass only in key places.
- Background flashing with the beat, a strong cursor glare: «слишком отвлекающим».
- An overloaded screen: an assistant input and chips always visible; a tall facts block
  («дизбалансит экран по перегрузу текста»).
- Serif for facts and the vibe line («без лютого пафоса»): Noto Sans.
- The title sticking out above the cover's top edge.
- A wave on the phone («отжирает место»).

## 2026-10-05 — the built player, four rounds

**Wants**
- The mock's motion kept one to one: «нельзя терять анимации и баунсы иконок».
- The spectrum lively, at 60 frames a second at least, two to three times taller, but «не
  на всё свободное место — просто побольше»; shrinking only when there is no room.
- On a 32″ screen (2560 × 1440) the cover and the text in the middle, not at the left.
- More than two samples folded away, the library's first; the fold opening with an effect.
- The volume as an icon, the slider on hover.
- A click on a lyric line asks the assistant about it.
- By the title, a control that explains the song's name: **a question mark without a
  circle, hopping on hover** (he turned down a round plate with a spark). In the assistant
  the question reads as a nice request, not as a prompt.
- A cover added to a playlist shrinks, flies into the playlist and is taken in.
- **Physicality everywhere** («надо везде такую физичность добавлять»). Named as right: the
  hopping question mark, the chevron sliding on hover over the artist or album, the cover
  blurring and growing a little on pause («прям мне понравилось»).

**Does not want**
- Anything jumping: the block moving when facts are paged; the cover standing at a different
  height from song to song; the cover vanishing for a moment on previous / next.
- A plain element with no entry and exit: the first «В плейлист» menu was «простенькая, не
  физическая».
- The queue's thumbnail turning into a one-colour square while its copy flies («это баг»).
- A list that scrolls sideways.
- Sound, picture and text out of step when a track is chosen.

## 2026-10-05 — the brief for the whole web

- The whole web app is redone in this language; the Windows app is parked («очень сырое, на
  нём вряд ли получится сделать крутые эффекты»); the Android app suits him for now.
- «Не жертвуем плавностью и красотой ради экономии процентов процессора — лучше чуть больше
  кушать ресурсов, но выглядеть красиво»; «все анимации в 60 фпс всегда».
- The layout must be adaptive and look organic at 14, 16 and 32 inches.
- Design «качественный и проработанный до мелочей»; «привносим какие-то прикольные мелочи
  и идеи».
- The home starts from v1's home, with the design code laid over it.
- Per screen: two or three variants (the old one refined, the new language, an alternative),
  his feedback, then the build.

## 2026-10-05 — answers on the plan

- Into the web, from v1 and the Android app: **the assistant's page, the quiz, the
  statistics**.
- **One surface for the AI: the assistant** (and what the player has stays there). «Удаляем
  старые чатовые поверхности»: today's search screen with its modes goes. The server must
  be checked first: the assistant has to do what the old chat did, as well or better (find
  by lyrics, find by sound, build a playlist). The year and sound filters: «забиваем, в
  ассистент можно не тащить».
- **The search on the home searches the library**, fast, without AI («не по тексту, а по
  библиотеке»). An AI entry may be added to the home as well.
- **Dark theme first**; the light one in a single pass at the end.
- **Service screens** (settings, upload, import, sign-in, first run, admin): one variant in
  the new language, no alternatives.

## 2026-10-06 — the home, first three variants

**Verdicts**
- «А · Как в v1»: «точно мимо».
- «Б · Афиша»: likes the minimalism, that it is not overloaded. Does not accept that it
  repeats the player: «ты делаешь копию плеера дословно — это плохо. Экраны должны быть
  уникальными, и не быть под копирку».
- «В · Полки»: good as new design and does not cross the player, but «жутко перегружен»,
  and «порядок элементов на экране совершенно хаотичный». He likes an airy screen.

**What the home is for, in his words**
- Starting his wave. The button must be more physical, «с эффектом стекла может быть, а то
  сейчас простая». With it, the wave's style settings, redrawn «более приятными дизайну».
- Starting the picked sets (вайбики): the piles of «Полки» can be taken as they are.
- Search of the library, perhaps with an explicit switch between plain search and the AI
  assistant; plain search by default.
- Albums offered here, as v1's library showed them, «если грамотно подать».
- Playlists he would keep, but without pictures they look poor: find a way to present
  them that does not fall out of the design, or leave them out.
- The week's statistics stay, adapted to the new design, perhaps with one more small metric.

**Not for the home**
- History and «Продолжить»: «никто не будет слушать что он только что слушал».
- «Недавно добавлено»: fine, but it belongs to the library.

**Rules that follow** (moved to principles.md when the home is approved)
- Every screen has its own composition. The shared language is type, colour, surfaces and
  motion, never a layout copied from another screen.
- Airy first: what is not needed on a screen leaves it, and what stays has an order the
  eye can follow.

**Round 2, shown the same day** (`design/reference/home/`, awaiting his reaction)
- «Афиша» redrawn as a poster: a headline, one object, the small print. «Полки» cut to four
  rows in an even rhythm. Both are built from the same pieces: the glass ball of the wave,
  the tuner on the screen, search with the «Библиотека / ИИ» switch, albums as sleeves with
  records, playlists as names or as mosaics of their own tracks, the week with days in a row.
- Open, for him to decide: which composition; whether the glass ball is the physical button
  he meant (it would be the third place with glass); playlists as names, as mosaics, or not
  at all; whether the mini player stays a full-width line.

**The glossy ball, same day**: «не нравится как искусственно она выглядит». A rendered
gloss (a specular highlight, a plastic sheen, a fake 3D ball) reads as artificial to him,
however physical its motion. Physical means real materials and real light: frosted glass
with light behind it, a record, rings on water. Three such materials are in the mock
(`data-wave`), his choice pending. Rule for the code: **no rendered gloss or plastic 3D**.

**His decision, later the same day: v1's composition.** «Давай возьмём вариант v1 (старый
ещё), всё-таки он мне нравится больше». The base is «Как в v1» (round 1, variant А), refined.
Into it: the week block and the вайбики piles from round 2; «аккуратно плашку с
рекомендуемыми альбомами и почему»; the wave's button **as v1 had it** (drops of colour
under a glass cap, the ring, the halo), «только чуть улучши эффекты и плавность при нажатии
кнопки»; the mini player and the search with the switch from round 2 in place of v1's.
Lessons: his first verdict on a variant is not final, keep the rejected sources in git;
the v1 orb is a reference he wants kept, not replaced; a new composition is shown as one
mock before it is built (round 3, `design/reference/home/`).

**Later, on the one composition (2026-10-06, evening):** «это уже лучше». Fixes: the mini
player's spectrum must not run over the plates (raise them); the settings button «выглядит
уже неактуальной и не к месту», fit it in softly; «якоря вкуса убираем нафиг с фронта», but
their stack animation and design he liked, «запомним её применить в других местах»
(components.md, «Cover stack»); the background should be as it was in v1, «верхняя половина
мягко амбиент делала», with «мягкость и ламповость», perhaps weather and the time of day;
the record rising from a sleeve must not collide with other objects.

**On the sky (2026-10-06, late):** the first aurora did not separate clear from cloudy or
the hours enough. He wants real weather colours: a clear morning «яркое немного,
воодушевляющее», the day «просто как день» and depending on the weather, the evening «как
закат», the night dark but without acid colours («зелёный-розовый-красный — яркие и
кислотные»). Weather with physics: snow should lie on the blocks (the albums' plate, the
search field), rain should bounce off the headline. The settings button goes to the top
right corner.
Then: the island on the left is a surface too, and snow must grow where it falls («как
только 1 снежинка падает на поверхность, вся поверхность сразу в слое снега —
нереалистично»): physics on the screen is taken literally, a surface accumulates locally.
Then: the snow's edges were too hard («снег резко обрывается»). On the server: «найди уже
существующую логику рекомендации альбомов в библиотеке (была в v1 точно, не выдумывай
её)» and the days-in-a-row count, also v1's. Rule: when v1 had a feature, port its logic;
do not design a replacement.

**2026-10-07, on the implementation's video:** the segmented thumb «вылетает за края и
обрезается» on a far switch; the snow «резко появляется по всей поверхности, а не только
там куда упал». On the weather: ask the city in the settings and at the first run, «без
определения по ip» (VPNs); если юзер не указывает город — дефолтный город инстанса.


## 2026-10-10 — the album gatefold, the brief

- The work moves to branch `v2`: a new design is made there, he checks it, then it goes to
  prod.
- The gatefold (the album opened from the home's picks or the library) is next. «Эффект
  открытия мне нравится, его надо оставить, но вот дизайн этой карточки можно обновить»: the
  fly-out of the grid and the flip stay as they are.
- Must keep: the way to the artist, starting the whole album, choosing a particular track
  into the queue.
- Not needed: «Весь альбом в плейлист»; «Вперемешку» (the player has it).
- Apple-style design is welcome.
- Round 1 (`design/reference/gatefold/`): «Конверт», «Разворот», «Пластинка», awaiting his
  choice.

## 2026-10-10 — the gatefold, round 1: «Разворот»

**He chose «Б · Разворот»**, «в остальном кайф», and asked to build it straight into
`design-refresh` (no second mock). His fixes:
- The left page shows **the sharp cover in the middle**, blurred only under the text at the
  top and the bottom. The right page stays blurred.
- «Текст серым плохо читается на ярких обложках»: check readability and contrast on covers
  of every kind. (Measured on 12 of his covers, white ones included: main text 8.4–13.5 : 1,
  secondary 5.5–8.5 : 1.)
- The spread must open and close faster, «чтобы юзер не ждал долго»; the fly-in is fine.
- The mini player in the mock was not the app's: **the mini player is the same everywhere.**
- Turning to another album: «странно выглядит, что обложка закрывается, потом резко меняется
  её цвет, и опять раскрывается». Now the spread stays open and the cover travels in.
- «любимая» becomes the огонёк icon.
- «Немного странно выглядит, что она становится размытой до того как открылась»: the change
  from sharp to blurred must be smooth. Now the sleeve's back is the same sharp cover; the
  blur comes up with the text.

## 2026-10-11 — the library and the statistics, the brief

- The library is redone in stages. **A defect to design around:** the mini player covers the
  bottom of today's library list.
- **Albums stay**, «плиткой или строками, как было в V1 примерно», and **artists** stay.
  **No tracks view:** search on the same page covers the tracks.
- **Search of the library** on the page, no AI: albums, songs and artists, **the kind of
  each result told apart clearly** (colour or otherwise). Not a field like today's: «заметной,
  но не очень большой иконкой поиска».
- **Playlists stay** on the page; the playlist's own screen is not redone yet.
- Sorts: «слушаю чаще», «новые», «по алфавиту», «по году». A sort by genre is wanted, «но хз
  как оформить».
- **Statistics come back** (v1's), with the extra cut. Keep: listening time, listening
  days, the favourite artist and song. Under the time, varying phrases that compare it
  with something («столько же, сколько лететь до Луны»). Perhaps a listener's profile: a
  short AI-written portrait («ты обожаешь слушать Канье и любишь экспериментальный
  хип-хоп»), written properly, «без тезисных и водяных предложений». The LLM is not
  available now, so it cannot be checked on Qwen. **No charts of library quality**; the
  spread by years and genres as a short, good-looking summary is fine.
- Before the design: a product manager's list of surfaces and engagement for the library,
  for him to take or turn down.

**His picks from the list (same day).** Taken: **«Пластинка дня»** and **«Не распечатаны»**
(albums never played), «только надо не загромоздить и не сделать ощущение, что это одно и
то же»; **genre as record-store dividers** and **shelves by sound** (the taste map's
clusters), «мб вместе»; **a listener's portrait built from data, no LLM** (the LLM text
later on top); **the streak of days and the best streak**. Not taken now: «Давно не ставил»,
«Достать наугад», «Год назад», «Играть то, что на экране», the album's progress arc,
«любимые и брошенные», the month's recap, «Общее с…», the release radar.

**Achievements** (his turn of the «milestones» idea): «прослушал 200 треков в день, скипнул
30 треков подряд, послушал одну песню 5 раз». **Ten to start**, each named by a short funny
line; more later. They live in the statistics. When one is earned, **a pop-up comes in at
the top right** with a small picture and the text, and **a quiet «бульк»** or a similar
sound.

## 2026-10-11 — the library, round 1 (`design/reference/library/`)

**He chose «В · Стена»** («прикольно выглядит»). His fixes:
- A click on the whole card must **open the gatefold**; only ▶ plays at once. (The mock played
  a sealed album on any click: my error.)
- The sealed look and the unwrapping were «довольно простые… выглядит дешево и плохо», the
  film hardly noticeable: either the effects of really taking the film off a new product, or
  drop it. **The gamification of unheard albums he likes.**
- The sort switch, the tiles/rows switch and the search button are out of style: **softer**.
- Groups for every sort: «Слушаю чаще» split by baseline bands (very often … never), by
  quintiles for instance; А–Я too. **A way to jump between groups** (year and genre mean a lot
  of scrolling).
- Titles in the wall get cut: bigger tiles so the text fits. The page lags and the covers are
  soft: he asked whether prod will be like that.
- Rows: drop the number of songs; **bigger type everywhere**, the column headers above all
  («плохо видно»).
- Between the top bar and a sticky section header a strip of background leaks through: the
  section header could be a floating block, «мб даже liquid glass блок», not a full band.
- In the wall, Artists must match the albums' wall. Playlists: improve; the bar overlaps them,
  and the page is filled a third, at the top: **«слишком много пустого места нельзя делать»**.
- (later the same day) **Pictures must arrive organically**: «картинки одновременно быстро могут
  не прогрузиться… прогрузка картинок не должна выглядеть плохо, а органично».

Round 2 (same URL, version 2): «Стена» only. Groups for every sort (listening bands by
quintiles: 14+, 7–13, 3–6, 1–2, never; letters; months; decades; genre by tags or sound), the
in-flow heading in big type, the floating glass plate of the current group (opens the list
of groups), the index rail at the right edge; the film redone (haze, light under the pointer,
corners, seam, a shop sticker «не слушал»; the corner is pulled, the film peels back over
itself, crumples and drops, a quiet synthesized crinkle; opening a sealed album unwraps it);
soft pill controls; bigger tiles, two-line titles; rows without the song count and with
bigger type; artists as the same wall (names always on); playlists sized to fill the screen;
covers load as colour → 20 px sketch → develop, in a wave from the top left.

## 2026-10-11 — the library, round 2

«В остальном супер, молодец, так держать!» His fixes:
- Scrolling the wall feels 30–40 fps on his 165 Hz screen (prod scrolls smoother). Maybe the
  artifact; no big optimization now, but **if the built screen scrolls like that, optimize**.
- The rail's groups are hardly visible until you look there: **bolder, the active one in the
  playing song's accent**.
- The list that opens from the glass plate must be **glass like the plate**.
- The unwrapping is fine, but it stuttered badly the first times: optimize. **No falling ball**:
  after the film comes off, its remains just **evaporate**, softly.
- Artists: we know their **country** — a grouping by country as an option; the statistics can
  play on it too («любимые артисты — американские»).
- Playlists: the right half of the page was empty.
- **An album unwrapped but not listened to is wrapped again** and put back.
- «Пластинка дня» inside a group read as if it belonged there: **it must stand apart**; being
  bigger is right. Its label a little bigger.

Round 3 (same URL, version 3): the day's record in its own cover-lit band above the groups;
the rail bolder with the open group in the playing song's accent; the jump list in glass; the
peel on one canvas with the sound prepared at the first touch, remains evaporate; unheard
albums re-wrapped; artists by country; playlists sized to fill the page; sketches dropped
under developed covers, smaller atlases loaded near the screen.

## 2026-10-11 — the library, round 3 → round 4

- Flags for the countries («эмодзи или как-то еще… чтобы визуал был соответствующий»): real
  SVG flags (emoji flags are two letters on Windows).
- A soft move from group to group on a rail click.
- Playlists in round 3 had no visible edges («тупо куча картинок»): each needs to read as one
  thing.
- **Liquid glass on floating blocks: «Запомни этот liquid glass эффект на блоках — мне он
  очень зашел. Если его аккуратно добавлять к месту (не часто) — будет офигенно.»**
- The search field must cover every block behind it.
- The tab underline went to the left edge before travelling to the chosen tab: a bug.
- «Поправь и погнали дальше»: the wall is approved with these fixes (round 4, version 5).
- Asked what next (build the wall or design the statistics), he chose **the statistics mock
  first**; the library and the statistics are then built together.

## 2026-10-11 — the statistics, round 1 (same artifact, version 6)

Shown: variant А «Разворот» (open: the time huge with a rotating comparison, the days as a
calendar by weeks and the streak, the favourite artist and song big, the portrait as a
paragraph built from data, a short summary of years, genres and the artists' countries, ten
die-cut stickers for the achievements) and variant Б «Плитки» (the same as tiles of the wall).
The achievements are counted on his real history (5 of 10 earned); the pop-up is a small
glass card at the top right, the sticker slapped onto it with a quiet synthesized «бульк».
Awaiting his reaction.

## 2026-10-11 — the statistics, round 1 → round 2

**He chose «А · Разворот»** (Б «Плитки» dropped). His fixes:
- Labels and figures too small («Ты слушал музыку», «24,5 ч музыки»…); the favourite's name
  needs an accent (bigger). The composition read «хаосно»; the days block too tall. **Colour
  the days in shades of the favourite song's cover** («как акцент, хорошая штука»).
- **More comparisons for the time**, «разнообразное и прикольное и неожиданное, мб пару штук с
  приколом» (space was only his example).
- The portrait took the left half, the right empty: optimize the composition. **Portrait under
  the time, the favourites below it.**
- Charts too small (text, bars); the years chart's columns thin: «более прогрессивный и стильный,
  но чтобы был понятный».
- Achievement icons too big; their text bigger.
- More data: a careful **carousel for the top 2–3 artists and songs**.
- **The achievement pop-up in liquid glass**, «как мы делали».

Round 2 (version 7): time → portrait; days (smaller, in the cover's colour) and three facts
(per day, the hour with a small 24-bar chart, finished share) on the right; favourites as a
stack of the top three that turns; the years as a smooth landscape with the peak marked and a
crosshair; genres and countries larger; smaller stickers; 14 comparisons (dumplings, Bohemian
Rhapsody, a rickroll, Cage's 4′33″, Randy Gardner's sleepless record, a sloth, lectures,
«Сапсан», Game of Thrones, Spanish vs his top artist, heartbeats, the Moon, the ISS, walking);
the pop-up in the plate's glass with a sheen. Awaiting his reaction.

## 2026-10-11 — the statistics, round 2 → round 3

- «О, крутая анимация и стопка картинок альбомов, мне понравилась!» Bugs: the carousel's
  text block changed height, so the arrows jumped and «следующий» was hard to hit; the text
  moved vertically and was clipped at the top during the change, as if inside an invisible
  box (the rank chip got eaten). The rank («место») bigger.
- The years chart is fine, its type bigger.
- **No pop-up tooltip repeating information on charts: the bars move as on the home's week**
  (the bar under the pointer stretches and brightens, the number says its value in place).
  The hours chart bigger, with the same move.
- «Is this the real life» — «крутая, хорош, мне понравилась)) Надо еще таких.»
- Small elements («в среднем за день», «дослушиваешь до конца», small captions) look small
  against the rest: **balance the type**; the upper right has room.

Round 3 (version 8): the three texts stacked in one cell (stable height, no clipping, the one
leaving fades fast, the next arrives after it); rank chip 19 px; every chart grows in when
first seen and answers the pointer in place (calendar → the day, hours → the hour, genres and
countries → the caption, years → a dot along the curve and the caption); hours chart 88 px
across the right column; facts 46 px; 21 comparisons (7 new music ones). Awaiting his reaction.

## 2026-10-11 — the statistics, round 3 → **approved**

Fixes asked and made (version 9): the comparison's change was jerky (the icon twitched, the
text lagged and was clipped at the top) → two lines kept, the old one dissolves, the new one
develops in place, the icon turns once on click; the hour bars answered the pointer a second
late (the grow-in stagger delayed every transition) → the stagger only for the first growth;
the year under the pointer **is said above its point**, not under the chart.
**Liquid glass: «давай ВЕЗДЕ сделаем поисковую строку в стиле liquid glass» — in the library
and later on the home; the left island in the same glass.**
«В остальном — утверждаю»: the library «Стена» and the statistics «А» are approved.

«Норм, погнали» → built on `v2` (2026-10-11) and checked on the owner's own data, read-only:
covers, groups, flags, the film, search, the statistics and the achievements as in the mock;
scrolling keeps the frame. The home's search field is in the same glass now (its results
too); glass reads the theme: light under the light theme, dark again inside the dark home and
player. Awaiting his check before prod.

## 2026-10-11 — after the library went live

- «Давай улучшим плавность и качество переходов между вкладками главная, библиотека и вкладками
  в библиотеке … плавно в духе нашего v2 дизайна» and «открытие плеера из миниплеера и всех
  других возможных экранов надо сделать анимированным» → page changes designed and built
  (`motion-and-performance.md` «Page changes»).
- «Может сразу запрашивать стату при заходе на вкладку библиотеки? Она же мало весит» → the
  statistics are asked for when the library opens.
- «Шрифт портрета слушателя крупноват — давай немного снизим шрифт больших элементов (20–30 %)»
  → the hours, the comparison, the portrait, the days, the facts and the favourite names are
  about a quarter smaller; captions keep the size he asked for in round 2.
- **Liquid glass v2**: «под liquid glass (теперь я его называю liquid glass v2) я имею в виду
  прозрачную кнопку, которая вылезает как мини шапка „заслушаны до дыр“ … а не старый liquid
  glass без прозрачного фона. Замени везде на liquid glass v2» (`surfaces.md`). He asked why the
  list from the glass plate was not in the same glass.
- Bugs he found on prod, fixed: a jump from the rail threw the rail onto the albums and painted
  it full (a transformed parent held the fixed rail); the covers shifted when an album opened
  and back when it closed (the scrollbar's room was lost under the gatefold); the rail's label
  trailed the pointer (now 1:1, every frame); the wall once slid over «Пластинка дня» (the band
  was measured once; now watched while it stands).

## 2026-10-11 — page changes, round 2

- The island: «при выборе библиотеки иконка на время пропадает» (the lens was drawn over the
  items during a change); «не как liquid glass v2 сделан, ровно как и поиск по песням»; a colour
  rectangle around it while the player opened or closed (the edge of the round-1 sheet); «эффект
  переливания блока при наведении — убрать, а только добавить реакцию иконок на наведение» → the
  island is the one glass recipe, no sheen; the open section sits under a clear glass lens; icons
  rise and grow a little on hover, press in on press; the sheen stays only on small glass
  controls (the plate, the search button).
- «Переходы в плеер из мини плеера в целом норм с точки зрения эффекта обложки, но прямоугольник
  фона, наезжающий на экран — плохо … ровно как и переходы между вкладками в библиотеке. Надо
  переделать качественно … в стиле Apple» → round 2 of page changes (`motion-and-performance.md`).
- «Смена группировок в библиотеке … без эффекта, рвано выглядит … и выбор „не распечатаны“» → a
  new grouping, a view and the filter settle in place under the bar.
- «Альбомы без обложек выглядят чёрными, а при раскрытии — с рандомным цветом» → one soft
  gradient per album (its hue fixed by the album), the same on the wall, in the gatefold and in
  the players (`web/src/lib/coverFill.ts`).
- «Убери полоску скролла на библиотеке — там уже есть полоска с группировкой» → no browser
  scrollbar on the library.

