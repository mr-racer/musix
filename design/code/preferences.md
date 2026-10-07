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

