/* The turn: from a question to its answer and back. Stages are the server's own words
   (assistant/humanize.py); timings are the real turns' seconds when «Реальное время» is on. */
const A = D.answers;
const SCN = {
  playlist: { kind: "playlist", q: A.playlist.q, real: A.playlist.seconds, fast: 7.5, title: A.playlist.title, tracks: A.playlist.tracks, text: E.blurb.kanye,
    stages: [[0, "Разбираю запрос"], [0.1, "Понял: собираю подборку", "k"], [0.2, "Иду в интернет", "sparks"], [0.34, "Из 9 ссылок стоит читать 4"], [0.44, "Читаю 4 страницы", "pulse4"],
      [0.62, "Выписал 31 трек из текста"], [0.74, "В твоей библиотеке из них есть 18 треков", "covers"], [0.86, "Отбираю треки"], [0.95, "Собрал подборку из 10 треков"]] },
  audio: { kind: "audio_search", q: A.audio.q, real: A.audio.seconds, fast: 5.6, title: "Спокойное на вечер", tracks: A.audio.tracks,
    stages: [[0, "Разбираю запрос"], [0.14, "Понял: подбираю по звуку", "k"], [0.26, "Перевожу звучание на язык модели: 3 формулировки"], [0.42, "Ищу по звучанию: спокойное, мягкое, вечернее", "pulse3"],
      [0.78, "Нашёл 15 треков", "covers"], [0.92, "Собрал подборку из 15 треков"]] },
  lyrics: { kind: "lyrics_search", q: A.lyrics.q, real: A.lyrics.seconds, fast: 3.4, hits: A.lyrics.hits, message: A.lyrics.message,
    stages: [[0, "Разбираю запрос"], [0.25, "Понял: ищу по тексту", "k"], [0.45, "Ищу в библиотеке… нашёл 2 совпадения", "pulse1"], [0.75, "Проверил — трек подходит"]] },
  title: { kind: "general", q: A.title.q, real: A.title.seconds, fast: 3.6, text: A.title.text, follow: A.title.follow, subject: { name: "Every Angel Is Terrifying", sub: "The Weeknd · Dawn FM", cover: E.coverOf("Every Angel Is Terrifying"), photo: E.subj("the-weeknd")?.photo },
    src: ["Факты библиотеки", "Genius"], stages: [[0, "Разбираю запрос"], [0.25, "Понял: отвечаю на вопрос", "k"], [0.45, "В библиотеке нашлось 4 факта", "pulse1"], [0.7, "Формулирую ответ"]] },
  name: { kind: "general", q: A.name.q, real: A.name.seconds, fast: 3.2, text: A.name.text, follow: E.follow.twodoor, subject: E.subj("two-door-cinema-club"), src: ["Факты библиотеки"],
    stages: [[0, "Разбираю запрос"], [0.25, "Понял: отвечаю на вопрос", "k"], [0.45, "В библиотеке нашлось 3 факта", "pulse1"], [0.7, "Формулирую ответ"]] },
  clarify: { kind: "clarify", q: "Музыка как в «Stronger»", real: 3, fast: 1.8, stages: [[0, "Разбираю запрос"], [0.6, "Не уверен, что именно нужно — уточни"]] },
};
const GENERAL_ST = [[0, "Разбираю запрос"], [0.25, "Понял: отвечаю на вопрос", "k"], [0.45, "В библиотеке нашлось 2 факта", "pulse1"], [0.7, "Формулирую ответ"]];
const PLAYLIST_ST = (n, src) => [[0, "Разбираю запрос"], [0.3, "Понял: собираю подборку", "k"], [0.55, src || `В библиотеке ${n} ${plural(n, "песня", "песни", "песен")}`, "covers"], [0.85, `Собрал подборку из ${Math.min(n, 15)} ${plural(Math.min(n, 15), "трека", "треков", "треков")}`]];

