/* MusiX — the artist page «Кадр», round 5. Data: window.DATA (the frozen v1 snapshot of
   2026-10-01, read-only) + Apple Music photos fetched 2026-10-14. COUNTRY/EDIT (edit_block.js,
   loaded before this file) hold what the mock fixes by hand and the example AI texts. */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function icon(name, size = 18) {
  const def = window.ICONS[name]; if (!def) return "";
  return `<svg class="ic" style="--s:${size}px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${def.w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${def.d.map((d, i) => `<path d="${d}"${def.fill.includes(i) ? ' fill="currentColor"' : ""}/>`).join("")}</svg>`;
}
const hydrate = (root = document) => { for (const el of $$("[data-ic]", root)) el.outerHTML = icon(el.dataset.ic, +(el.dataset.s || 18)); };
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
const img = (n) => `img/${n}.${n.endsWith("-cut") || n.endsWith("-logo") ? "png" : "jpg"}`;
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
const GENRE = { "Hip-Hop": "Хип-хоп", Pop: "Поп", Rock: "Рок", "R&B": "R&B", Electronic: "Электроника" };

const D = window.DATA;
const S = { i: 1, size: "win", ideas: true };
try { Object.assign(S, JSON.parse(localStorage.getItem("mx-artist-mock3") || "{}")); } catch {}
const save = () => { try { localStorage.setItem("mx-artist-mock3", JSON.stringify(S)); } catch {} };

// ── data prep ────────────────────────────────────────────────────────────
function prep(a) {
  const e = EDIT[a.slug] || {};
  const albums = a.albums.map((al) => {
    const m = /\s*[(\[]([^)\]]*(?:Edition|Deluxe|Version|Remaster|Tour)[^)\]]*)[)\]]\s*$/i.exec(al.title) || /\s*,?\s*-\s*(EP)$/.exec(al.title);
    return { ...al, year: e.years?.[al.title] ?? al.year, clean: m ? al.title.slice(0, m.index).replace(/,\s*$/, "") : al.title, ed: m ? m[1].replace(/Australian Tour Edition/i, "Tour Edition").replace(/Expanded Edition/i, "Expanded") : null };
  }).sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999));
  const lines = (a.bio || "").split(/\n+/);
  while (lines.length > 1 && !/[а-яё]/i.test(lines[0])) lines.shift();
  const bio = lines.join(" ").replace(/\*([^*]+)\*/g, "$1").replace(/The bio facts are confirmed[^.]*\.\s*I will now write[^.]*\.\s*/i, "").replace(/\s+/g, " ").trim()
    .replace(new RegExp("[\\s*_]*" + a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s*_]*$"), "");  // v1 signed its bios with the name
  const first = albums.find((x) => x.year)?.year;
  const dead = a.status === "deceased", ended = dead || a.status === "disbanded";
  return { ...a, e, albums, bio, start: a.formedYear ?? first, end: ended ? a.activeTo : null, dead,
    country: COUNTRY[a.cc] || (a.cc ? new Intl.DisplayNames(["ru"], { type: "region" }).of(a.cc) : null) };
}
// levels: a fan's way to the stage — from the warm-up to the legend; the metal by rank (slate, bronze, silver, gold, platinum)
const LEVELS = [
  { n: "На разогреве", at: 0, m: "#9aa3b5", bg: "linear-gradient(145deg,#e4e8f0,#8e97a8)", tx: "linear-gradient(180deg,#eef1f6,#9aa3b5)" },
  { n: "Танцпол", at: 10, m: "#c98a5a", bg: "linear-gradient(145deg,#f6d3b0,#b9784a 55%,#7a4524)", tx: "linear-gradient(180deg,#f8dcc0,#c98a5a)" },
  { n: "Первый ряд", at: 50, m: "#c8ccd6", bg: "linear-gradient(145deg,#ffffff,#c9cdd7 50%,#8a8f9c)", tx: "linear-gradient(180deg,#ffffff,#b4b9c5)" },
  { n: "Бэкстейдж", at: 150, m: "#e3bd63", bg: "linear-gradient(145deg,#fff1c4,#e3bd63 50%,#a87a26)", tx: "linear-gradient(180deg,#fff3cf,#d9ae4c)" },
  { n: "Легенда", at: 300, m: "#cdd6ff", bg: "linear-gradient(145deg,#ffffff,#dfe6f5 35%,#c6cfee 55%,#f0e2f6 75%,#b9c1d6)", tx: "linear-gradient(100deg,#f6f8ff,#c9d5ff 40%,#f3daf6 70%,#dfe8ff)" },
];
function level(a) {
  const done = a.albums.filter((x) => x.heard / x.n >= 0.5).length, cov = done / Math.max(1, a.albums.length);
  let k = 0; for (let j = 0; j < LEVELS.length; j++) if (a.plays >= LEVELS[j].at && (j < 3 || cov >= (j === 3 ? .5 : 1))) k = j;
  const nx = LEVELS[k + 1]; let need = null, short = null, p = 1;
  if (nx) {
    const covNeed = k + 1 === 3 ? .5 : k + 1 === 4 ? 1 : 0;
    if (a.plays < nx.at) { const l = nx.at - a.plays; short = `ещё ${l} ${plural(l, "прослушивание", "прослушивания", "прослушиваний")}`; p = a.plays / nx.at; }
    else { const l = Math.ceil(covNeed * a.albums.length) - done; short = `ещё ${l} ${plural(l, "альбом", "альбома", "альбомов")} дослушать`; p = cov / covNeed; }
    need = `до <b>«${nx.n}»</b> — ${short.replace(/^ещё /, "")}`;
  }
  return { ...LEVELS[k], k, need, short, p: Math.min(1, p), done };
}

