/* ── library: «Добавить» beside search; one place for all music coming in ── */
const lib = $("#s-library"), addBtn = $("#addBtn"), cnt = $("#addCnt");
const C = window.COVERS || [];
const img = (i) => `img/${(C[i % C.length] || {}).img || "c0"}.jpg`;
const mos = (ids) => `<span class="mos">${ids.map((i) => `<img src="${img(i)}" alt="">`).join("")}</span>`;
const yb = (cls = "yb2") => `<span class="${cls}"><svg viewBox="0 0 24 24"><path d="${IMPULSE}"/></svg></span>`;
const plural = (n, a, b, c) => (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);
const MIRRORS = [
  { t: "Мне нравится", n: 412, fresh: 24, likes: true, when: "1 октября" },
  { t: "В дорогу", n: 38, fresh: 9, covers: [3, 4, 1, 6], when: "1 октября" },
  { t: "Тренировка", n: 61, fresh: 4, covers: [9, 13, 2, 8], when: "4 октября" },
];
const SOURCES = [
  { t: "Вечерний джаз", n: 27, covers: [11, 7, 12, 5] },
  { t: "Рэп 2010-х", n: 54, covers: [1, 0, 14, 10] },
  { t: "Для фокуса", n: 33, covers: [13, 5, 7, 3] },
  { t: "Саундтреки", n: 19, covers: [6, 12, 9, 4] },
];
const state = { files: [], sync: null, added: 0 };
const freshTotal = () => MIRRORS.reduce((a, m) => a + m.fresh, 0);

/* the ring around «+» is the progress of everything coming in: a song counts as in once it is
   playable (sent and its sound processed); facts come later and never hold the ring */
const READY = { queue: 0, hash: 0.05, send: 0.65, sound: 1, facts: 1, done: 1, dupe: 1, error: 1 };
function readiness(f) {
  if (f.phase === "hash") return 0.05 * f.p;
  if (f.phase === "send") return 0.05 + 0.6 * f.p;
  if (f.phase === "sound") return 0.65 + 0.35 * Math.min(1, f.t / f.T);
  return READY[f.phase];
}
function paintRing() {
  const parts = state.files.map(readiness);
  if (state.sync) parts.push(state.sync.done / state.sync.total);
  const busy = parts.some((p) => p < 1);
  addBtn.toggleAttribute("data-busy", busy);
  addBtn.style.setProperty("--p", parts.length ? String(parts.reduce((a, b) => a + b, 0) / parts.length) : "0");
  if (menu) paintInbox();
}
function landed(n) {
  state.added += n;
  cnt.textContent = `+${state.added}`;
  addBtn.toggleAttribute("data-new", true);
  addBtn.classList.remove("gulp"); void addBtn.offsetWidth; addBtn.classList.add("gulp");
}

/* the menu */
let menu = null;
/* the inbox: one row per song, one status at a time, in the order the server works:
   отправка → звук → факты. Rows are built once and updated in place (nothing jumps) */