/** what a question becomes: one of the real turns, or the data the hook already holds */
function scenarioFor(text, item) {
  for (const s of Object.values(SCN)) if (s.q.toLowerCase() === text.toLowerCase()) return s;
  if (item?.intent === "playlist" && item.tracks) {
    const prod = /продюсер/i.test(text), pc = prod ? D.carousel.find((c) => c.kind === "producer" && text.includes(c.title)) : null, n = pc?.n || item.n || item.tracks.length;
    return { kind: "playlist", q: text, fast: 2.6, real: 2.6, title: pc ? `${pc.title} в твоей библиотеке` : text, tracks: item.tracks, text: prod ? E.blurb.producer(item) : E.blurb.generic(item),
      prod, stages: PLAYLIST_ST(item.tracks.length, prod ? `В титрах библиотеки ${n} ${plural(n, "песня", "песни", "песен")} ${pc ? "с " + pc.title : ""}` : null) };
  }
  if (item?.intent === "general" && item.answer) {
    const sub = item.artist ? { name: item.artist.name, photo: item.artist.photo, sub: "артист" } : item.track ? { name: T[item.track].t, sub: T[item.track].a, cover: T[item.track].c, track: item.track } : item.photo ? { name: item.title, photo: item.photo, sub: "артист" } : null;
    return { kind: "general", q: text, fast: 3.2, real: 9, text: item.answer, follow: E.follow.generic(item), subject: sub, src: ["Факты библиотеки"], stages: GENERAL_ST };
  }
  if (item?.intent === "general" && item.track) {
    const t = T[item.track];
    return { kind: "general", q: text, fast: 3.4, real: 14, text: (item.line || "") + " " + E.more, follow: E.follow.generic(item), subject: { name: t.t, sub: t.a, cover: t.c, track: item.track }, src: ["Факты библиотеки"], stages: GENERAL_ST };
  }
  if (item?.intent === "general") return { kind: "general", q: text, fast: 3.4, real: 15, text: E.yearText(item), follow: E.follow.generic(item), subject: item.cover ? { name: item.title, sub: item.artist, cover: item.cover } : null, src: ["Википедия", "Genius"], stages: GENERAL_ST };
  if (item?.intent === "audio_search" || /звук|похож|спокой|бодр|грустн|без слов|вечер|утр/i.test(text)) return { ...SCN.audio, q: text, title: text.replace(/^что-нибудь\s*/i, "").replace(/^./, (c) => c.toUpperCase()) };
  if (item?.intent === "lyrics_search" || /строчк|поётся|поют|слова|текст/i.test(text)) return { ...SCN.lyrics, q: text };
  if (/плейлист|подборк|хиты|лучшее|собери/i.test(text)) return { ...SCN.playlist, q: text };
  if (/\?|почему|откуда|кто|что значит|расскажи|история/i.test(text)) return { ...SCN.title, q: text };
  return { ...SCN.clarify, q: text };
}

/* ── one turn ────────────────────────────────────────────────────────────── */
let busy = false, run = 0, cur = null;
async function ask(text, { item, chip } = {}) {
  text = String(text || "").trim(); if (!text || busy) return;
  if (app.classList.contains("answering")) await reset(true);
  busy = true; const my = ++run;
  const scn = scenarioFor(text, item); cur = scn;
  const total = (S.real ? scn.real : scn.fast) * 1000;
  page.scrollTo({ top: 0, behavior: "smooth" });
  $("#q").value = ""; $("#ask").classList.remove("has"); $("#q").blur(); placeAsk("away");
  app.classList.add("working"); setKind("think"); O.eT = 0.6;
  hideOrbit(chip);
  showEcho(text);
  if (chip) { await sleep(520); pulse(0.7); } else { pulse(0.5); }
  const t0 = performance.now();
  for (const [at, line, fx] of scn.stages) {
    const wait = t0 + at * total - performance.now(); if (wait > 0) await sleep(wait);
    if (my !== run) return;
    caption(line, fx === "k" || at === 0);
    if (fx === "k") { setKind(scn.kind === "clarify" ? "think" : scn.kind); O.eT = 0.75; pulse(0.7); }
    if (fx === "sparks") sparks(14);
    if (fx === "pulse4") for (let i = 0; i < 4; i++) setTimeout(() => { pulse(0.45); sparks(2); }, i * 0.035 * total);
    if (fx === "pulse1") pulse(0.6);
    if (fx === "pulse3") for (let i = 0; i < 3; i++) setTimeout(() => pulse(0.3), i * 0.11 * total);
    if (fx === "covers") coversInside(scn.tracks || (scn.hits || []).map((h) => h.id));
  }
  const rest = t0 + total - performance.now(); if (rest > 0) await sleep(rest);
  if (my !== run) return;
  if (scn.kind === "clarify") { await clarify(scn); busy = false; return; }
  await answer(scn);
  busy = false;
}

function hideOrbit(chip) {
  orbit.shown = false;
  for (const c of chips) {
    c.gone = true;
    const from = c.el.style.transform;
    if (c === chip) {
      const tx = L.cx - c.w / 2, ty = L.cy - c.h / 2, to = `translate(${tx}px,${ty}px) scale(.35)`;
      c.el.style.transform = to; c.el.style.opacity = "0";
      c.el.animate([{ transform: from, opacity: 1, filter: "blur(0)" }, { transform: to, opacity: 0, filter: "blur(3px)" }], { duration: 600, easing: SWIFT });
    } else {
      const dx = (c.x - L.cx) * 0.35, dy = (c.y - L.cy) * 0.35, to = `translate(${c.x - c.w / 2 + dx}px,${c.y - c.h / 2 + dy}px) scale(${c.s * 0.9})`;
      c.el.style.transform = to; c.el.style.opacity = "0";
      c.el.animate([{ transform: from, opacity: c.op }, { transform: to, opacity: 0, filter: "blur(6px)" }], { duration: 380, easing: EXIT, delay: Math.abs(c.depth) * 60, fill: "backwards" });
    }
    c.el.classList.add("taken");
  }
}
function showOrbit() {
  orbit.shown = true;
  chips.forEach((c, i) => {
    c.gone = false; c.el.classList.remove("taken");
    for (const a of c.el.getAnimations()) a.cancel();
    placeChips(0);
    const to = c.el.style.transform;
    c.el.animate([{ transform: `translate(${L.cx - c.w / 2}px,${L.cy - c.h / 2}px) scale(.4)`, opacity: 0, filter: "blur(6px)" }, { transform: to, opacity: c.op, filter: "blur(0)" }],
      { duration: SPR.duration, easing: SPR.easing, delay: 80 + i * 45, fill: "backwards" });
  });
}