/* how often the artist is on your air, against the library's other artists: radio words, not a place
   in the top; the meter's bars light by tier */
const FREQ = [["Не сходит с эфира", 5], ["Тяжёлая ротация", 4], ["В ротации", 3], ["Частый гость эфира", 2], ["Иногда в эфире", 1], ["Редко в эфире", 1]];
function freq(a) {
  const N = D.libArtists, r = a.rank;
  if (!r || !a.plays) return { n: "Ещё не в эфире", bars: 0, s: "ни одного прослушивания" };
  const q = r / N, t = r === 1 ? 0 : q <= .02 ? 1 : q <= .1 ? 2 : q <= .3 ? 3 : q <= .6 ? 4 : 5, pct = Math.floor((N - r) / (N - 1) * 100);
  return { n: FREQ[t][0], bars: FREQ[t][1], s: r === 1 ? "чаще всех в твоей библиотеке" : `чаще, чем ${pct} % твоих артистов` };
}

// ── the statuette: a gold gramophone on a black plinth (a nomination: the outline only) ──
const STATUE = (win) => `<svg viewBox="0 0 20 30" aria-hidden="true"><g ${win ? 'fill="url(#gGold)" stroke="rgba(96,66,12,.5)" stroke-width=".35"' : 'fill="none" stroke="#d9b45a" stroke-width=".9" opacity=".75"'} stroke-linejoin="round">
  <path d="M9.3 14.6C9.5 11.6 10.9 9.4 13 7.8L15.3 1.6C17.4 2 19.4 3.9 20 6.2L14 9.2C12.2 10.5 11 12.2 10.7 14.6Z"/>
  <ellipse cx="10" cy="15.3" rx="6.3" ry="1.5"/><rect x="9.3" y="16.5" width="1.4" height="4.4" rx=".4"/><rect x="7.4" y="20.7" width="5.2" height="1.3" rx=".55"/></g>
  ${win ? '<rect x="3" y="22" width="14" height="7.6" rx="1.1" fill="url(#gBase)"/><rect x="3.4" y="22" width="13.2" height=".55" rx=".27" fill="#e2bd63" opacity=".85"/>' : '<rect x="3.4" y="22.4" width="13.2" height="6.8" rx="1" fill="none" stroke="#d9b45a" stroke-width=".9" opacity=".55"/>'}</svg>`;