const STAGE = { queue: 0, hash: 0, send: 0, sound: 1, facts: 2, done: 3, dupe: 3, error: -1 };
function label(f) {
  switch (f.phase) {
    case "queue": return "В очереди";
    case "hash": return `Проверяю файл · ${Math.round(f.p * 100)}%`;
    case "send": return `Отправляю · ${Math.round(f.p * 100)}% · ${f.speed.toFixed(1).replace(".", ",")} МБ/с`;
    case "sound": return "Обрабатываю звук";
    case "facts": return "Собираю факты";
    case "done": return `Готово · ${f.facts} ${plural(f.facts, "факт", "факта", "фактов")}`;
    case "dupe": return "Уже в библиотеке";
    case "error": return f.err;
  }
}
function inboxHTML() { return state.files.length ? `<div class="inbox"><div class="ih"><span class="ih-t"></span><button class="ih-clear" type="button">Убрать готовые</button></div><div class="ib-wrap"><ol></ol></div></div>` : ""; }
function rowEl(f, i) {
  const li = document.createElement("li");
  li.dataset.k = i;
  li.innerHTML = `<span class="cv"><span class="fmt">${(f.name.split(".").pop() || "").toUpperCase()}</span></span>
    <span class="tx"><span class="ti"></span><span class="ar"></span></span>
    <span class="act"></span>
    <span class="st"><span class="segs"><i></i><i></i><i></i></span><span class="lb"></span></span>`;
  li.querySelector(".cv").style.setProperty("--h", String(f.hue));
  return li;
}
function paintRow(li, f) {
  const cv = li.querySelector(".cv"), known = f.known;
  if (known && !cv.dataset.dev) { cv.dataset.dev = "1"; cv.style.backgroundImage = f.cover ? `url(${f.cover})` : ""; if (!f.cover) cv.dataset.fill = "1"; if (!reduce()) cv.animate([{ filter: "blur(6px) saturate(.3)", opacity: 0.4 }, { filter: "none", opacity: 1 }], { duration: 700, easing: STD }); }
  li.querySelector(".ti").textContent = known ? f.title : f.name.replace(/\.[^.]+$/, "");
  li.querySelector(".ar").textContent = known ? `${f.artist} · ${f.album}` : f.phase === "error" ? "" : "теги прочитаются на сервере";
  const segs = li.querySelectorAll(".segs i"), stg = STAGE[f.phase];
  segs.forEach((s, k) => {
    const fill = f.phase === "error" ? (k < f.failedAt ? 1 : k === f.failedAt ? 1 : 0) : k < stg ? 1 : k === stg ? (k === 0 ? (f.phase === "hash" ? 0.08 * f.p : f.phase === "send" ? 0.08 + 0.92 * f.p : 0) : 0) : 0;
    s.style.setProperty("--p", String(fill));
    s.toggleAttribute("data-run", f.phase !== "error" && k === stg && (k > 0 || f.phase === "hash" || f.phase === "send"));
    s.toggleAttribute("data-wave", f.phase !== "error" && k === stg && k > 0);
    s.toggleAttribute("data-bad", f.phase === "error" && k === f.failedAt);
  });
  li.dataset.phase = f.phase;
  li.querySelector(".lb").textContent = label(f);
  const act = li.querySelector(".act"), want = ["facts", "done", "dupe"].includes(f.phase) ? "play" : f.phase === "error" ? "retry" : ["queue", "hash", "send"].includes(f.phase) ? "cancel" : "";
  if (act.dataset.a !== want) {
    act.dataset.a = want;
    act.innerHTML = want === "play" ? `<button type="button" aria-label="Слушать">${icon("Play", 13)}</button>` : want === "retry" ? `<button type="button" aria-label="Повторить">${icon("Retry", 15)}</button>` : want === "cancel" ? `<button type="button" aria-label="Отменить">${icon("Close", 14)}</button>` : "";
    if (want === "play" && !reduce()) act.firstChild?.animate([{ transform: "scale(0)" }, { transform: "scale(1.2)" }, { transform: "scale(1)" }], { duration: 480, easing: SPRING });
  }
}
function paintInbox() {
  if (!menu) return;
  const host = $("[data-inbox]", menu);
  if (state.files.length && !$(".inbox", host)) {
    host.innerHTML = inboxHTML();
    const ol = $("ol", host);
    state.files.forEach((f, i) => ol.append(rowEl(f, i)));
    ol.addEventListener("scroll", edges, { passive: true });
    $(".ih-clear", host).addEventListener("click", clearDone);
    ol.addEventListener("click", onRowAct);
  }
  const ol = $("ol", host); if (!ol) return paintSync();
  state.files.forEach((f, i) => { let li = ol.querySelector(`li[data-k="${i}"]`); if (!li && !f.gone) { li = rowEl(f, i); ol.append(li); } if (li) paintRow(li, f); });
  const fin = state.files.filter((f) => !f.gone && ["facts", "done", "dupe", "error"].includes(f.phase)).length, all = state.files.filter((f) => !f.gone).length;
  const ready = state.files.filter((f) => !f.gone && ["facts", "done", "dupe"].includes(f.phase)).length;
  $(".ih-t", host).innerHTML = fin === all ? `Загружено <span>${ready} из ${all} в библиотеке</span>` : `Загружаю ${all} ${plural(all, "песню", "песни", "песен")} <span>${ready} уже ${plural(ready, "играет", "играют", "играют")}</span>`;
  $(".ih-clear", host).hidden = !state.files.some((f) => !f.gone && ["done", "dupe"].includes(f.phase));
  paintSync();
  edges();
}
function paintSync() { const s = menu && $("[data-sync]", menu), h = syncItem(); if (s && s.dataset.h !== h) { s.innerHTML = h; s.dataset.h = h; } }
function edges() { const ol = menu && $(".inbox ol", menu); if (!ol) return; const w = ol.parentElement; w.toggleAttribute("data-top", ol.scrollTop > 2); w.toggleAttribute("data-bottom", ol.scrollTop + ol.clientHeight < ol.scrollHeight - 2); }
function dropRow(li) {
  if (reduce()) return li.remove();
  li.style.height = `${li.offsetHeight}px`;
  li.animate([{ opacity: 1, height: `${li.offsetHeight}px` }, { opacity: 0, height: "0px", paddingTop: "0px", paddingBottom: "0px", filter: "blur(4px)" }], { duration: 320, easing: STD, fill: "forwards" }).onfinish = () => { li.remove(); edges(); };
}
function clearDone() {
  const ol = $(".inbox ol", menu);
  state.files.forEach((f, i) => { if (!f.gone && ["done", "dupe"].includes(f.phase)) { f.gone = true; const li = ol.querySelector(`li[data-k="${i}"]`); if (li) dropRow(li); } });
  setTimeout(paintInbox, 340);
}
function onRowAct(e) {
  const b = e.target.closest(".act button"); if (!b) return;
  const li = b.closest("li"), f = state.files[+li.dataset.k], a = b.parentElement.dataset.a;
  if (a === "cancel") { f.gone = true; f.phase = "error"; f.err = "отменено"; dropRow(li); paintRing(); }
  if (a === "retry") { f.phase = "send"; f.p = 0; f.bad = null; stepFiles.told = false; paintRing(); if (!startFiles.t) startFiles.t = setInterval(stepFiles, 140); }
  if (a === "play") toast(`Играет «${f.known ? f.title : f.name}»`);
}
function syncItem() {
  const s = state.sync;
  const run = s && s.done < s.total;
  return `<button class="mi sync" data-a="sync" type="button"${run ? " disabled" : ""}><span class="mic">${icon("Refresh", 20)}</span><span><span class="mt">${run ? "Обновляю из Яндекса" : "Обновить из Яндекса"}</span><span class="ms">${run ? `${s.done} из ${s.total} новых песен` : s ? "Всё свежее — новых песен нет" : `Долить новое в ${MIRRORS.length} ${plural(MIRRORS.length, "плейлист", "плейлиста", "плейлистов")}`}</span></span>${run ? `<span class="new">${Math.round((s.done / s.total) * 100)}%</span>` : s ? "" : `<span class="new">+${freshTotal()}</span>`}</button>`;
}
function menuHTML() {
  return `<div class="cap">Добавить музыку</div><div data-inbox></div>
    <button class="mi" data-a="y" type="button"><span class="mic y"><svg viewBox="0 0 24 24"><path d="${IMPULSE}"/></svg></span><span><span class="mt">Из Яндекс Музыки</span><span class="ms">Подключена · ${MIRRORS.length} ${plural(MIRRORS.length, "плейлист", "плейлиста", "плейлистов")} уже здесь</span></span><span class="chev">${icon("ChevronRight", 18)}</span></button>
    <div data-sync></div>
    <hr>
    <button class="mi upl" data-a="files" type="button"><span class="mic">${icon("Upload", 20)}</span><span><span class="mt">С компьютера</span><span class="ms">Файлы или целая папка. Можно просто перетащить их на страницу</span></span><span class="chev">${icon("ChevronRight", 18)}</span></button>`;
}
function openMenu() {
  if (menu) return closeMenu();
  $("#hintArrow").style.opacity = "0";
  addBtn.toggleAttribute("data-new", false); state.added = 0;
  menu = document.createElement("div");
  menu.className = "amenu lg"; menu.setAttribute("role", "menu");
  menu.innerHTML = menuHTML();
  lib.append(menu);
  paintInbox();
  addBtn.setAttribute("aria-expanded", "true");
  if (!reduce()) {
    menu.animate([{ opacity: 0, transform: "scale(.82)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 420, easing: SPRING });
    [...menu.children].forEach((b, i) => b.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 280, delay: 40 + i * 30, easing: STD, fill: "backwards" }));
  }
  menu.addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "y") { closeMenu(); setTimeout(openY, 120); }
    if (a === "files") { closeMenu(); $("#fileIn").click(); }
    if (a === "sync") runSync();
  });
}
function closeMenu() {
  const m = menu; menu = null; if (!m) return;
  addBtn.setAttribute("aria-expanded", "false");
  if (reduce()) return m.remove();
  m.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.86)", filter: "blur(4px)" }], { duration: 190, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).onfinish = () => m.remove();
}
addBtn.addEventListener("click", openMenu);
document.addEventListener("pointerdown", (e) => { if (menu && !menu.contains(e.target) && !addBtn.contains(e.target)) closeMenu(); });
document.addEventListener("keydown", (e) => { if (e.key !== "Escape") return; if (menu) closeMenu(); else if (ywin) closeY(); });

