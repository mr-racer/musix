/* MusiX — the artist page mock, round 1. Data: window.DATA (the frozen v1 snapshot of 2026-10-01,
   read-only) + Apple Music images fetched 2026-10-14 for variant В. EDIT holds what the mock fixes
   by hand (original release years, Russian place names, translated facts) and the example texts an
   LLM would write (marked «идея»). */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function icon(name, size = 18) {
  const def = window.ICONS[name]; if (!def) return "";
  return `<svg class="ic" style="--s:${size}px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${def.w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${def.d.map((d, i) => `<path d="${d}"${def.fill.includes(i) ? ' fill="currentColor"' : ""}/>`).join("")}</svg>`;
}
const hydrate = (root = document) => { for (const el of $$("[data-ic]", root)) el.outerHTML = icon(el.dataset.ic, +(el.dataset.s || 18)); };
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
const img = (n) => `img/${n}.${n.endsWith("-cut") || n.endsWith("-logo") ? "png" : "jpg"}`;

const COUNTRY = { US: "США", GB: "Великобритания", CA: "Канада", AU: "Австралия", BB: "Барбадос", SE: "Швеция", IE: "Ирландия" };
const EDIT = {
  "kanye-west": { city: "Чикаго, Иллинойс", years: { "The College Dropout": 2004 },
    tagline: "Чикагский продюсер, который превратил соул-семплы в манифест и с тех пор спорит со всем миром.",
    facts: ["Его отец Рэй Уэст состоял в «Чёрных пантерах» и был одним из первых чернокожих фотожурналистов в газете The Atlanta Journal-Constitution.", "Имя Kanye на суахили означает «единственный»."],
    eras: [[2004, 2007.6, "соул-семплы"], [2008, 2008.9, "автотюн и разбитое сердце"], [2010, 2013.8, "барокко и индастриал"], [2016, 2022.6, "госпел и исповедь"], [2024, 2026.4, "Vultures"]],
    qs: ["Почему 808s & Heartbreak звучит совсем иначе?", "Какие семплы в Graduation?", "С чего начать после Donda?"] },
  eminem: { city: "Детройт, Мичиган", years: { "The Eminem Show (Expanded Edition)": 2002 },
    tagline: "Детройтский рэпер, который сделал из своей биографии самую громкую исповедь в хип-хопе.",
    facts: ["Настоящее имя — Маршалл Мэтерс. «Eminem» — это его инициалы M. M., прочитанные вслух.", "Он остался на второй год в девятом классе и в итоге бросил школу."],
    eras: [[1999, 2004.7, "Слим Шейди"], [2009, 2010.8, "срыв и восстановление"], [2022, 2024.8, "прощание с Шейди"]],
    qs: ["Кто такой Слим Шейди?", "За что Eminem получил 15 Грэмми?", "О чём на самом деле Stan?"] },
  "lady-gaga": { city: "Нью-Йорк", tagline: "Нью-йоркская пианистка, которая превратила поп в театр и меняет кожу каждые несколько лет.",
    facts: ["Настоящее имя — Стефани Джерманотта. По её словам, играть на фортепиано на слух она научилась в четыре года.", "Её отец Джо Джерманотта в 2002 году основал компанию, которая проводила Wi‑Fi в отели."],
    ghosts: [["The Fame", 2008], ["Born This Way", 2011], ["Artpop", 2013], ["Joanne", 2016], ["Chromatica", 2020], ["Mayhem", 2025]],
    qs: ["С чего начать слушать Lady Gaga?", "Что за эпоха Mayhem?", "Почему её назвали в честь Radio Ga Ga?"] },
  "arctic-monkeys": { city: "Шеффилд, Англия", tagline: "Шеффилдские подростки из интернет-демок, выросшие в самую стильную рок-группу Британии.",
    facts: ["Аудиторию они собрали в 2004 году: поклонники сами раскидали их демо по интернету.", "Все четверо были подростками, когда собрали группу. Алекс Тёрнер рассказывал BBC, что гитары им подарили на Рождество."],
    ghosts: [["Humbug", 2009], ["Suck It and See", 2011], ["Tranquility Base Hotel & Casino", 2018], ["The Car", 2022]],
    qs: ["Почему AM звучит не как ранние альбомы?", "С чего начать после AM?", "Кто такой Алекс Тёрнер вне группы?"] },
  "the-weeknd": { city: "Торонто, Онтарио", tagline: "Тёмный R&B из Торонто, ставший саундтреком ночных городов.",
    facts: ["Абель Тесфайе вырос в Скарборо, районе Торонто. Его в основном растила бабушка, пока мать работала.", "По словам продюсера Джереми Роуза, The Weeknd начинался как их общий проект, но они разошлись прямо перед взлётом Тесфайе."],
    qs: ["Чем закончилась трилогия After Hours?", "Откуда в Blinding Lights восьмидесятые?", "Почему The Weeknd пишется без третьей «e»?"] },
  "maroon-5": { city: "Лос-Анджелес, Калифорния", tagline: "Поп-рок из Лос-Анджелеса, где каждый альбом — набор будущих радиохитов.",
    facts: ["Группа начиналась в 1994 году как Kara's Flowers, когда Адам Левин, Джесси Кармайкл и Микки Мэдден ещё учились в школе.", "Дебютный Songs About Jane выстрелил не сразу: его вытянули пять синглов подряд."],
    qs: ["Как Kara's Flowers стали Maroon 5?", "С чего начать слушать Maroon 5?", "Кто пишет их хиты?"] },
  "michael-jackson": { city: "Гэри, Индиана", years: { Thriller: 1982 }, tagline: "Король поп-музыки: от детского голоса Jackson 5 до Thriller, самого продаваемого альбома в истории.",
    facts: ["Майкл был седьмым из девяти детей. Семья жила в двухкомнатном доме в Гэри, и шестеро братьев спали в одной комнате.", "Был женат дважды: на Лизе Мари Пресли (1994–1996) и на Дебби Роу (1996–1999)."],
    qs: ["Как снимали клип Thriller?", "Кто продюсировал Bad и Thriller?", "Что было после Dangerous?"] },
  "nothing-but-thieves": { city: "Саутенд-он-Си, Эссекс", tagline: "Эссексский рок с фальцетом Конора Мейсона и гитарами размером со стадион.", facts: [],
    qs: ["С чего начать слушать Nothing But Thieves?", "О чём альбом Moral Panic?", "Кто ещё звучит похоже?"] },
};