// ── render ───────────────────────────────────────────────────────────────
let A = null;
function render() {
  A = prep(D.artists[S.i]);
  const app = $(".app"); app.classList.toggle("ideas", S.ideas);
  const page = $("#page"); page.scrollTop = 0;
  const am = A.apple || {};
  const shot = am.wide ? { src: am.wide, cls: "wide" } : am.sq ? { src: am.sq, cls: "sq" } : { src: A.photo, cls: "sq" };
  const light = am.bg && lum(am.bg) > .55;
  const lv = level(A);
  page.style.cssText = `--tint:${A.tint};--metal:${lv.m};--metalbg:${lv.bg};--metaltext:${lv.tx}`;
  $(".mini").style.setProperty("--mini-acc", A.tint);
  const words = (s) => s.split(/\s+/).map((w, i) => `<span class="w" style="--i:${i}">${esc(w)}</span>`).join(" ");
  const span = A.start ? (A.end ? `${A.start}–${A.end}${A.dead ? " <small>✝</small>" : ""}` : `с ${A.start}`) : null;
  const q = A.nameOrigin ? `<button class="q" type="button" id="qBtn" aria-label="Откуда название">?</button>` : "";
  const name = am.logo ? `<h1 class="sr">${esc(A.name)}</h1><div class="namerow"><img class="logo" src="${img(am.logo)}" alt="">${q}</div>` : `<h1 class="name">${words(A.name)}${q}</h1>`;
  const blur = [[2, "150% 140%"], [4, "126% 118%"], [8, "106% 100%"], [16, "88% 84%"], [30, "70% 68%"]];
  const hero = `
    <section class="hero${light ? " light" : ""}${shot.cls === "sq" ? " sq" : ""}" id="hero">
      <div class="hbg">${shot.cls === "sq" ? `<canvas class="ext" id="ext" width="1" height="1"></canvas><i class="extdim"></i>` : ""}<div class="photo ${shot.cls}${light ? " light" : ""}" id="photo" style="--img:url(${img(shot.src)})"></div>
        <div class="pblur">${blur.map(([b, r]) => `<i style="--b:${b}px;--r:${r}"></i>`).join("")}</div><i class="scrim"></i><i class="grain"></i></div>
      <a class="back lg" href="#" data-toast="Назад к артистам в библиотеке">${icon("ChevronLeft", 18)}Артисты</a>
      <div class="htext">
        ${name}
        ${A.e.tagline ? `<p class="tagline">${esc(A.e.tagline)}</p>` : ""}
        <div class="meta">
          ${A.country ? `<span>${A.cc && FLAGS[A.cc.toLowerCase()] ? `<img class="flag" src="${FLAGS[A.cc.toLowerCase()]}" alt="">` : ""}${esc(A.country)}${A.e.city ? ` <small>${esc(A.e.city)}</small>` : ""}</span>` : ""}
          ${A.genre ? `<span>${esc(GENRE[A.genre] || A.genre)}</span>` : ""}
          ${span ? `<span>${span}</span>` : ""}
          ${gbadge(A)}
        </div>
        <div class="lib"><span>${A.albums.length} ${plural(A.albums.length, "альбом", "альбома", "альбомов")} · ${A.tracks} ${plural(A.tracks, "песня", "песни", "песен")} в библиотеке</span>
          ${A.bio ? `<button class="biolink" type="button" id="bioLink">Биография${icon("ChevronRight", 14)}</button>` : ""}</div>
        <div class="acts">
          <button class="btn play" type="button" data-toast="Играет всё от ${esc(A.name)}, начиная с самых любимых">${icon("Play", 16)}Слушать</button>
          <button class="btn ghost lg" type="button" data-toast="Перемешано: ${A.tracks} ${plural(A.tracks, "песня", "песни", "песен")}">${icon("Shuffle", 17)}Вперемешку</button>
          <button class="btn ghost lg wave" type="button" data-toast="«Поток» от ${esc(A.name)}: его песни вперемежку с похожими по звучанию из твоей библиотеки, по твоему вкусу и пропускам">${icon("Sparkles", 17)}Поток артиста</button>
        </div>
      </div>
      ${gpopHTML(A)}
      ${A.nameOrigin ? `<div class="origin lg" id="origin" role="dialog"><b>Откуда название</b>${esc(A.nameOrigin)}</div>` : ""}
    </section>`;
  const covers = A.albums.filter((x) => x.cover).slice(-3).map((x) => x.cover);
  const body = `
    <div class="in body">
      <section class="disco">
        <h2 class="h2">Дискография <small>${A.albums.length} в библиотеке · по годам</small></h2>
        <div class="tl" id="tl"></div>
      </section>
      <section>
        <h2 class="h2">Ты и ${esc(A.name)}</h2>
        <div class="row2">
          ${youHTML(A, lv)}
          <div class="side2">
            <div class="quiz" role="button" tabindex="0" data-toast="Квиз: 10 песен ${esc(A.name)} из твоей библиотеки, на каждую — 3 секунды">
              <div class="qstack n${covers.length}">${covers.map((c) => `<img src="${img(c)}" alt="">`).join("")}<b>?</b></div>
              <div><div class="qk">Квиз</div><div class="qt">Угадай ${esc(A.name)} за 3 секунды</div>
                <span class="qgo">${icon("Play", 13)}Играть</span></div>
            </div>
            ${A.e.facts?.length ? `<div class="facts" id="facts" role="button" tabindex="0" aria-label="Следующий факт">
              <div class="fh"><span class="fk">А ты знал</span>${A.e.facts.length > 1 ? `<span class="fn"><b id="fI">1</b> / ${A.e.facts.length}</span><span class="nxt">${icon("ChevronRight", 15)}</span>` : ""}</div>
              <div class="fx">${A.e.facts.map((f, i) => `<p class="${i ? "" : "on"}">${esc(f)}</p>`).join("")}</div></div>` : ""}
          </div>
        </div>
      </section>
      <section class="songs">
        <h2 class="h2">Слушаешь чаще всего <small>${A.plays} ${plural(A.plays, "раз", "раза", "раз")}</small></h2>
        <div class="rows">${A.top.map((t, i) => row(t, i, A.top[0].plays)).join("")}</div>
        <button class="more" type="button" data-toast="Откроются все ${A.tracks} ${plural(A.tracks, "песня", "песни", "песен")}">Все ${A.tracks} ${plural(A.tracks, "песня", "песни", "песен")}${icon("ChevronRight", 14)}</button>
      </section>
    </div>`;
  page.innerHTML = hero + body;
  $("#modal").innerHTML = modalHTML(A);
  $("#mini-cover").src = img(A.top[0].cover || A.photo); $("#mini-t").textContent = A.top[0].title; $("#mini-a").textContent = A.name;
  $("#mh-img").src = img(A.photo); $("#mh-name").textContent = A.name; $(".minihead").classList.remove("on");
  for (const b of $$(".mockbar .who")) b.setAttribute("aria-pressed", String(+b.dataset.i === S.i));
  for (const b of $$(".mockbar [data-size]")) b.setAttribute("aria-pressed", String(b.dataset.size === S.size));
  $(".idea-t").setAttribute("aria-pressed", String(S.ideas));
  const ph = $("#photo"), pre = new Image(); pre.onload = () => requestAnimationFrame(() => { ph.classList.add("on"); if (shot.cls === "sq") { extend(pre); $("#ext").classList.add("on"); } }); pre.src = img(shot.src);
  wire(); layout();
}

/* the Grammys live in the facts line: a gold laurel whose branches grow with the wins (2 pairs of
   leaves for one, a full wreath from 12), the count inside; zero wins = a hollow laurel with the
   nominations. The case opens from it (hover, focus or click) in liquid glass v2. */