/* uploads, as the server sees them (contexts/library): the client hashes and sends in chunks; the
   server verifies the sha, reads the tags (the track appears), then processes the sound (loudness,
   cover, spectrum, CLAP) and, last, collects facts. A sha the server already has is not sent again. */
const DEMO_META = {
  "03 Power.flac": { title: "Power", artist: "Kanye West", album: "My Beautiful Dark Twisted Fantasy", cover: "img/f0.jpg", dupe: true },
  "10 Doin' It Right.flac": { err: "Не прочитался: файл повреждён" },
};
const hueOf = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
function startFiles(names, demo) {
  for (const name of names) {
    const m = (demo && DEMO_META[name]) || {};
    const title = name.replace(/\.[^.]+$/, "").replace(/^\d+[\s._-]+/, "");
    state.files.push({ name, phase: "queue", p: 0, t: 0, T: 14 + Math.round(Math.random() * 10), speed: 0, hue: demo ? 42 : hueOf(name),
      title: m.title || title, artist: m.artist || (demo ? "Daft Punk" : "Исполнитель из тегов"), album: m.album || (demo ? "Random Access Memories" : "альбом из тегов"),
      cover: m.cover || null, dupe: !!m.dupe, bad: m.err || null, facts: 3 + Math.round(Math.random() * 7) });
  }
  stepFiles.told = false;
  paintRing();
  if (!startFiles.t) startFiles.t = setInterval(stepFiles, 140);
}
function stepFiles() {
  let sending = 0, landedNow = 0;
  for (const f of state.files) {
    if (f.gone) continue;
    if (f.phase === "queue") { if (sending < 2) { f.phase = "hash"; f.p = 0; sending++; } continue; }
    if (f.phase === "hash") { sending++; f.p = Math.min(1, f.p + 0.34); if (f.p >= 1) { if (f.dupe) { f.phase = "dupe"; f.known = true; landedNow++; } else { f.phase = "send"; f.p = 0; } } continue; }
    if (f.phase === "send") { sending++; f.speed = 2.6 + Math.random() * 2.2; f.p = Math.min(1, f.p + 0.05 + Math.random() * 0.06); if (f.p >= 1) { f.phase = "sound"; f.t = 0; } continue; }
    if (f.phase === "sound") { f.t++; if (f.t === 4) { if (f.bad) { f.phase = "error"; f.err = f.bad; f.failedAt = 1; continue; } f.known = true; } if (f.t >= f.T) { f.phase = "facts"; f.t = 0; landedNow++; } continue; }
    if (f.phase === "facts") { if (++f.t >= 26 + (f.facts * 3)) f.phase = "done"; }
  }
  if (landedNow) landed(landedNow);
  paintRing();
  if (state.files.every((f) => f.gone || ["done", "dupe", "error"].includes(f.phase))) { clearInterval(startFiles.t); startFiles.t = 0; }
  const live = state.files.filter((f) => !f.gone);
  if (live.length && !stepFiles.told && live.every((f) => ["facts", "done", "dupe", "error"].includes(f.phase))) {
    stepFiles.told = true;
    const n = live.filter((f) => ["facts", "done"].includes(f.phase)).length, d = live.filter((f) => f.phase === "dupe").length;
    toast(`${n} ${plural(n, "песня", "песни", "песен")} в библиотеке${d ? ` · ${d} уже ${plural(d, "была", "были", "были")}` : ""} — факты подтянутся сами`);
  }
}
$("#fileIn").addEventListener("change", (e) => { const fs = [...e.target.files].map((f) => f.name); e.target.value = ""; if (fs.length) startFiles(fs); });