const D = window.DATA;
const S = { i: 0, v: "a", size: "win", ideas: true, shelf: null };
try { Object.assign(S, JSON.parse(localStorage.getItem("mx-artist-mock") || "{}")); } catch {}
const save = () => { try { localStorage.setItem("mx-artist-mock", JSON.stringify(S)); } catch {} };

// ── data prep ────────────────────────────────────────────────────────────
function prep(a) {
  const e = EDIT[a.slug] || {};
  const albums = a.albums.map((al) => {
    const m = /\s*[(\[]([^)\]]*(?:Edition|Deluxe|Version|Remaster|Tour)[^)\]]*)[)\]]\s*$/i.exec(al.title) || /\s*,?\s*-\s*(EP)$/.exec(al.title);
    return { ...al, year: e.years?.[al.title] ?? al.year, clean: m ? al.title.slice(0, m.index).replace(/,\s*$/, "") : al.title, ed: m ? m[1].replace(/Australian Tour Edition/i, "Tour Edition").replace(/Expanded Edition/i, "Expanded") : null };
  }).sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999));
  // the bio as v1 left it may open with the agent's English note: drop sentences until Russian starts
  let lines = (a.bio || "").split(/\n+/);
  while (lines.length > 1 && !/[а-яё]/i.test(lines[0])) lines.shift();
  let bio = lines.join(" ").replace(/\*([^*]+)\*/g, "$1").replace(/The bio facts are confirmed[^.]*\.\s*I will now write[^.]*\.\s*/i, "");
  const first = albums.find((x) => x.year)?.year;
  const start = a.formedYear ?? first, dead = a.status === "deceased", ended = dead || a.status === "disbanded";
  return { ...a, e, albums, bio: bio.replace(/\s*\n+\s*/g, " ").trim(), start, end: ended ? a.activeTo : null, dead,
    country: COUNTRY[a.cc] || (a.cc ? new Intl.DisplayNames(["ru"], { type: "region" }).of(a.cc) : null) };
}
const level = (a) => {
  const cov = a.albums.filter((x) => x.heard / x.n >= 0.5).length / Math.max(1, a.albums.length);
  const L = [["Знакомство", 0], ["Слушатель", 10], ["Фанат", 50], ["Знаток", 150], ["Летописец", 300]];
  let k = 0; for (let j = 0; j < L.length; j++) if (a.plays >= L[j][1] && (j < 3 || cov >= (j === 3 ? .5 : 1))) k = j;
  const nx = L[k + 1];
  let need = null, p = 1;
  if (nx) {
    const covNeed = k + 1 === 3 ? .5 : k + 1 === 4 ? 1 : 0;
    if (a.plays < nx[1]) { need = `ещё ${nx[1] - a.plays} ${plural(nx[1] - a.plays, "прослушивание", "прослушивания", "прослушиваний")} до «${nx[0]}»`; p = a.plays / nx[1]; }
    else { const left = Math.ceil(covNeed * a.albums.length) - Math.round(cov * a.albums.length); need = `дослушай ещё ${left} ${plural(left, "альбом", "альбома", "альбомов")} до «${nx[0]}»`; p = cov / covNeed; }
  }
  return { name: L[k][0], k, need, p: Math.min(1, p), cov };
};