function laurel(k, gold, right) {
  const P0 = [11.6, 28.5], P1 = [0.4, 19], P2 = [7.6, 1.6];
  const at = (t) => [0, 1].map((j) => (1 - t) ** 2 * P0[j] + 2 * (1 - t) * t * P1[j] + t * t * P2[j]);
  const tan = (t) => { const v = [0, 1].map((j) => 2 * (1 - t) * (P1[j] - P0[j]) + 2 * t * (P2[j] - P1[j])), l = Math.hypot(...v); return v.map((x) => x / l); };
  const rot = (d, a) => [d[0] * Math.cos(a) - d[1] * Math.sin(a), d[0] * Math.sin(a) + d[1] * Math.cos(a)];
  const f = (x) => x.toFixed(2);
  const leaf = (p, d, L, w) => { const q = [p[0] + d[0] * L, p[1] + d[1] * L], m = [p[0] + d[0] * L * .5, p[1] + d[1] * L * .5], n = [-d[1] * w, d[0] * w];
    return `M${f(p[0])} ${f(p[1])}Q${f(m[0] + n[0])} ${f(m[1] + n[1])} ${f(q[0])} ${f(q[1])}Q${f(m[0] - n[0])} ${f(m[1] - n[1])} ${f(p[0])} ${f(p[1])}Z`; };
  let d = "";
  for (let i = 0; i < k; i++) {
    const t = .1 + i * (.8 / Math.max(1, k - 1)) * (k === 1 ? 0 : 1), p = at(t), tg = tan(t), L = 5.4 - i * (1.2 / Math.max(1, k - 1));
    d += leaf(p, rot(tg, -.62), L, 1.55) + leaf(p, rot(tg, .55), L * .78, 1.3);
  }
  d += leaf(at(.97), tan(.97), 4, 1.4);
  const paint = gold ? 'fill="url(#gGold)"' : 'fill="none" stroke="#e3c37a" stroke-width=".8" opacity=".85"';
  return `<svg class="${right ? "r" : "l"}" viewBox="0 0 13 30" aria-hidden="true"><path d="M${P0.join(" ")}Q${P1.join(" ")} ${P2.join(" ")}" fill="none" stroke="${gold ? "#c99a3c" : "#e3c37a"}" stroke-width=".9" stroke-linecap="round"${gold ? "" : ' opacity=".7"'}/><path d="${d}" ${paint}/></svg>`;
}
function gbadge(a) {
  const w = a.grammyWins || 0, n = a.grammyNoms;
  if (a.grammyWins == null && n == null) return "";
  const k = w ? Math.min(6, 1 + Math.ceil(w / 2.4)) : 2;
  return `<span><button class="gb${w ? "" : " zero"}" type="button" id="gb" aria-expanded="false" aria-controls="gpop" aria-label="Грэмми: ${w} ${plural(w, "победа", "победы", "побед")}">${laurel(k, w)}<b>${w || n}</b>${laurel(k, w, true)}<em>${w ? "Грэмми" : plural(n, "номинация", "номинации", "номинаций") + " Грэмми"}</em></button></span>`;
}
function gpopHTML(a) {
  const w = a.grammyWins || 0, n = a.grammyNoms;
  if (a.grammyWins == null && n == null) return "";
  const lib = D.grammyLib, pos = lib.filter((g) => g.wins > w).length + 1;
  const hollow = n != null ? Math.max(0, n - w) : 0, total = w + hollow;
  const gw = total > 32 ? 10 : total > 22 ? 12 : 14;
  const line = w ? `<b>№${pos}</b> из ${lib.length} ${plural(lib.length, "лауреата", "лауреатов", "лауреатов")} твоей библиотеки${n ? ` · ${n} ${plural(n, "номинация", "номинации", "номинаций")}` : ""}`
    : `${n} ${plural(n, "номинация", "номинации", "номинаций")} — и ни одной статуэтки. Академия, ну.`;
  return `<div class="gpop lg" id="gpop" role="dialog" aria-label="Грэмми">
    <div class="gtop"><b class="gn${w ? "" : " zero"}">${w}</b><div class="gt"><span class="gl">Грэмми</span><span class="gr">${line}</span></div></div>
    <div class="shelf">${Array.from({ length: w }, (_, i) => `<span class="st win" style="--gw:${gw}px;--i:${i}">${STATUE(true)}</span>`).join("")}${Array.from({ length: hollow }, (_, i) => `<span class="st nom" style="--gw:${gw}px;--i:${i}" title="номинация">${STATUE(false)}</span>`).join("")}</div>
  </div>`;
}

/* «Ты и …» = the collection (his pick of four, 2026-10-16; the others in round4/): the albums as a
   collector's album, each cover coloured in as far as you have heard it; the level, how much is heard,
   how often the artist is on your air */