function caption(line, keepK) {
  const el = $("#capt");
  el.innerHTML = line ? `<span class="in">${app.dataset.k !== "think" ? '<i class="k"></i>' : ""}<span class="shim">${esc(line)}</span></span>` : "";
}
function showEcho(text) {
  const el = $("#echo");
  for (const a of el.getAnimations()) a.cancel();
  el.textContent = text;
  Object.assign(el.style, { textAlign: "left", width: "fit-content", opacity: "1", transform: "translateX(-50%)", maxWidth: Math.min(860, L.W - 200) + "px" });
  el.style.left = L.cx + "px";
  // on a short screen the question needs room above the orb: the orb and its caption step down for the turn
  const top = L.cy - L.R - 36 - el.offsetHeight, shift = top < 22 ? 22 - top : 0;
  el.style.top = top + shift + "px";
  if (shift) {
    const box = $("#orbbox"); box.style.transform = `translateY(${shift}px)`;
    box.animate([{ transform: "none" }, { transform: `translateY(${shift}px)` }], { duration: SPR.duration, easing: SPR.easing });
    $("#capt").style.top = L.cy + L.R + 20 + shift + "px";
  }
  el.animate([{ opacity: 0, transform: "translateX(-50%) translateY(14px)", filter: "blur(8px)" }, { opacity: 1, transform: "translateX(-50%)", filter: "blur(0)" }],
    { duration: 700, easing: SWIFT, fill: "backwards", delay: 120 });
}
function sparks(n) {
  if (reduce) return;
  const box = $("#dust");
  for (let i = 0; i < n; i++) {
    const b = document.createElement("b"), a = Math.random() * Math.PI * 2, d = L.R * (1.7 + Math.random() * 1.1);
    box.append(b);
    b.animate([{ transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d}px) scale(1)`, opacity: 0 }, { opacity: 0.95, offset: 0.2 },
      { transform: `translate(${Math.cos(a) * L.R * 0.2}px,${Math.sin(a) * L.R * 0.2}px) scale(.3)`, opacity: 0 }],
      { duration: 900 + Math.random() * 500, delay: Math.random() * 500, easing: "cubic-bezier(.5,0,.9,.6)" }).finished.then(() => b.remove());
  }
}
/** covers drift inside the ball while it picks (the answer's mosaic will come out of here) */
function coversInside(ids) {
  const box = $("#inside"); box.innerHTML = "";
  ids.slice(0, 6).forEach((id, i) => {
    const t = T[id]; if (!t?.c) return;
    const im = new Image(); im.src = img(t.c); box.append(im);
    const a = (i / 6) * 360, r = 95 + (i % 3) * 35;
    im.animate([0, 1, 2, 3, 4].map((k) => {
      const ang = ((a + k * 90) * Math.PI) / 180, z = Math.sin(ang);
      return { transform: `translate(${Math.cos(ang) * r}%,${z * r * 0.4}%) scale(${0.7 + 0.35 * (z + 1) / 2})`, opacity: k === 0 ? 0 : 0.1 + 0.24 * (z + 1) / 2 };
    }), { duration: 9000, iterations: Infinity, easing: "linear", delay: -i * 1500 });
  });
}

/* ── the answer ──────────────────────────────────────────────────────────── */
async function answer(scn) {
  const ans = $("#answer");
  const dt = S.real ? scn.real : scn.real;
  caption("", false); $("#capt").innerHTML = "";
  app.classList.add("answering"); app.classList.remove("working");
  inner.style.minHeight = "";
  O.eT = 0.22;
  ans.innerHTML = `<div class="meta rise"><i></i>${KIND[scn.kind].label}<span>· ${(+dt).toFixed(dt < 10 ? 1 : 0).replace(".", ",")} с</span>${scn.prod ? '<span class="note">сейчас сервер уходит в интернет и не находит — собрать из титров, без ЛЛМ</span>' : ""}<button class="new" type="button">${icon("Close", 14)}Новый вопрос</button></div><div class="body"></div>`;
  $(".new", ans).addEventListener("click", () => reset());
  const body = $(".body", ans);
  if (scn.kind === "playlist") renderPlaylist(body, scn);
  if (scn.kind === "audio_search") renderSound(body, scn);
  if (scn.kind === "lyrics_search") renderLyrics(body, scn);
  if (scn.kind === "general") renderAnswer(body, scn);
  body.insertAdjacentHTML("beforeend", '<div class="slot"></div>');
  hydrate(ans);
  releaseCovers($$("[data-fly]", body));
  dockOrb(true); dockEcho(); placeAsk("answer");
  sky.push({ q: scn.q, intent: scn.kind, born: true });
  if (scn.kind === "lyrics_search") setTimeout(() => achieve("lyr"), 1500);
}

/** the orb shrinks to the answer's side and stays there as its speaker; click = back */
function dockOrb(animate) {
  const box = $("#orbbox"), k = 30 / L.R, tx = L.ansL + 30 - L.cx, ty = 66 - L.cy, from = box.style.transform || "none";
  const to = `translate(${tx}px,${ty}px) scale(${k})`;
  if (animate) box.animate([{ transform: from }, { transform: to }], { duration: SPR.duration, easing: SPR.easing });
  box.style.transform = to;
}
function dockEcho() {
  const el = $("#echo"), first = el.getBoundingClientRect();
  for (const a of el.getAnimations()) a.cancel();
  Object.assign(el.style, { left: L.ansL + 78 + "px", transform: "none", maxWidth: L.ansW - 90 + "px", opacity: 1 });
  el.style.top = Math.round(66 - el.offsetHeight / 2) + "px";
  const last = el.getBoundingClientRect();
  el.animate([{ transform: `translate(${first.left - last.left}px,${first.top - last.top}px)` }, { transform: "none" }], { duration: SPR.duration, easing: SPR.easing });
}
/** the field: under the orb at rest; away while the orb works (the question is over the orb);
 *  after the answer it stands at the answer's end, in the flow, never over the text */
function placeAsk(mode, animate = true) {
  const f = $("#ask"), was = f.classList.contains("away") || (f.dataset.shown && f.dataset.shown !== mode);
  f.dataset.mode = mode;
  if (mode === "away") { f.classList.add("away"); return; }
  let aw = L.aw, left = L.cx - L.aw / 2, top = L.cy + L.R + 58;
  if (mode === "answer") {
    const slot = $("#answer .slot"); if (!slot) return;
    aw = Math.min(620, L.ansW); left = L.ansL;
    top = (slot.getBoundingClientRect().top - stage.getBoundingClientRect().top) / scaleK();
  }
  Object.assign(f.style, { width: aw + "px", left: left + "px", top: top + "px" });
  $("#q").placeholder = mode === "answer" ? "Уточнить или спросить ещё…" : L.ph;
  f.classList.remove("away"); f.dataset.shown = mode;
  if (animate && was) f.animate([{ opacity: 0, transform: "translateY(14px) scale(.98)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
    { duration: SPR.duration, easing: SPR.easing, delay: mode === "answer" ? 650 : 200, fill: "backwards" });
}

async function reset(quick) {
  run++; busy = false;
  const ans = $("#answer"), body = $(".body", ans);
  if (app.classList.contains("answering")) {
    await ans.animate([{ opacity: 1, filter: "blur(0)" }, { opacity: 0, filter: "blur(10px)", transform: "translateY(16px)" }], { duration: 260, easing: EXIT }).finished;
    ans.innerHTML = "";
  }
  app.classList.remove("answering", "working");
  $("#split").innerHTML = ""; $("#inside").innerHTML = ""; O.dimT = 0;
  const box = $("#orbbox"), from = box.style.transform || "none";
  box.style.transform = "";
  box.animate([{ transform: from }, { transform: "none" }], { duration: SPR.duration, easing: SPR.easing });
  const echo = $("#echo");
  for (const a of echo.getAnimations()) a.cancel();
  echo.style.opacity = "0"; echo.animate([{ opacity: 1 }, { opacity: 0, filter: "blur(8px)" }], { duration: 240, easing: EXIT });
  $("#capt").innerHTML = ""; setKind("idle"); O.eT = 0.15;
  layout(); placeSky(); placeAsk("idle");
  showOrbit();
  if (!quick) await sleep(200);
}

/* the answer's covers come out of the orb: a cover that was already turning inside flies from where it
   was (blurred, as it was seen through the smoke), the others leave the orb's heart; covers inside that
   are not in the answer sink back into the smoke as the orb shrinks */
function releaseCovers(targets, stagger = 42) {
  const k = scaleK(), a0 = app.getBoundingClientRect(), o = $("#orbhit").getBoundingClientRect();
  const ox = o.left + o.width / 2, oy = o.top + o.height / 2;
  const inside = $$("#inside img").map((im) => ({ im, src: im.getAttribute("src"), r: im.getBoundingClientRect(), op: +getComputedStyle(im).opacity }));
  targets.forEach((im, i) => {
    const r = im.getBoundingClientRect(); if (!r.width) return;
    const src = im.getAttribute("src"), j = inside.findIndex((x) => x.src === src), from = j >= 0 ? inside.splice(j, 1)[0] : null;
    if (from) from.im.remove();
    im.style.opacity = "0";
    const fl = document.createElement("img"); fl.src = src; fl.alt = "";
    const rad = +im.dataset.fly >= 999 ? "50%" : im.dataset.fly + "px";
    fl.style.cssText = `position:fixed;z-index:60;left:${(r.left - a0.left) / k}px;top:${(r.top - a0.top) / k}px;width:${r.width / k}px;height:${r.height / k}px;object-fit:cover;border-radius:${rad};pointer-events:none`;
    app.append(fl);
    const fx = from ? from.r.left + from.r.width / 2 : ox + Math.cos(i * 2.4) * o.width * 0.12, fy = from ? from.r.top + from.r.height / 2 : oy + Math.sin(i * 2.4) * o.height * 0.12;
    const sc = from ? from.r.width / r.width : 0.1;
    fl.animate([{ transform: `translate(${(fx - (r.left + r.width / 2)) / k}px,${(fy - (r.top + r.height / 2)) / k}px) scale(${sc})`, opacity: from ? Math.max(0.35, from.op) : 0, filter: "blur(7px)" },
      { opacity: 1, offset: 0.35 }, { transform: "none", opacity: 1, filter: "blur(0)" }],
      { duration: SPR_BOUNCE.duration + 120, easing: SPR_BOUNCE.easing, delay: (from ? 0 : 90) + i * stagger, fill: "backwards" }).finished.then(() => { im.style.opacity = ""; fl.remove(); });
  });
  for (const x of inside) x.im.animate([{ opacity: x.op, filter: "blur(7px)" }, { opacity: 0, filter: "blur(14px)" }], { duration: 450, easing: EXIT }).finished.then(() => x.im.remove());
}
/* where the answer's pictures come from: out of the orb, into their places */
function flyFromOrb(imgs, stagger = 55) {
  const app0 = app.getBoundingClientRect(), k = S.size === "win" ? 1 : +getComputedStyle(app).getPropertyValue("--k") || 1;
  const o = $("#orbhit").getBoundingClientRect(), ox = o.left + o.width / 2, oy = o.top + o.height / 2;
  imgs.forEach((im, i) => {
    const r = im.getBoundingClientRect(); if (!r.width) return;
    im.style.opacity = "0";
    const fl = im.cloneNode(); fl.style.cssText = `position:fixed;z-index:60;left:${(r.left - app0.left) / k}px;top:${(r.top - app0.top) / k}px;width:${r.width / k}px;height:${r.height / k}px;border-radius:8px;object-fit:cover;pointer-events:none;opacity:1`;
    app.append(fl);
    const dx = (ox - (r.left + r.width / 2)) / k, dy = (oy - (r.top + r.height / 2)) / k;
    fl.animate([{ transform: `translate(${dx}px,${dy}px) scale(.08)`, opacity: 0, filter: "blur(6px)" }, { opacity: 1, offset: 0.25 }, { transform: "none", opacity: 1, filter: "blur(0)" }],
      { duration: SPR_BOUNCE.duration, easing: SPR_BOUNCE.easing, delay: i * stagger, fill: "backwards" }).finished.then(() => { im.style.opacity = ""; fl.remove(); });
  });
}
const dur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const rowHTML = (id, i) => { const t = T[id]; return `<div class="row rise" style="--d:${300 + i * 35}" data-play="${id}"><span class="no">${i + 1}</span><span class="cw"><img src="${img(t.c)}" alt=""><span class="pl">${icon("Play", 16)}</span></span><span class="t"><b>${esc(t.t)}</b><span>${esc(t.a)}${t.al ? " · " + esc(t.al) : ""}</span></span><span class="du">${dur(t.d)}</span></div>`; };
function mosaicOf(ids) {
  const seen = new Set(), out = [];
  for (const id of ids) { const c = T[id]?.c; if (c && !seen.has(c)) { seen.add(c); out.push(c); } if (out.length === 4) break; }
  while (out.length < 4 && out.length) out.push(out[out.length % Math.max(1, out.length)]);
  return out;
}

function renderPlaylist(body, scn) {
  const ids = scn.tracks.slice(0, 15), m = mosaicOf(ids), mins = Math.round(ids.reduce((s, id) => s + (T[id].d || 0), 0) / 60);
  body.innerHTML = `<div class="pl-head"><div style="position:relative"><div class="mosaic-glow">${m.map((c) => `<img src="${img(c)}" alt="">`).join("")}</div><div class="mosaic">${m.map((c) => `<img src="${img(c)}" alt="" data-fly="3">`).join("")}</div></div>
    <div class="rise" style="--d:120"><h1>${esc(scn.title)}</h1><div class="sub">${ids.length} ${plural(ids.length, "песня", "песни", "песен")} · ${mins} мин</div>
    <p>${esc(scn.text)} ${scn.prod ? '<span class="src">Из титров твоей библиотеки.</span>' : ""} <span class="note">${scn.prod ? "текст — пример" : "текст — пример: сервер пока пишет только название"}</span></p>
    <div class="acts"><button class="btn solid" type="button" data-play="${ids[0]}">${icon("Play", 16)}Слушать</button><button class="btn lg" type="button" data-save>${icon("Plus", 16)}Сохранить</button><button class="btn lg round" type="button" aria-label="Перемешать" data-toast="Перемешано">${icon("Shuffle", 16)}</button></div></div></div>
    <div class="refine rise" style="--d:260">${E.refine.playlist.map((r) => `<button type="button" data-ask="${esc(r)}"><i></i>${esc(r)}</button>`).join("")}</div>
    <div class="rows">${ids.map(rowHTML).join("")}</div>`;
}
function bars(id) { let s = ""; for (let i = 0; i < 18; i++) s += `<b style="--h:${Math.round(22 + 78 * hash(id + i))};--i:${i}"></b>`; return s; }
function renderSound(body, scn) {
  const ids = scn.tracks.slice(0, 15);
  body.innerHTML = `<div class="snd-head rise" style="--d:80"><h1>${esc(scn.title)}</h1><div class="sub">${ids.length} ${plural(ids.length, "песня", "песни", "песен")} из твоей библиотеки, близких по звуку</div>
    <div class="acts"><button class="btn solid" type="button" data-play="${ids[0]}">${icon("Play", 16)}Слушать всё</button><button class="btn lg" type="button" data-save>${icon("Plus", 16)}Сохранить как плейлист</button></div></div>
    <div class="grid">${ids.map((id) => { const t = T[id]; return `<div class="tile" data-play="${id}"><div class="cw"><img src="${img(t.c)}" alt="" data-fly="12"><span class="wave">${bars(id)}</span><span class="pl">${icon("Play", 18)}</span></div><b>${esc(t.t)}</b><span>${esc(t.a)}</span></div>`; }).join("")}</div>
    <div class="refine rise" style="--d:500">${E.refine.audio.map((r) => `<button type="button" data-ask="${esc(r)}" style="--c:var(--k-audio)"><i></i>${esc(r)}</button>`).join("")}</div>`;
}
function verse(lyrics, line) {
  const ls = String(lyrics || "").split("\n").filter((x) => x.trim());
  const i = Math.max(0, ls.findIndex((x) => x.trim() === String(line || "").trim()));
  return ls.slice(Math.max(0, i - 2), i + 2).map((x, j) => (Math.max(0, i - 2) + j === i ? `<span class="hit">${esc(x)}</span>` : esc(x))).join("<br>");
}
function renderLyrics(body, scn) {
  const [best, ...more] = scn.hits, t = T[best.id];
  body.innerHTML = `<div class="lyr-best"><div class="cw"><img src="${img(t.c)}" alt="" data-fly="16"></div><div class="rise" style="--d:150">
    <span class="sure">${icon("Check", 14)}Точно она</span><h1>${esc(t.t)}</h1><div class="by">${esc(t.a)} · ${esc(t.al)}${t.y ? " · " + t.y : ""}</div>
    <div class="verse">${verse(best.lyrics, best.line)}</div>
    <div class="acts"><button class="btn solid" type="button" data-play="${best.id}">${icon("Play", 16)}Слушать</button></div>
    <div class="why">${esc(scn.message)}</div></div></div>
    ${more.length ? `<div class="lyr-more rise" style="--d:420"><h3>Похоже, но слабее</h3>${more.map((h) => { const m = T[h.id]; return `<div class="row" data-play="${h.id}"><span class="cw"><img src="${img(m.c)}" alt=""><span class="pl">${icon("Play", 16)}</span></span><span class="t"><b>${esc(m.t)}</b><span>${esc(m.a)}</span></span><q>${esc(h.line || E.weakLine)}</q></div>`; }).join("")}</div>` : ""}`;
}
function renderAnswer(body, scn) {
  const s = scn.subject, paras = String(scn.text || "").split(/\n\n+/);
  const aside = s ? `<aside class="ans-aside"><div class="cw${s.cover ? "" : " round"}"><img src="${img(s.cover || s.photo)}" alt="" data-fly="${s.cover ? 14 : 999}"></div>
    <b class="rise" style="--d:350">${esc(s.name)}</b><span class="rise" style="--d:400">${esc(s.sub || "")}</span>
    <button class="btn ${s.track ? "solid" : "lg"} rise" style="--d:480" type="button" ${s.track ? `data-play="${s.track}"` : `data-toast="Откроется ${esc(s.name)}"`}>${s.track ? icon("Play", 16) + "Слушать" : "Открыть"}</button></aside>` : "";
  body.innerHTML = `<div class="ans-grid"><div class="ans-main"><div class="ans-text"></div><div class="ans-src rise" style="--d:${400 + scn.text.length * 6}">${(scn.src || []).map((x) => `<b>${esc(x)}</b>`).join("")}</div>
    <div class="follow">${(scn.follow || []).map((f, i) => `<button class="rise" style="--d:${600 + scn.text.length * 6 + i * 90}" type="button" data-ask="${esc(f)}"><i></i>${esc(f)}</button>`).join("")}</div></div>${aside}</div>`;
  const box = $(".ans-text", body); let n = 0;
  box.innerHTML = paras.map((p) => `<p>${E.link(esc(p)).split(/(\s+|<a [^>]*>.*?<\/a>)/).map((w) => (w.trim() ? `<span class="w" style="animation-delay:${(n++ * 26) + 300}ms">${w}</span>` : w)).join("")}</p>`).join("");
}

async function clarify(scn) {
  caption("Не уверен, что именно нужно — уточни");
  O.dimT = 0.2;
  const sp = $("#split"); sp.innerHTML = "";
  const opts = [{ k: "audio_search", t: "Похожее по звуку", go: () => ask("Похожее по звуку на «Stronger»", { item: { intent: "audio_search" } }) },
    { k: "general", t: "Что сэмплирует «Stronger»", go: () => ask("Что сэмплирует «Stronger»?", { item: { intent: "general", answer: E.stronger, artist: E.subj("kanye-west") } }) },
    { k: "playlist", t: "Хиты Kanye West", go: () => ask("Хиты Kanye West") }];
  const row = document.createElement("div"); row.className = "opts";
  row.style.left = L.cx + "px"; row.style.top = L.cy + L.R + 62 + "px";
  sp.append(row);
  opts.forEach((o, i) => {
    const el = document.createElement("button"); el.type = "button"; el.className = "opt lg"; el.style.setProperty("--c", KIND[o.k].c);
    el.innerHTML = `<i></i>${esc(o.t)}<small>${esc(KIND[o.k].label)}</small>`;
    row.append(el);
    el.animate([{ opacity: 0, transform: "translateY(12px) scale(.96)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: SPR.duration, easing: SPR.easing, delay: 120 + i * 70, fill: "backwards" });
    el.addEventListener("click", async () => {
      for (const m of $$(".opt", row)) if (m !== el) { m.style.opacity = "0"; m.animate([{ opacity: 1 }, { opacity: 0, filter: "blur(6px)" }], { duration: 200, easing: EXIT }); }
      const r = el.getBoundingClientRect(), s0 = stage.getBoundingClientRect(), k = scaleK();
      const dx = L.cx - ((r.left + r.width / 2 - s0.left) / k), dy = L.cy - ((r.top + r.height / 2 - s0.top) / k);
      el.style.opacity = "0";
      await el.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(.35)`, opacity: 0, filter: "blur(3px)" }], { duration: 520, easing: SWIFT }).finished;
      sp.innerHTML = ""; O.dimT = 0; pulse(0.6);
      busy = false; app.classList.remove("working"); o.go();
    });
  });
}