// ── statuette: the gramophone, gold for a win, a hollow outline for a nomination ──
const STATUE = (win, id) => `<svg viewBox="0 0 20 30" aria-hidden="true">${win ? `<defs><linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c9"/><stop offset=".35" stop-color="#e8c66e"/><stop offset=".7" stop-color="#b48a33"/><stop offset="1" stop-color="#7a5717"/></linearGradient></defs>` : ""}
  <g fill="${win ? `url(#g${id})` : "none"}" stroke="${win ? "rgba(90,62,12,.55)" : "#c9a24f"}" stroke-width="${win ? .5 : 1}" stroke-linejoin="round">
  <path d="M9 13.4C9.2 10.6 10.6 8.6 12.7 7.1L15.1 1.2C17 1.6 19 3.5 19.7 5.7L13.7 8.5C11.9 9.7 10.7 11.3 10.5 13.4Z"/>
  <ellipse cx="10" cy="14.2" rx="6.4" ry="1.7"/><rect x="9" y="15.6" width="2" height="7.4" rx=".6"/>
  <path d="M3.6 23.2h12.8l.9 2.4H2.7z"/><rect x="2.2" y="25.6" width="15.6" height="3.4" rx=".8"/></g></svg>`;

// ── render ───────────────────────────────────────────────────────────────
let A = null;
function render() {
  A = prep(D.artists[S.i]);
  const app = $(".app"); app.classList.toggle("ideas", S.ideas);
  const page = $("#page"); page.dataset.v = S.v; page.scrollTop = 0;
  const am = A.apple || {}, cAm = S.v === "c" && (am.wide || am.sq);
  const bd = `url(${img(A.slug + "-bg")})`;
  page.style.cssText = `--tint:${A.tint};--bd:${bd};--photo:url(${img(A.photo)});--abg:${am.bg && lum(am.bg) < .3 ? am.bg : "#0d0d10"};${A.cut ? `--cuturl:url(${img(A.cut)});` : ""}${cAm ? `--wide:url(${img(am.wide || am.sq)});` : `--wide:url(${img(A.photo)});`}`;
  $(".mini").style.setProperty("--mini-acc", A.tint);
  const words = (s) => s.split(/\s+/).map((w, i) => `<span class="w" style="--i:${i}">${esc(w)}</span>`).join(" ");
  const place = [A.e.city].filter(Boolean).join("");
  const span = A.start ? (A.dead ? `${A.start}–${A.end}` : A.end ? `${A.start}–${A.end}` : `с ${A.start}`) : null;
  const status = A.dead ? `<small>✝</small>` : A.status === "hiatus" ? `<span class="st">на паузе</span>` : "";
  const q = A.nameOrigin ? `<button class="q" type="button" id="qBtn" aria-label="Откуда название">?</button>` : "";
  const useLogo = S.v === "c" && am.logo;
  const nameEl = useLogo ? `<h1 class="name" style="font-size:0;line-height:0"><img class="logo" src="${img(am.logo)}" alt="${esc(A.name)}">${q}</h1>` : `<h1 class="name">${words(A.name)}${q}</h1>`;
  const lv = level(A);
  const hero = `
    <section class="hero" id="hero">
      <div class="hbg">${S.v === "c" ? `<div class="photo ${am.wide ? "" : "sq"} ${am.bg && lum(am.bg) > .55 ? "light" : ""}" id="photo"></div>` : `<div class="bd" id="bd"></div>`}<i class="grain"></i><i class="shade"></i></div>
      <a class="back" href="#" data-toast="Назад к артистам в библиотеке">${icon("ChevronLeft", 16)}Артисты</a>
      ${S.v === "b" ? `<h2 class="bigname ${A.cut ? "" : "photo"}" id="big" aria-hidden="true">${words(A.name)}</h2>` : ""}
      ${A.cut && S.v !== "c" ? `<div class="glow" id="glow"></div><div class="fig" id="fig"><div class="cutbox">${["cut", "wrap", "rim"].map((k) => k === "cut" ? `<img class="lay cut" src="${img(A.cut)}" alt="">` : `<i class="lay ${k}"></i>`).join("")}</div></div>` : ""}
      ${!A.cut && S.v === "a" ? `<div class="glow" id="glow"></div><div class="fig portrait" id="fig"><div class="cutbox"><img class="lay cut" src="${img(A.photo)}" alt=""></div></div>` : ""}
      <i class="floor"></i>
      <div class="htext">
        ${S.v === "b" ? `<h1 class="sr">${esc(A.name)}</h1>${q ? `<p class="nm2">${q.replace('class="q"', 'class="q q2"')}<span>откуда название</span></p>` : ""}` : nameEl}
        <p class="tagline idea">${esc(A.e.tagline || "")} <span class="idea-tag">${icon("Sparkles", 11)}идея · ИИ</span></p>
        <div class="meta">
          ${A.country ? `<span>${A.cc && FLAGS[A.cc.toLowerCase()] ? `<img class="flag" src="${FLAGS[A.cc.toLowerCase()]}" alt="">` : ""}${esc(A.country)}${place ? ` <small>${esc(place)}</small>` : ""}</span>` : ""}
          ${A.genre ? `<span>${esc(GENRE[A.genre] || A.genre)}</span>` : ""}
          ${span ? `<span>${span} ${status}</span>` : ""}
        </div>
        <div class="lib">${A.albums.length} ${plural(A.albums.length, "альбом", "альбома", "альбомов")} · ${A.tracks} ${plural(A.tracks, "песня", "песни", "песен")} в библиотеке · ${A.plays} ${plural(A.plays, "прослушивание", "прослушивания", "прослушиваний")}</div>
        <div class="acts">
          <button class="btn play" type="button" data-toast="Играет: всё от ${esc(A.name)}, начиная с самых любимых">${icon("Play", 16)}Слушать</button>
          <button class="btn ghost" type="button" data-toast="Перемешано: ${A.tracks} ${plural(A.tracks, "песня", "песни", "песен")}">${icon("Shuffle", 17)}Вперемешку</button>
          <button class="btn ghost idea" type="button" data-toast="«Поток» от ${esc(A.name)}: его песни и похожие по звучанию из библиотеки">${icon("Sparkles", 17)}Поток артиста</button>
        </div>
      </div>
      ${S.v === "c" ? `<div class="src">${cAm ? `Фото: Apple Music${am.wide ? " · широкий кадр" : ""}` : "Apple Music отдаёт пустой кадр — фото из TheAudioDB"}</div>` : ""}
      ${A.nameOrigin ? `<div class="origin lg" id="origin" role="dialog"><b>Откуда название</b>${esc(A.nameOrigin)}</div>` : ""}
    </section>`;
  const albumsMode = S.shelf ?? (S.v === "a" ? "shelf" : "line");
  const body = `
    <div class="in body">
      <section class="lead">
        <div class="story">
          <h2 class="h2">Коротко <span class="ai">ИИ</span></h2>
          <div class="bioWrap" id="bioWrap"><p class="bio" id="bio">${esc(A.bio)}</p></div>
          <button class="more" type="button" id="more">Читать дальше${icon("ChevronRight", 14).replace('class="ic"', 'class="ic" style="--s:14px;rotate:90deg"')}</button>
          ${grammyOf(A) || A.e.facts?.length ? `<dl class="dossier">${dossier(A)}</dl>` : ""}
        </div>
        ${grammyOf(A) ? grammyHTML(A) : A.e.facts?.length ? `<div class="side">${factHTML(A)}</div>` : `<dl class="dossier col">${dossier(A)}</dl>`}
      </section>
      <section class="disco">
        <h2 class="h2">Дискография <small>${A.albums.length} в библиотеке · по годам</small></h2>
        ${albumsMode === "line" ? `<div class="tl" id="tl"></div>` : shelfHTML(A)}
      </section>
      <section class="two">
        <div class="songs">
          <h2 class="h2">Слушаешь чаще всего <small>${A.plays} ${plural(A.plays, "раз", "раза", "раз")}</small></h2>
          <div class="rows">${A.top.map((t, i) => row(t, i, A.top[0].plays)).join("")}</div>
          <button class="more allsongs" type="button" data-toast="Откроются все ${A.tracks} ${plural(A.tracks, "песня", "песни", "песен")}">Все ${A.tracks} ${plural(A.tracks, "песня", "песни", "песен")}${icon("ChevronRight", 14)}</button>
        </div>
        <div class="side">
          <div class="fan idea">
            <div class="sticker">${sticker(lv.k)}</div>
            <div><div class="lv">${lv.name} <span class="idea-tag">идея</span><small>№${A.rank} в твоей библиотеке · слушаешь с ${since(A.since)} · дослушано ${Math.round(lv.cov * A.albums.length)} из ${A.albums.length} ${plural(A.albums.length, "альбома", "альбомов", "альбомов")}</small></div>
              ${lv.need ? `<div class="prog" style="--p:${lv.p.toFixed(3)}"><i></i></div><div class="nx">${lv.need}</div>` : `<div class="nx">высший уровень — ты знаешь всю дискографию в библиотеке</div>`}</div>
          </div>
          ${A.e.facts?.length && grammyOf(A) ? factHTML(A) : ""}
          ${A.with.length ? `<div class="with"><h2 class="h2">Рядом в библиотеке <small>общие песни</small></h2><div class="chips">${A.with.map((w) => `<a href="#" data-toast="Откроется ${esc(w.name)}">${w.img ? `<img src="${img(w.img)}" alt="">` : `<span class="ini">${esc(w.name.slice(0, 1))}</span>`}${esc(w.name)} <small>${w.n}</small></a>`).join("")}</div></div>` : ""}
        </div>
      </section>
      <section class="idea">
        <h2 class="h2">Спросить ассистента <span class="idea-tag">${icon("Sparkles", 11)}идея</span></h2>
        <div class="qs">${(A.e.qs || []).map((x) => `<button type="button" data-toast="Откроется ассистент: «${esc(x)}»">${icon("Sparkles", 16)}${esc(x)}</button>`).join("")}
          <button type="button" data-toast="Квиз: угадай ${esc(A.name)} по первым секундам — 10 песен из твоей библиотеки">${icon("Player", 16)}Квиз: угадай ${esc(A.name)} за 3 секунды</button></div>
      </section>
    </div>`;
  page.innerHTML = hero + body;
  $("#mini-cover").src = img(A.top[0].cover || A.photo); $("#mini-t").textContent = A.top[0].title; $("#mini-a").textContent = A.name;
  for (const b of $$(".mockbar [data-v]")) b.setAttribute("aria-pressed", String(b.dataset.v === S.v));
  for (const b of $$(".mockbar .who")) b.setAttribute("aria-pressed", String(+b.dataset.i === S.i));
  for (const b of $$(".mockbar [data-size]")) b.setAttribute("aria-pressed", String(b.dataset.size === S.size));
  for (const b of $$(".mockbar [data-al]")) b.setAttribute("aria-pressed", String(b.dataset.al === albumsMode));
  $(".idea-t").setAttribute("aria-pressed", String(S.ideas));
  requestAnimationFrame(() => { $("#bd")?.classList.add("on"); const ph = $("#photo"); if (ph) { const im = new Image(); im.onload = () => ph.classList.add("on"); im.src = (cAm ? img(am.wide || am.sq) : img(A.photo)); } });
  wire(); layout();
  // the bio only offers «Читать дальше» when it is clamped
  requestAnimationFrame(() => { const b = $("#bio"); if (b && b.scrollHeight <= b.clientHeight + 2) $("#more").hidden = true; });
}
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
const since = (s) => { if (!s) return "недавно"; const d = new Date(s.replace(" ", "T")); return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); };
const GENRE = { "Hip-Hop": "Хип-хоп", Pop: "Поп", Rock: "Рок", "R&B": "R&B", Electronic: "Электроника" };

function dossier(a) {
  const out = [];
  if (a.e.city || a.country) out.push(["Откуда", a.e.city || a.country, a.e.city ? a.country : ""]);
  if (a.formedYear) out.push([a.cut && /group|band/i.test("") ? "Основаны" : "Начало", a.formedYear, a.formedPlace && !a.e.city ? a.formedPlace : ""]);
  if (a.label) out.push(["Лейбл", a.label, ""]);
  if (a.genre) out.push(["Жанр", GENRE[a.genre] || a.genre, ""]);
  return out.map(([k, v, s]) => `<div><dt>${k}</dt><dd>${esc(v)}${s ? `<small>${esc(s)}</small>` : ""}</dd></div>`).join("");
}

function grammyOf(a) { return a.grammyWins != null || a.grammyNoms != null; }
function grammyHTML(a) {
  const w = a.grammyWins || 0, n = a.grammyNoms;
  const lib = D.grammyLib, above = lib.filter((g) => g.wins > w), pos = above.length + 1;
  const hollow = n != null ? Math.max(0, n - w) : 0, total = w + hollow;
  const gw = total > 40 ? 15 : total > 26 ? 18 : total > 16 ? 21 : 26;
  let line, rank = "";
  if (w === 0 && n) line = `<b>${n} ${plural(n, "номинация", "номинации", "номинаций")}</b> и ни одной статуэтки. Академия, ну.`;
  else if (n) line = `<b>${w} из ${n}</b>: побеждает в ${Math.round(w / n * 100)}% номинаций.`;
  else line = "";
  if (w > 0) {
    const names = above.slice(0, 5).map((g) => g.name);
    rank = `<div class="grank"><span class="pos">№${pos}</span><span>${pos === 1 ? "больше всех в твоей библиотеке" : pos <= 6 ? `по Грэмми в твоей библиотеке — больше только у ${names.join(", ")}` : `среди ${lib.length} ${plural(lib.length, "лауреата", "лауреатов", "лауреатов")} Грэмми в твоей библиотеке · у лидера, ${lib[0].name}, ${lib[0].wins}`}</span></div>`;
  } else rank = `<div class="grank"><span>В твоей библиотеке ${D.grammyLib.length} ${plural(D.grammyLib.length, "лауреат", "лауреата", "лауреатов")} Грэмми · ${D.grammyLib.reduce((s, g) => s + g.wins, 0)} статуэток</span></div>`;
  return `<aside class="grammy" id="grammy">
    <div class="gtop"><span class="gtitle">${STATUE(true, "t")}Грэмми</span>
      <button class="ask" type="button" data-toast="Откроется ассистент: «За что ${esc(a.name)} ${w ? `получил ${w} Грэмми` : "номинировали на Грэмми"}?»">${icon("Sparkles", 14)}За что?</button></div>
    <div class="gnum"><b>${w}</b><span>${plural(w, "статуэтка", "статуэтки", "статуэток")}${n ? `<small>из ${n} ${plural(n, "номинации", "номинаций", "номинаций")}</small>` : ""}</span></div>
    <div class="shelf" style="--gw:${gw}px">${Array.from({ length: w }, (_, i) => `<span class="st win" style="--gw:${gw}px;--i:${i}">${STATUE(true, i)}</span>`).join("")}${Array.from({ length: hollow }, (_, i) => `<span class="st nom" style="--gw:${gw}px;--i:${i}" title="номинация">${STATUE(false, "n" + i)}</span>`).join("")}</div>
    ${line ? `<p class="gline">${line}</p>` : ""}
    ${rank}
  </aside>`;
}

function sleeve(al, i, extra = "") {
  const lab = ["#c23b2b", "#e2b53d", "#3a6ec2", "#e9e4d8", "#2f8f5b", "#a34fc0"][i % 6];
  return `<div class="sl"><span class="disc" style="--lab:${lab}"></span>${al.cover ? `<img src="${img(al.cover)}" alt="" loading="lazy">` : `<span class="nocov"></span>`}
    <button class="pl lg" type="button" aria-label="Слушать" data-toast="Играет «${esc(al.clean)}»">${icon("Play", 15)}</button></div>${extra}`;
}
function alMeta(al) {
  return `<div class="ti">${esc(al.clean)}${al.ed ? `<span class="ed">${esc(al.ed)}</span>` : ""}</div>
    <div class="sub"><span class="mono">${al.year ?? "—"}</span><span class="bar" style="--p:${(al.heard / al.n).toFixed(3)}"><i></i></span><span>${al.heard}/${al.n}</span></div>`;
}
function shelfHTML(a) {
  let prev = null;
  return `<div class="shelfg">${a.albums.map((al, i) => { const same = al.year === prev; prev = al.year;
    return `<a class="al" href="#" style="--i:${i}" data-toast="Откроется разворот «${esc(al.clean)}»"><div class="yr${same ? " same" : ""}">${al.year ?? "—"}</div>${sleeve(al, i)}${alMeta(al)}</a>`; }).join("")}</div>`;
}
function row(t, i, max) {
  return `<div class="row" data-toast="Играет «${esc(t.title)}»"><span class="n">${i + 1}</span><span class="cv">${t.cover ? `<img src="${img(t.cover)}" alt="">` : ""}${icon("Play", 16)}</span>
    <span class="tt"><b>${esc(t.title)}</b><span>${esc(t.album || "")}</span></span><span class="pc"><i style="--p:${(t.plays / max).toFixed(3)}"></i>${t.plays}</span></div>`;
}
function factHTML(a) {
  const f = a.e.facts;
  return `<div class="fact" id="fact"><div class="fh">А ты знал<span class="pager"><button type="button" data-f="-1" aria-label="Назад">${icon("ChevronLeft", 15)}</button><span id="fpos">1 / ${f.length}</span><button type="button" data-f="1" aria-label="Дальше">${icon("ChevronRight", 15)}</button></span></div>
    <div class="fx">${f.map((x, i) => `<p aria-hidden="${i ? "true" : "false"}">${esc(x)}</p>`).join("")}</div><div class="fsrc">songfacts.com · перевод для макета</div></div>`;
}
function sticker(k) {
  const col = ["#9aa3b5", "#7fb0d8", "#e58fb1", "#e6c35c", "#b7a0ff"][k];
  const glyph = ["M12 7v6l4 2", "M6 15c2-4 10-4 12 0", "M12 6l1.8 3.9 4.2.5-3.1 2.9.8 4.2L12 15.4 8.3 17.5l.8-4.2L6 10.4l4.2-.5z", "M7 17V8l5-3 5 3v9M7 12h10", "M6 6h12v12H6zM9 9h6M9 12h6M9 15h4"][k];
  return `<svg viewBox="0 0 88 88"><circle cx="44" cy="44" r="41" fill="#fff"/><circle cx="44" cy="44" r="36" fill="${col}"/>
    <circle cx="44" cy="44" r="36" fill="url(#shine)" opacity=".5"/><defs><linearGradient id="shine" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <g transform="translate(26 22) scale(1.5)" fill="none" stroke="#1a1520" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${glyph}"/></g></svg>`;
}