function youHTML(a, lv) {
  const f = freq(a);
  const pips = `<div class="pips" aria-label="Уровень ${lv.k + 1} из 5">${LEVELS.map((L, j) => `<i class="${j <= lv.k ? "got" : ""} ${j === lv.k ? "cur" : ""}" style="--m:${L.m}" title="${L.n}"></i>`).join("")}</div>`;
  const nx = lv.need ? `<div class="nx2"><span class="bar" style="--p:${lv.p.toFixed(3)}"><i></i></span><span>${lv.need}</span></div>` : `<div class="nx2"><span class="bar" style="--p:1"><i></i></span><span><b>Легенда</b> — выше только сцена</span></div>`;
  return `<div class="you v2 col" id="you">
      <div class="top2"><div class="lvw"><div class="lvn">${lv.n}</div>${pips}</div>
        <div class="knum"><b>${a.heardAll}<small>/${a.tracks}</small></b><span>${plural(a.tracks, "песни", "песен", "песен")} услышано</span></div>
        <div class="fq" title="${esc(f.s)}"><span class="sig" aria-hidden="true">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= f.bars ? "on" : ""}" style="--k:${k}"></i>`).join("")}</span><div><b>${f.n}</b><span>${f.s}</span></div></div></div>
      <div class="covers" style="--cols:${a.albums.length <= 8 ? Math.max(a.albums.length, 4) : Math.ceil(a.albums.length / 2)}">${a.albums.map((al, i) => { const p = al.heard / al.n;
        return `<button class="cv2${p >= 1 ? " full" : p === 0 ? " none" : ""}" type="button" data-a="${i}" style="--p:${p.toFixed(3)};--i:${i}" data-toast="Откроется разворот «${esc(al.clean)}»">${al.cover ? `<img class="g" src="${img(al.cover)}" alt=""><img class="c" src="${img(al.cover)}" alt="">` : ""}<i class="ln"></i>${p >= 1 ? `<i class="ok">${icon("Check", 11)}</i>` : ""}</button>`; }).join("")}</div>
      <div class="cap"><span class="h" id="youH"></span></div>
      ${nx}
    </div>`;
}

function modalHTML(a) {
  const paras = []; let cur = "";
  for (const s of a.bio.split(/(?<=[.!?»])\s+(?=[A-ZА-ЯЁ«])/)) { cur += (cur ? " " : "") + s; if (cur.length > 380) { paras.push(cur); cur = ""; } }
  if (cur) paras.push(cur);
  return `<div class="scr" data-close></div>
    <div class="win" role="dialog" aria-modal="true" aria-label="Биография">
      <div class="wh"><img src="${img(a.photo)}" alt=""><div><h2>${esc(a.name)}</h2><small>Биография · написал ИИ по открытым источникам</small></div>
        <button class="x" type="button" data-close aria-label="Закрыть">${icon("Plus", 18).replace('class="ic"', 'class="ic" style="--s:18px;rotate:45deg"')}</button></div>
      <div class="wb">${paras.map((p) => `<p class="bio">${esc(p)}</p>`).join('<div style="height:14px"></div>')}
        ${a.nameOrigin ? `<div class="lbl">Откуда название</div><blockquote>${esc(a.nameOrigin)}</blockquote>` : ""}
      </div>
    </div>`;
}
function sleeve(al, i) {
  const lab = ["#c23b2b", "#e2b53d", "#3a6ec2", "#e9e4d8", "#2f8f5b", "#a34fc0"][i % 6];
  return `<div class="sl"><span class="disc" style="--lab:${lab}"></span>${al.cover ? `<img src="${img(al.cover)}" alt="" loading="lazy">` : ""}
    <button class="pl lg" type="button" aria-label="Слушать" data-toast="Играет «${esc(al.clean)}»">${icon("Play", 15)}</button></div>`;
}
function alMeta(al) {
  return `<div class="ti">${esc(al.clean)}${al.ed ? `<span class="ed">${esc(al.ed)}</span>` : ""}</div>
    <div class="sub"><span class="mono">${al.year ?? "—"}</span><span class="bar" style="--p:${(al.heard / al.n).toFixed(3)}"><i></i></span><span>${al.heard}/${al.n}</span></div>`;
}
function row(t, i, max) {
  return `<div class="row" data-toast="Играет «${esc(t.title)}»"><span class="n">${i + 1}</span><span class="cv">${t.cover ? `<img src="${img(t.cover)}" alt="">` : ""}${icon("Play", 16)}</span>
    <span class="tt"><b>${esc(t.title)}</b><span>${esc(t.album || "")}</span></span><span class="pc"><i style="--p:${(t.plays / max).toFixed(3)}"></i>${t.plays}</span></div>`;
}

// ── the timeline: years to x, with long empty stretches folded into a break ──
function layout() { if ($("#tl")) layoutTL(); extend(); }
function layoutTL() {
  const tl = $("#tl"), W = tl.clientWidth, als = A.albums.filter((x) => x.year), was = tl.classList.contains("seen");
  const ghosts = S.ideas ? (A.e.ghosts || []).map(([title, year]) => ({ clean: title, year, ghost: true })) : [];
  const all = [...als, ...ghosts].sort((x, y) => x.year - y.year), n = all.length;
  const lanes = n <= 3 ? 1 : 2;
  const Sz = Math.round(Math.min(172, Math.max(108, (W - 40) / Math.ceil(n / lanes) - 34)));
  const meta = 62, gap = 30, laneH = Sz + meta + gap, axisY = laneH + 6, H = lanes === 2 ? laneH * 2 + 12 : laneH + 40;
  const y0 = Math.min(A.start ?? all[0].year, all[0].year) - 1, y1 = Math.max(all[n - 1].year, A.end ?? (A.dead ? all[n - 1].year : 2026)) + 1;
  const anchors = [...new Set([y0, ...(A.formedYear ? [A.formedYear + .5] : []), ...all.map((x) => x.year + .5), ...(A.dead && A.end ? [A.end + .5] : []), y1])].sort((p, q) => p - q);
  const G = 6, CMP = 2.4, segs = []; let tot = 0;
  for (let k = 0; k < anchors.length - 1; k++) { const p = anchors[k], q = anchors[k + 1], br = q - p > G; segs.push({ p, q, br, s: tot, e: br ? CMP : q - p }); tot += br ? CMP : q - p; }
  const pad = Sz / 2 + 4, X = (y) => { const g = segs.find((s) => y >= s.p && y <= s.q) || (y < anchors[0] ? segs[0] : segs[segs.length - 1]); return pad + (g.s + (y - g.p) / (g.q - g.p) * g.e) / tot * (W - 2 * pad); };
  const inBreak = (y) => segs.some((s) => s.br && y > s.p + .3 && y < s.q - .3);
  const L = [[], []];
  all.forEach((al, i) => { al.lane = lanes === 2 ? i % 2 : 0; al.tx = X(al.year + .5); L[al.lane].push(al); });
  for (const lane of L) {
    for (let k = 0; k < lane.length; k++) lane[k].x = Math.max(lane[k].tx, k ? lane[k - 1].x + Sz + 26 : Sz / 2);
    for (let k = lane.length - 1; k >= 0; k--) lane[k].x = Math.min(lane[k].x, k < lane.length - 1 ? lane[k + 1].x - Sz - 26 : W - Sz / 2);
  }
  tl.style.height = H + "px";
  let svg = `<svg class="ax" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line class="axis" style="--len:${W}" x1="0" x2="${W}" y1="${axisY}" y2="${axisY}"/>`;
  for (let y = Math.ceil(y0); y <= y1; y++) {
    if (inBreak(y)) continue;
    const x = X(y), dec = y % 10 === 0, last = y === Math.floor(y1);
    svg += `<line class="tick" x1="${x}" x2="${x}" y1="${axisY - (dec ? 6 : 3)}" y2="${axisY + (dec ? 6 : 3)}"/>`;
    const nearEv = A.formedYear && Math.abs(y - A.formedYear) < 3 && !last;
    if (!(S.ideas && A.e.eras && !last) && !nearEv && (dec || last)) svg += `<text class="yl ${dec ? "dec" : ""}" x="${x}" y="${axisY + (lanes === 2 ? -10 : 22)}" text-anchor="middle">${last && !A.dead && y >= 2026 ? "сейчас" : y}</text>`;
  }
  // a break: the line parts, two slashes, and how many years it folds
  for (const s of segs.filter((g) => g.br)) {
    const x = X((s.p + s.q) / 2), yrs = Math.round(s.q - s.p);
    svg += `<rect x="${x - 9}" y="${axisY - 6}" width="18" height="12" fill="var(--bg)"/><path class="brk" d="M${x - 8} ${axisY + 6} L${x - 2} ${axisY - 6} M${x + 2} ${axisY + 6} L${x + 8} ${axisY - 6}"/>`;
    svg += `<text class="brkt" x="${x}" y="${axisY + (lanes === 2 ? -12 : 22)}" text-anchor="middle">${yrs} ${plural(yrs, "год", "года", "лет")}</text>`;
  }
  let html = "";
  all.forEach((al, i) => {
    const up = al.lane === 0, cx = al.x, dx = al.tx, top = up ? axisY - gap - meta - Sz : axisY + gap, ys = up ? axisY - gap + 4 : axisY + gap - 4;
    svg += `<path class="stem" data-k="${i}" d="M${dx} ${axisY} C ${dx} ${(axisY + ys) / 2}, ${cx} ${(axisY + ys) / 2}, ${cx} ${ys}" ${al.ghost ? 'stroke-dasharray="3 4"' : ""}/><circle class="dot" data-k="${i}" cx="${dx}" cy="${axisY}" r="4.5"/>`;
    const inner = al.ghost ? `<div class="sl ghost">${icon("Plus", 22)}</div><div class="ti">${esc(al.clean)}</div><div class="sub"><span class="mono">${al.year}</span><span>нет в библиотеке</span></div>` : sleeve(al, i) + alMeta(al);
    html += `<a class="al ${al.ghost ? "ghosted idea" : ""}" href="#" data-k="${i}" style="--S:${Sz}px;--i:${i};--from:${up ? 14 : -14}px;left:${cx - Sz / 2}px;top:${top}px" data-toast="${al.ghost ? `«${esc(al.clean)}» (${al.year}) нет в библиотеке — найти в Яндекс Музыке и добавить` : `Откроется разворот «${esc(al.clean)}»`}">${inner}</a>`;
  });
  if (A.formedYear && A.formedYear >= y0) html += `<span class="ev" style="left:${X(A.formedYear + .5)}px;top:${axisY}px"><b>${A.formedYear}</b>${/monkeys|thieves|maroon/.test(A.slug) ? "группа собралась" : "начало"}</span>`;
  if (A.dead && A.end) html += `<span class="ev" style="left:${X(A.end + .5)}px;top:${axisY}px"><b>${A.end}</b>✝</span>`;
  if (S.ideas && A.e.eras) A.e.eras.forEach(([a, b, t], k) => {
    svg += `<line class="eraLine" x1="${X(a)}" x2="${X(b)}" y1="${axisY}" y2="${axisY}"/>`;
    html += `<span class="era idea ${k % 2 ? "dn" : "up"}" style="left:${X(a)}px;top:${axisY}px" title="эпоха — подпись ИИ">${esc(t)}</span>`; });
  tl.innerHTML = svg + "</svg>" + html;
  if (was) tl.classList.add("seen");
  for (const a of $$(".al[data-k]", tl)) {
    a.addEventListener("pointerenter", () => { for (const e of $$(`[data-k="${a.dataset.k}"]`, tl)) e.classList.add("hot"); });
    a.addEventListener("pointerleave", () => { for (const e of $$(`[data-k="${a.dataset.k}"]`, tl)) e.classList.remove("hot"); });
  }
}

/* a square photo's left edge, continued: the visible crop of the photo (cover, 50% 20%) → its leftmost
   ~1 % averaged row by row into one column, padded with its end rows; then spread to the left with a
   vertical blur that grows with the distance in px (0.6 px per px; none at its edge, so the photo meets its own
   colour exactly; wide far left, so a contour crossing the edge turns into soft light, not streaks).
   --pl tells the dimming and the scrim where the photo starts. */
let extImg = null;
function extend(im) {
  extImg = im || extImg; const cv = $("#ext"), ph = $("#photo"); if (!cv || !extImg || !ph) return;
  const bw = ph.offsetWidth, bh = ph.offsetHeight, pl = ph.offsetLeft, iw = extImg.naturalWidth, ih = extImg.naturalHeight;
  const k = Math.max(bw / iw, bh / ih), sx = -((bw - iw * k) * .5) / k, sy = -((bh - ih * k) * .2) / k;
  const R = 160, P = 48, H2 = R + 2 * P;
  const col = document.createElement("canvas"); col.width = 1; col.height = R;
  const c = col.getContext("2d", { willReadFrequently: true }); c.imageSmoothingQuality = "high";
  c.drawImage(extImg, sx, sy, Math.max(1, bw / k * .012), bh / k, 0, 0, 1, R);
  const src = c.getImageData(0, 0, 1, R).data, pre = new Float64Array((H2 + 1) * 3);
  for (let y = 0; y < H2; y++) { const q = Math.min(R - 1, Math.max(0, y - P)) * 4; for (let ch = 0; ch < 3; ch++) pre[(y + 1) * 3 + ch] = pre[y * 3 + ch] + src[q + ch]; }
  const ramp = bw * .08, E = pl + 40 + ramp, C = 160, under = C * ramp / E;   // the columns under the photo's ramp stay sharp
  cv.width = C; cv.height = H2;
  const g = cv.getContext("2d"), out = g.createImageData(C, H2), o = out.data;
  for (let x = 0; x < C; x++) {
    const dist = Math.max(0, (C - under - x) / C * E), r = Math.round(Math.min(dist * .6, bh * .4) / (bh / R));   // px from the photo → rows of blur
    for (let y = 0; y < H2; y++) { const a = Math.max(0, y - r), b = Math.min(H2, y + r + 1), n = b - a, i = (y * C + x) * 4;
      for (let ch = 0; ch < 3; ch++) o[i + ch] = (pre[b * 3 + ch] - pre[a * 3 + ch]) / n; o[i + 3] = 255; }
  }
  g.putImageData(out, 0, 0);
  Object.assign(cv.style, { left: "-40px", width: E + "px", top: -(P / R * bh) + "px", height: (bh * H2 / R) + "px" });
  $(".hbg").style.setProperty("--pl", pl + "px");
}

// ── behaviour ────────────────────────────────────────────────────────────
let toastT;
function toast(text) { const t = $("#toast"); t.textContent = text; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2400); }
let io;
function openModal(from) {
  const m = $("#modal"), win = $(".win", m), fr = from.getBoundingClientRect(), mr = m.getBoundingClientRect();
  win.style.setProperty("--ox", fr.left + fr.width / 2 - mr.left - win.offsetLeft + "px"); win.style.setProperty("--oy", fr.top + fr.height / 2 - mr.top - win.offsetTop + "px");
  m.classList.add("on"); $(".x", m).focus({ preventScroll: true });
}
const closeModal = () => $("#modal").classList.remove("on");
function wire() {
  const page = $("#page"), hero = $("#hero"), mh = $(".minihead");
  let raf = 0;  // the frame stays still; only the glass head arrives once it has scrolled away
  page.onscroll = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; mh.classList.toggle("on", page.scrollTop > hero.offsetHeight - 90); }); };
  io?.disconnect();
  io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add("seen"); io.unobserve(e.target); } }, { root: page, threshold: .2 });
  io.observe($("#tl"));
  const q = $("#qBtn"), o = $("#origin");
  if (q && o) {
    const show = (on) => { if (on) { const hr = hero.getBoundingClientRect(), qr = q.getBoundingClientRect(); let x = qr.left - hr.left, y = qr.bottom - hr.top + 10;
      if (y + 140 > hr.height) y = qr.top - hr.top - 10 - o.offsetHeight; x = Math.min(x, hr.width - o.offsetWidth - 20);
      Object.assign(o.style, { left: x + "px", top: y + "px" }); o.style.setProperty("--ox", qr.left - hr.left - x + 8 + "px"); o.style.setProperty("--oy", y > qr.top - hr.top ? "0px" : "100%"); }
      o.classList.toggle("on", on); };
    q.addEventListener("click", (e) => { e.stopPropagation(); show(!o.classList.contains("on")); });
    document.addEventListener("click", (e) => { if (!o.contains(e.target) && e.target !== q) show(false); });
  }
  for (const s of $$(".st.win")) s.addEventListener("click", () => { s.style.opacity = 1; s.style.animation = "none"; void s.offsetWidth; s.style.animation = "hop .55s var(--spring)"; });
  // the Grammy case grows out of the laurel: above it (the name's zone), never over the photo
  const gb = $("#gb"), gp = $("#gpop");
  if (gb && gp) {
    let tOpen = 0, tClose = 0, pinned = false;
    const place = () => { const hr = hero.getBoundingClientRect(), br = gb.getBoundingClientRect(), z = hr.width / hero.offsetWidth;
      const x = Math.min((br.left - hr.left) / z - 6, hero.offsetWidth - gp.offsetWidth - 20), y = (br.top - hr.top) / z - gp.offsetHeight - 12;
      Object.assign(gp.style, { left: x + "px", top: y + "px" }); gp.style.setProperty("--ox", (br.left - hr.left) / z - x + br.width / z / 2 + "px"); gp.style.setProperty("--oy", "calc(100% + 12px)"); };
    const show = (on) => { clearTimeout(tOpen); clearTimeout(tClose); if (on) place(); for (const s of $$(".st", gp)) s.style.cssText = s.style.cssText.replace(/opacity:[^;]+;?|animation:[^;]+;?/g, "");
      gp.classList.toggle("on", on); gb.setAttribute("aria-expanded", String(on)); if (!on) pinned = false; };
    gb.addEventListener("pointerenter", () => { clearTimeout(tClose); tOpen = setTimeout(() => show(true), 90); });
    gb.addEventListener("pointerleave", () => { clearTimeout(tOpen); if (!pinned) tClose = setTimeout(() => show(false), 220); });
    gp.addEventListener("pointerenter", () => clearTimeout(tClose));
    gp.addEventListener("pointerleave", () => { if (!pinned) tClose = setTimeout(() => show(false), 220); });
    gb.addEventListener("click", (e) => { e.stopPropagation(); pinned = !pinned || !gp.classList.contains("on"); show(pinned || !gp.classList.contains("on")); });
    gb.addEventListener("focus", () => show(true)); gb.addEventListener("blur", () => { if (!pinned) show(false); });
    document.addEventListener("click", (e) => { if (!gp.contains(e.target) && !gb.contains(e.target)) show(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") show(false); });
  }
  // the facts: the next one develops in place, the counter turns
  const fc = $("#facts");
  if (fc) { let fi = 0; const ps = $$(".fx p", fc), nb = $("#fI", fc);
    const next = () => { if (ps.length < 2) return; ps[fi].classList.remove("on"); fi = (fi + 1) % ps.length; ps[fi].classList.add("on");
      if (nb) { nb.textContent = fi + 1; nb.animate([{ transform: "translateY(-6px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: "cubic-bezier(.34,1.56,.64,1)" }); } };
    fc.addEventListener("click", next); fc.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); next(); } }); }
  wireYou();
  $("#bioLink")?.addEventListener("click", (e) => openModal(e.currentTarget));
}
/* «ты и»: whatever is under the pointer is said in place, in the caption line (no pop-up) */
function wireYou() {
  const you = $("#you"), H = $("#youH");
  io.observe(you);
  const say = (html) => { H.innerHTML = html; you.classList.add("hov"); }, hush = () => you.classList.remove("hov");
  const alb = (i) => { const al = A.albums[+i]; return `<b>${esc(al.clean)}</b>${al.year ? ` · ${al.year}` : ""} · ${al.heard} из ${al.n} ${plural(al.n, "песни", "песен", "песен")}${al.heard >= al.n ? " — весь" : ""}`; };
  for (const c of $$(".cv2", you)) { c.addEventListener("pointerenter", () => say(alb(c.dataset.a))); c.addEventListener("pointerleave", hush); }
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) { closeModal(); return; }
  const t = e.target.closest("[data-toast]"); if (t) { e.preventDefault(); toast(t.dataset.toast); }
  const b = e.target.closest(".mockbar button"); if (!b) return;
  if (b.dataset.i) S.i = +b.dataset.i;
  if (b.classList.contains("idea-t")) S.ideas = !S.ideas;
  if (b.dataset.size) { S.size = b.dataset.size; sizeVp(); }
  save(); render();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
$(".minihead .pp").addEventListener("click", () => toast(`Играет всё от ${A.name}`));
const SIZES = { 14: [1512, 982], 16: [1728, 1117], 32: [2560, 1440] };
function sizeVp() {
  const vp = $(".vp"), app = $(".app");
  if (S.size === "win") { vp.removeAttribute("data-size"); return; }
  const [w, h] = SIZES[S.size]; vp.dataset.size = S.size;
  const k = Math.min((innerWidth - 24) / w, (innerHeight - 24) / h, 1);
  app.style.setProperty("--w", w + "px"); app.style.setProperty("--h", h + "px"); app.style.setProperty("--k", k.toFixed(4));
}
addEventListener("resize", () => { sizeVp(); layout(); });
new ResizeObserver(() => layout()).observe(document.querySelector(".app"));
$("#who").innerHTML = D.artists.map((a, i) => `<button class="who" type="button" data-i="${i}" aria-label="${esc(a.name)}" title="${esc(a.name)}"><img src="${img(a.photo)}" alt=""></button>`).join("");
hydrate(); sizeVp(); render();