/* ── the carousel ────────────────────────────────────────────────────────── */
const qday = D.orbit.find((o) => /Что значит название/.test(o.q) && o.q.includes("Mighty")) || D.orbit[5];
const cards = [{ kind: "qday", kicker: "Вопрос дня", title: qday.q, ask: qday.q, intent: "general", item: qday }, ...E.order(D.carousel)];
let deal = 0;
function cardHTML(c, i) {
  const k = `<div class="kick"><i style="--c:${KIND[c.intent].c}"></i>${esc(c.kicker)}</div>`;
  const fan = (c.covers || []).slice(0, 4).map((x, j) => `<img src="${img(x)}" alt="" style="--i:${j};z-index:${4 - j}">`).join("");
  const go = `<span class="ask-l">Спросить ${icon("ChevronRight", 13)}</span>`;
  const n = (v, a, b2, c2) => `${v} ${plural(v, a, b2, c2)}`;
  if (c.kind === "qday") return `<button type="button" class="card qday" data-card="${i}">${k}<div class="tt">${esc(c.title)}</div>${go}</button>`;
  if (c.kind === "producer" || c.kind === "guest") return `<button type="button" class="card ${c.kind}" data-card="${i}">${k}<div class="fan">${fan}</div><div class="tt">${esc(c.title)}</div><div class="ln">${n(c.n, "песня", "песни", "песен")} у ${n(c.m, "артиста", "артистов", "артистов")} твоей библиотеки</div>${go}</button>`;
  if (c.kind === "story") return `<button type="button" class="card story" data-card="${i}"><span class="lit" style="background-image:url(${img(c.cover)})"></span>${k}<img class="cv" src="${img(c.cover)}" alt=""><div class="tt">${esc(c.title)}</div><div class="ln">${esc(c.line)}</div>${go}</button>`;
  if (c.kind === "name") return `<button type="button" class="card name" data-card="${i}"><span class="lit" style="background-image:url(${img(c.photo)})"></span>${k}<img class="ph" src="${img(c.photo)}" alt=""><div class="tt">${esc(c.line)}</div>${go}</button>`;
  if (c.kind === "year") return `<button type="button" class="card year" data-card="${i}"><span class="lit" style="background-image:url(${img(c.cover)})"></span>${k}<img class="cv" src="${img(c.cover)}" alt=""><div class="tt">${esc(c.title)}</div><div class="ln">${esc(c.artist)} · ${c.years} лет</div>${go}</button>`;
  return `<button type="button" class="card" data-card="${i}">${k}<div class="tt">${esc(c.title)}</div><div class="ln">${esc(c.line)}</div>${go}</button>`;
}
function renderFeed() {
  $("#feed").innerHTML = `<div class="hd"><h2>Интересное в твоей музыке</h2><span class="note">собрано из библиотеки и фактов, без ЛЛМ</span>
    <button class="more" type="button" id="more">${icon("Refresh", 15)}Другие</button></div><div class="rail" id="rail"></div>`;
  $("#more").addEventListener("click", async () => {
    $("#more .ic").animate([{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }], { duration: 700, easing: SWIFT });
    const old = $$("#rail .card");
    await Promise.all(old.map((c, i) => c.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-10px) scale(.97)", filter: "blur(6px)" }], { duration: 220, easing: EXIT, delay: i * 30, fill: "forwards" }).finished));
    deal = (deal + 1) % Math.ceil(cards.length / L.nCards); renderCards(true);
  });
}
function renderCards(animate) {
  const n = L.nCards || 4, from = (deal * n) % cards.length, idx = [];
  for (let i = 0; i < n; i++) idx.push((from + i) % cards.length);
  const rail = $("#rail"); if (!rail) return;
  rail.innerHTML = idx.map((i) => cardHTML(cards[i], i)).join("");
  if (animate) $$(".card", rail).forEach((c, i) => c.animate([{ opacity: 0, transform: "translateY(14px) scale(.97)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: SPR.duration, easing: SPR.easing, delay: 60 + i * 55, fill: "backwards" }));
}

/* achievements: the library's stickers, a new one drops in at the top right with a soft «бульк» */
const ACH = { lyr: { e: "Д", t: "Детектив", s: "Песня найдена по одной строчке" }, save: { e: "К", t: "Куратор", s: "Первая подборка ассистента в библиотеке" } };
const got = new Set();
function achieve(id) {
  if (got.has(id)) return; got.add(id);
  const a = ACH[id], p = $("#pop");
  p.innerHTML = `<span class="stk">${a.e}</span><span><em>Новая наклейка</em><b>${esc(a.t)}</b><small>${esc(a.s)}</small></span>`;
  p.classList.add("on"); blop(); setTimeout(() => p.classList.remove("on"), 3800);
}
let ac;
function blop() {
  try {
    ac = ac || new AudioContext(); const t = ac.currentTime;
    for (const [f0, f1, at, g0] of [[520, 190, 0, 0.16], [880, 420, 0.07, 0.06]]) {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = "sine";
      o.frequency.setValueAtTime(f0, t + at); o.frequency.exponentialRampToValueAtTime(f1, t + at + 0.16);
      g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(g0, t + at + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.22);
      o.connect(g).connect(ac.destination); o.start(t + at); o.stop(t + at + 0.25);
    }
  } catch {}
}

/* save: the mosaic flies into «Библиотека» on the island and is taken in */
function saveFly(btn) {
  const src = $(".mosaic") || $(".grid .cw"), lib = $("#nav-lib"); if (!src) return;
  const app0 = app.getBoundingClientRect(), k = S.size === "win" ? 1 : +getComputedStyle(app).getPropertyValue("--k") || 1;
  const r = src.getBoundingClientRect(), t = lib.getBoundingClientRect();
  const fl = src.cloneNode(true); fl.style.cssText = `position:fixed;z-index:60;left:${(r.left - app0.left) / k}px;top:${(r.top - app0.top) / k}px;width:${r.width / k}px;height:${r.height / k}px;margin:0;pointer-events:none`;
  app.append(fl);
  const dx = (t.left + t.width / 2 - (r.left + r.width / 2)) / k, dy = (t.top + t.height / 2 - (r.top + r.height / 2)) / k;
  fl.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${dx * 0.55}px,${dy * 0.35 - 60}px) scale(.45) rotate(-6deg)`, opacity: 1, offset: 0.55 }, { transform: `translate(${dx}px,${dy}px) scale(.08)`, opacity: 0.2 }],
    { duration: 900, easing: "cubic-bezier(.5,0,.3,1)" }).finished.then(() => {
    fl.remove(); lib.animate([{ transform: "scale(1)" }, { transform: "scale(1.14)" }, { transform: "scale(1)" }], { duration: SPR_BOUNCE.duration, easing: SPR_BOUNCE.easing });
    btn.classList.add("saved"); btn.innerHTML = `${icon("Check", 16)}В библиотеке`; toast(`«${cur?.title || "Подборка"}» — в библиотеке`); achieve("save");
  });
}
function play(id) {
  const t = T[id]; if (!t) return;
  $("#mini-cover").src = img(t.c); $("#mini-t").textContent = t.t; $("#mini-a").textContent = t.a;
  $(".mini").animate([{ transform: "translateY(6px)", opacity: 0.6 }, { transform: "none", opacity: 1 }], { duration: SPR.duration, easing: SPR.easing });
}