// ── layout passes (run after render and on every resize) ─────────────────
function layout() { placeFigure(); fitBig(); if ($("#tl")) layoutTL(); }
function contentBox() {
  const hero = $("#hero"), w = hero.clientWidth, maxIn = 1680;
  const inW = Math.min(w, maxIn), x0 = (w - inW) / 2 + (w <= 900 ? 16 : 124), x1 = (w - inW) / 2 + inW - (w <= 900 ? 16 : 56);
  return { x0, x1, cw: x1 - x0, H: hero.clientHeight, W: w };
}
function placeFigure() {
  const fig = $("#fig"); if (!fig) return;
  const { x0, cw, H } = contentBox();
  const portrait = fig.classList.contains("portrait");
  const [iw, ih] = portrait ? [700, 700] : A.cutSize, box = portrait ? [80, 0, 620, 700] : A.cutBox;
  const [bx0, by0, bx1, by1] = box, bw = bx1 - bx0, bh = by1 - by0;
  let fh = H * (S.v === "b" ? .9 : .86), fw = fh * bw / bh;
  const maxW = cw * (S.v === "b" ? .5 : .44); if (fw > maxW) { fw = maxW; fh = fw * bh / bw; }
  const cx = x0 + cw * (S.v === "b" ? .68 : .76);
  Object.assign(fig.style, { width: fw + "px", height: fh + "px", left: cx - fw / 2 + "px" });
  for (const l of $$(".lay", fig)) Object.assign(l.style, { left: -bx0 / bw * 100 + "%", top: -by0 / bh * 100 + "%", width: iw / bw * 100 + "%", height: ih / bh * 100 + "%" });
  // what the source photo cut (an edge of the PNG) dissolves; the feet go into the floor
  const t = by0 <= 4 ? "transparent 0, #000 8%" : "#000 0", b = "#000 74%, transparent 100%";
  const l = bx0 <= 4 ? "transparent 0, #000 9%" : "#000 0", r = bx1 >= iw - 4 ? "#000 91%, transparent 100%" : "#000 100%";
  fig.style.setProperty("--fmask", `linear-gradient(to bottom, ${t}, ${b}), linear-gradient(to right, ${l}, ${r})`);
  if (portrait) fig.style.setProperty("--fmask", "linear-gradient(to right, transparent 0, #000 24%, #000 76%, transparent 100%), linear-gradient(to bottom, transparent 0, #000 14%, #000 66%, transparent 100%)");
  const g = $("#glow"), gs = fh * 1.05;
  Object.assign(g.style, { width: gs + "px", height: gs + "px", left: cx - gs / 2 + "px", top: H - fh - gs * .18 + "px" });
}
function fitBig() {
  const el = $("#big"); if (!el) return;
  const { cw, H } = contentBox();
  const words = A.name.split(/\s+/);
  el.style.setProperty("--fs", "100px"); el.style.right = "auto"; el.style.width = "max-content";
  el.innerHTML = words.map((w, i) => `<span class="w" style="--i:${i}">${esc(w)}</span>`).join(" ");
  const one = cw / el.getBoundingClientRect().width * 100;
  let fs = Math.min(one, H * .44), html = el.innerHTML;
  if (one < H * .26 && words.length > 1) {
    let best = null;
    for (let k = 1; k < words.length; k++) { const a = words.slice(0, k).join(" "), b = words.slice(k).join(" "); const m = Math.max(a.length, b.length); if (!best || m < best.m) best = { k, m }; }
    el.innerHTML = [words.slice(0, best.k), words.slice(best.k)].map((ws, j) => ws.map((w, i) => `<span class="w" style="--i:${i + j * 2}">${esc(w)}</span>`).join(" ")).join("<br>");
    const two = cw / el.getBoundingClientRect().width * 100;
    if (two > one * 1.15) { fs = Math.min(two, H * .25); html = el.innerHTML; }
  }
  el.innerHTML = html; el.style.setProperty("--fs", fs.toFixed(1) + "px"); el.style.width = ""; el.style.right = "";
}
function layoutTL() {
  const tl = $("#tl"), W = tl.clientWidth, als = A.albums.filter((x) => x.year);
  const ghosts = S.ideas ? (A.e.ghosts || []).map(([title, year]) => ({ clean: title, year, ghost: true })) : [];
  const all = [...als, ...ghosts].sort((x, y) => x.year - y.year), n = all.length;
  const lanes = n <= 3 ? 1 : 2;
  let Sz = Math.round(Math.min(196, Math.max(112, (W - 40) / Math.ceil(n / lanes) - 34)));
  const meta = 62, gap = 34, laneH = Sz + meta + gap;
  const axisY = laneH + 6, H = lanes === 2 ? laneH * 2 + 12 : laneH + 40;
  const y0 = Math.min(A.start ?? all[0].year, all[0].year) - 1, y1 = Math.max(all[n - 1].year, A.end ?? (A.dead ? all[n - 1].year : 2026)) + 1;
  const pad = Sz / 2 + 4, X = (y) => pad + (y - y0) / (y1 - y0) * (W - 2 * pad);
  // lanes alternate in time; inside a lane covers keep their order and push apart, then pull back from the right edge
  const L = [[], []];
  all.forEach((al, i) => { al.lane = lanes === 2 ? i % 2 : 0; al.tx = X(al.year + .5); L[al.lane].push(al); });
  for (const lane of L) {
    for (let k = 0; k < lane.length; k++) lane[k].x = Math.max(lane[k].tx, k ? lane[k - 1].x + Sz + 26 : Sz / 2);
    for (let k = lane.length - 1; k >= 0; k--) lane[k].x = Math.min(lane[k].x, k < lane.length - 1 ? lane[k + 1].x - Sz - 26 : W - Sz / 2);
  }
  tl.style.height = H + "px";
  let svg = `<svg class="ax" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line class="axis" x1="0" x2="${W}" y1="${axisY}" y2="${axisY}"/>`;
  for (let y = Math.ceil(y0); y <= y1; y++) {
    const x = X(y), dec = y % 10 === 0;
    svg += `<line class="tick" x1="${x}" x2="${x}" y1="${axisY - (dec ? 6 : 3)}" y2="${axisY + (dec ? 6 : 3)}"/>`;
    const nearEv = A.formedYear && Math.abs(y - A.formedYear) < 3 && y !== Math.floor(y1);
    if (!(S.ideas && A.e.eras && y !== Math.floor(y1)) && !nearEv && (dec || y === Math.ceil(y0) || y === Math.floor(y1))) svg += `<text class="yl ${dec ? "dec" : ""}" x="${x}" y="${axisY + (lanes === 2 ? -10 : 22)}" text-anchor="middle">${y === Math.floor(y1) && !A.dead && y >= 2026 ? "сейчас" : y}</text>`;
  }
  let html = "";
  all.forEach((al, i) => {
    const up = al.lane === 0, cx = al.x, dx = al.tx;
    const top = up ? axisY - gap - meta - Sz : axisY + gap;
    const y1s = up ? axisY - gap + 4 : axisY + gap - 4;
    svg += `<path class="stem" data-k="${i}" d="M${dx} ${axisY} C ${dx} ${(axisY + y1s) / 2}, ${cx} ${(axisY + y1s) / 2}, ${cx} ${y1s}" ${al.ghost ? 'stroke-dasharray="3 4"' : ""}/>`;
    svg += `<circle class="dot" data-k="${i}" cx="${dx}" cy="${axisY}" r="4.5"/>`;
    const inner = al.ghost ? `<div class="sl ghost">${icon("Plus", 22)}</div><div class="ti">${esc(al.clean)}</div><div class="sub"><span class="mono">${al.year}</span><span>нет в библиотеке</span></div>`
      : up ? sleeve(al, i) + alMeta(al) : sleeve(al, i) + alMeta(al);
    html += `<a class="al ${al.ghost ? "ghosted idea" : ""}" href="#" data-k="${i}" style="--S:${Sz}px;--i:${i};--from:${up ? 14 : -14}px;left:${cx - Sz / 2}px;top:${top}px" data-toast="${al.ghost ? `«${esc(al.clean)}» (${al.year}) нет в библиотеке — найти в Яндекс Музыке и добавить` : `Откроется разворот «${esc(al.clean)}»`}">${inner}</a>`;
  });
  // the history on the line: where it began, and the end
  if (A.formedYear && A.formedYear >= y0) html += `<span class="ev" style="left:${X(A.formedYear + .5)}px;top:${axisY}px"><b>${A.formedYear}</b>${A.cut && A.slug.includes("-") && /monkeys|thieves|maroon|gorillaz/.test(A.slug) ? "группа собралась" : "начало"}</span>`;
  if (A.dead && A.end) html += `<span class="ev" style="left:${X(A.end + .5)}px;top:${axisY}px"><b>${A.end}</b>✝</span>`;
  if (S.ideas && A.e.eras) A.e.eras.forEach(([a, b, t], k) => {
    svg += `<line class="eraLine" x1="${X(a)}" x2="${X(b)}" y1="${axisY}" y2="${axisY}"/>`;
    html += `<span class="era ${k % 2 ? "dn" : "up"}" style="left:${X(a)}px;top:${axisY}px" title="эпоха — подпись ИИ">${esc(t)}</span>`; });
  tl.innerHTML = svg + "</svg>" + html;
  for (const a of $$(".al[data-k]", tl)) {
    a.addEventListener("pointerenter", () => { for (const e of $$(`[data-k="${a.dataset.k}"]`, tl)) e.classList.add("hot"); });
    a.addEventListener("pointerleave", () => { for (const e of $$(`[data-k="${a.dataset.k}"]`, tl)) e.classList.remove("hot"); });
  }
}