/* files dragged over the page */
let drop = null, depth = 0;
function showDrop() {
  if (drop) return;
  closeMenu();
  lib.dataset.focus = "drop";
  drop = document.createElement("div");
  drop.className = "drop lg";
  drop.innerHTML = `<div class="sleeve"><span class="rec"></span><span class="env"></span></div><h4>Отпусти — и песни лягут в библиотеку</h4><p>FLAC, ALAC, MP3, AAC, Opus, WAV · до 2 ГБ на файл.<br>Папку можно целиком. Одинаковые файлы не загрузятся дважды.</p>`;
  lib.append(drop);
  if (!reduce()) drop.animate([{ opacity: 0, transform: "scale(.88)", filter: "blur(10px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 460, easing: SPRING });
}
function hideDrop(into) {
  const d = drop; drop = null; depth = 0;
  delete lib.dataset.focus;
  if (!d) return;
  if (reduce()) return d.remove();
  if (into) { // the sleeve flies into «+» and is taken in
    const a = d.getBoundingClientRect(), b = addBtn.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    d.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${dx * 0.35}px, ${dy * 0.55}px) scale(.55)`, opacity: 0.9, offset: 0.45 }, { transform: `translate(${dx}px, ${dy}px) scale(.06)`, opacity: 0 }],
      { duration: 640, easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" }).onfinish = () => { d.remove(); addBtn.classList.remove("gulp"); void addBtn.offsetWidth; addBtn.classList.add("gulp"); };
  } else d.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(.94)", filter: "blur(6px)" }], { duration: 200, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).onfinish = () => d.remove();
}
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
addEventListener("dragenter", (e) => { if (scene !== "library" || ywin || !hasFiles(e)) return; e.preventDefault(); depth++; showDrop(); });
addEventListener("dragover", (e) => { if (drop) e.preventDefault(); });
addEventListener("dragleave", () => { if (drop && --depth <= 0) hideDrop(false); });
addEventListener("drop", (e) => { if (!drop) return; e.preventDefault(); const fs = [...e.dataTransfer.files].map((f) => f.name); hideDrop(true); if (fs.length) setTimeout(() => startFiles(fs), 500); });
const DEMO = ["01 Give Life Back to Music.flac", "02 The Game of Love.flac", "03 Giorgio by Moroder.flac", "04 Within.flac", "05 Instant Crush.flac", "06 Lose Yourself to Dance.flac", "07 Touch.flac", "08 Get Lucky.flac", "03 Power.flac", "10 Doin' It Right.flac"];
$("#dragDemo").addEventListener("click", () => { showDrop(); setTimeout(() => { hideDrop(true); setTimeout(() => startFiles(DEMO, true), 500); }, 1500); });

/* the Yandex window: the library goes out of focus where it stands, the window comes from «+» */
let scrim = null;
function ywinHTML() {
  const sel = SOURCES.filter((s) => s.on);
  const n = sel.reduce((a, s) => a + s.n, 0);
  return `<div class="yhead">${yb("yb")}<div><h3>Яндекс Музыка</h3><p>Подключена 1 октября · <button type="button" data-y="unlink">Отключить</button></p></div><button class="xbtn" type="button" data-y="close" aria-label="Закрыть">${icon("Close", 20)}</button></div>
  <div class="ybody">
    <section class="ysec"><h4><span>Уже в MusiX<small>следят за Яндексом: новое доливается, удалённое здесь не вернётся</small></span>
      <button class="ghost" type="button" data-y="all">${icon("Refresh", 15)}<span>Обновить все</span></button></h4>
      <div data-mirrors>${MIRRORS.map(mirrorRow).join("")}</div></section>
    <section class="ysec" style="margin-top:22px"><h4><span>Можно перенести<small>для каждого появится такой же плейлист, песни лягут и в библиотеку</small></span></h4>
      <div data-sources>${SOURCES.filter((s) => !s.moved).map(sourceRow).join("")}</div></section>
    <div class="ynote">Названия плейлистов Яндекса здесь — пример: в приложении окно читает их из твоего подключённого аккаунта.</div>
  </div>
  <div class="yfoot"><span class="sum">${sel.length ? `Выбрано <b>${sel.length} ${plural(sel.length, "плейлист", "плейлиста", "плейлистов")}</b> · ${n} ${plural(n, "песня", "песни", "песен")}` : "Отметь плейлисты, которые перенести"}</span>
    <button class="cta y" type="button" data-y="move"${sel.length ? "" : " disabled"}>Перенести</button></div>`;
}
function mirrorRow(m, i) {
  const st = m.run ? "run" : m.fresh ? "fresh" : "none";
  const chip = m.run ? `<span class="spin"></span>${m.run.done}/${m.run.total}` : m.fresh ? `+${m.fresh} ${m.fresh % 10 === 1 && m.fresh % 100 !== 11 ? "новая" : "новых"}` : `${icon("Check", 13)} свежий`;
  return `<div class="yrow mirror" data-m="${i}">${m.likes ? `<span class="mos likes"><span>♥</span>${yb()}</span>` : mos(m.covers).replace("</span>", "") + yb() + "</span>"}
    <span style="min-width:0"><span class="yt">${m.likes ? "Мне нравится из Яндекс Музыки" : m.t}</span><span class="ys"><span class="mono">${m.n + (m.got || 0)}</span> ${plural(m.n + (m.got || 0), "песня", "песни", "песен")} · обновлён ${m.got != null ? "только что" : m.when}</span></span>
    <button class="fresh" type="button" data-y="one" data-state="${st}"${m.fresh && !m.run ? "" : " disabled"}>${chip}</button></div>`;
}
function sourceRow(s) {
  const i = SOURCES.indexOf(s);
  return `<div class="yrow" data-s="${i}"><button class="ck" type="button" role="checkbox" aria-checked="${!!s.on}" data-y="pick" aria-label="Перенести «${s.t}»"><svg viewBox="0 0 20 20"><path d="M5 10.5 8.5 14 15 6.5"/></svg></button>${mos(s.covers)}
    <span style="min-width:0"><span class="yt">${s.t}</span><span class="ys"><span class="mono">${s.n}</span> ${plural(s.n, "песня", "песни", "песен")}</span></span>
    <button class="pickt" type="button" data-y="tracks">Выбрать песни${icon("ChevronDown", 15)}</button></div>`;
}
function repaintY(part) {
  if (!ywin) return;
  if (part === "mirrors") { $("[data-mirrors]", ywin).innerHTML = MIRRORS.map(mirrorRow).join(""); return; }
  const sc = $(".ybody", ywin).scrollTop;
  ywin.innerHTML = ywinHTML(); $(".ybody", ywin).scrollTop = sc;
}
function openY() {
  if (ywin) return;
  closeMenu();
  lib.dataset.focus = "away";
  scrim = document.createElement("div"); scrim.className = "scrim"; scrim.addEventListener("click", closeY); lib.append(scrim);
  ywin = document.createElement("div"); ywin.className = "ywin"; ywin.setAttribute("role", "dialog"); ywin.setAttribute("aria-label", "Яндекс Музыка");
  ywin.innerHTML = ywinHTML(); lib.append(ywin);
  ywin.addEventListener("click", onY);
  if (!reduce()) {
    ywin.animate([{ opacity: 0, transform: "translate(160px, -40px) scale(.72)", filter: "blur(14px)" }, { opacity: 1, offset: 0.5 }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 560, easing: EMPH });
    $$(".yrow, .ysec h4", ywin).forEach((r, i) => r.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 340, delay: 160 + i * 34, easing: STD, fill: "backwards" }));
  }
}
function closeY() {
  const w = ywin, s = scrim; ywin = null; scrim = null;
  if (!w) return;
  delete lib.dataset.focus; s?.remove();
  for (const b of $$("#mockbar [data-scene]")) b.setAttribute("aria-pressed", String(b.dataset.scene === "library"));
  if (reduce()) return w.remove();
  w.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate(140px, -36px) scale(.7)", filter: "blur(10px)" }], { duration: 260, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).onfinish = () => w.remove();
}
function topUp(list) {
  const jobs = list.filter((m) => m.fresh && !m.run);
  if (!jobs.length) return;
  const total = jobs.reduce((a, m) => a + m.fresh, 0);
  state.sync = { done: 0, total };
  for (const m of jobs) m.run = { done: 0, total: m.fresh };
  repaintY("mirrors"); paintRing();
  const t = setInterval(() => {
    const m = jobs.find((x) => x.run);
    if (!m) { clearInterval(t); paintRing(); toast(`${total} ${plural(total, "новая песня", "новые песни", "новых песен")} из Яндекса — плейлисты свежие`); return; }
    m.run.done++; state.sync.done++;
    if (m.run.done >= m.run.total) { m.got = (m.got || 0) + m.fresh; m.fresh = 0; m.run = null; }
    landed(1);
    repaintY("mirrors"); paintRing();
  }, 170);
}
function runSync() { topUp(MIRRORS); }
function onY(e) {
  const b = e.target.closest("[data-y]"); if (!b) return;
  const a = b.dataset.y;
  if (a === "close") closeY();
  if (a === "unlink") toast("В макете не отключаем");
  if (a === "all") topUp(MIRRORS);
  if (a === "one") topUp([MIRRORS[+b.closest("[data-m]").dataset.m]]);
  if (a === "tracks") toast("Здесь раскроется список песен с поиском — как в нынешнем импорте");
  if (a === "pick") {
    const s = SOURCES[+b.closest("[data-s]").dataset.s]; s.on = !s.on;
    b.setAttribute("aria-checked", String(s.on));
    const foot = $(".yfoot", ywin); const tmp = document.createElement("div"); tmp.innerHTML = ywinHTML(); foot.replaceWith($(".yfoot", tmp));
    const sum = $(".yfoot .sum", ywin); if (!reduce()) sum.animate([{ opacity: 0.3, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: STD });
  }
  if (a === "move") moveSelected();
}
/* «Перенести»: each chosen row travels up into «Уже в MusiX» and starts filling there */
function moveSelected() {
  const chosen = SOURCES.filter((s) => s.on && !s.moved);
  const from = new Map(chosen.map((s) => [s, $(`[data-s="${SOURCES.indexOf(s)}"]`, ywin).getBoundingClientRect()]));
  for (const s of chosen) { s.moved = true; s.on = false; MIRRORS.unshift({ t: s.t, n: 0, fresh: s.n, covers: s.covers, when: "сейчас", _src: s }); }
  repaintY();
  if (!reduce()) chosen.forEach((s, k) => {
    const i = MIRRORS.findIndex((m) => m._src === s), row = $(`[data-m="${i}"]`, ywin), a = from.get(s), b = row.getBoundingClientRect();
    row.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)`, opacity: 0.7 }, { transform: "none", opacity: 1 }], { duration: 640, delay: k * 60, easing: EMPH, fill: "backwards" });
  });
  setTimeout(() => topUp(MIRRORS.filter((m) => m._src && m.fresh)), 700);
}