// ── behaviour ────────────────────────────────────────────────────────────
let toastT;
function toast(text) { const t = $("#toast"); t.textContent = text; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2200); }
function wire() {
  const page = $("#page"), hero = $("#hero");
  hero.addEventListener("pointermove", (e) => { const r = hero.getBoundingClientRect(); page.style.setProperty("--hx", ((e.clientX - r.left) / r.width - .5).toFixed(3)); page.style.setProperty("--hy", ((e.clientY - r.top) / r.height - .5).toFixed(3)); });
  hero.addEventListener("pointerleave", () => { page.style.setProperty("--hx", 0); page.style.setProperty("--hy", 0); });
  const q = $("#qBtn"), o = $("#origin");
  if (q && o) {
    const show = (on) => { if (on) { const hr = hero.getBoundingClientRect(), qr = q.getBoundingClientRect(); let x = qr.left - hr.left, y = qr.bottom - hr.top + 10;
      if (y + 140 > hr.height) y = qr.top - hr.top - 10 - o.offsetHeight; x = Math.min(x, hr.width - o.offsetWidth - 20);
      Object.assign(o.style, { left: x + "px", top: y + "px" }); o.style.setProperty("--ox", qr.left - hr.left - x + 8 + "px"); o.style.setProperty("--oy", y > qr.top - hr.top ? "0px" : "100%"); }
      o.classList.toggle("on", on); };
    q.addEventListener("click", (e) => { e.stopPropagation(); show(!o.classList.contains("on")); });
    document.addEventListener("click", (e) => { if (!o.contains(e.target)) show(false); }, { once: false });
  }
  const g = $("#grammy");
  if (g) {
    g.addEventListener("pointermove", (e) => { const r = g.getBoundingClientRect(), px = (e.clientX - r.left) / r.width; g.style.setProperty("--px", (px * 100).toFixed(1) + "%"); g.style.setProperty("--py", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%"); g.style.setProperty("--foil", (20 + px * 60).toFixed(1) + "%"); });
    for (const s of $$(".st.win", g)) s.addEventListener("click", () => { s.classList.remove("hopping"); void s.offsetWidth; s.classList.add("hopping"); });
  }
  const more = $("#more"), bio = $("#bio"), wrap = $("#bioWrap");
  more?.addEventListener("click", () => { const h0 = wrap.offsetHeight; bio.classList.add("open"); const h1 = bio.scrollHeight; wrap.style.height = h0 + "px"; requestAnimationFrame(() => { wrap.style.height = h1 + "px"; }); more.hidden = true; });
  const f = $("#fact");
  if (f) { let k = 0; const ps = $$(".fx p", f); for (const b of $$("[data-f]", f)) b.addEventListener("click", () => { ps[k].setAttribute("aria-hidden", "true"); k = (k + +b.dataset.f + ps.length) % ps.length; setTimeout(() => ps[k].setAttribute("aria-hidden", "false"), 120); $("#fpos").textContent = `${k + 1} / ${ps.length}`; }); }
  page.onscroll = () => { const y = page.scrollTop; if (y < hero.offsetHeight) page.style.setProperty("--sy", y.toFixed(1)); };
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-toast]"); if (t) { e.preventDefault(); toast(t.dataset.toast); }
  const b = e.target.closest(".mockbar button"); if (!b) return;
  if (b.dataset.v) { S.v = b.dataset.v; S.shelf = null; }
  if (b.dataset.i) S.i = +b.dataset.i;
  if (b.dataset.al) S.shelf = b.dataset.al;
  if (b.classList.contains("idea-t")) S.ideas = !S.ideas;
  if (b.dataset.size) { S.size = b.dataset.size; sizeVp(); }
  save(); render();
});
const SIZES = { 14: [1512, 982], 16: [1728, 1117], 32: [2560, 1440] };
function sizeVp() {
  const vp = $(".vp"), app = $(".app");
  if (S.size === "win") { vp.removeAttribute("data-size"); app.style.removeProperty("--w"); return; }
  const [w, h] = SIZES[S.size]; vp.dataset.size = S.size;
  const k = Math.min((innerWidth - 24) / w, (innerHeight - 24) / h, 1);
  app.style.setProperty("--w", w + "px"); app.style.setProperty("--h", h + "px"); app.style.setProperty("--k", k.toFixed(4));
}
addEventListener("resize", () => { sizeVp(); layout(); });
new ResizeObserver(() => layout()).observe(document.querySelector(".app"));

// the switcher's artist faces
$("#who").innerHTML = D.artists.map((a, i) => `<button class="who" type="button" data-i="${i}" aria-label="${esc(a.name)}" title="${esc(a.name)}"><img src="${img(a.photo)}" alt=""></button>`).join("");
hydrate(); sizeVp(); render();
