(() => {
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const SPRING = "cubic-bezier(.34,1.56,.64,1)", STD = "cubic-bezier(.22,.9,.3,1)", EMPH = "cubic-bezier(.2,.8,.2,1)";
const IMPULSE = "M1.06,9.65L1.09,9.30L10.74,8.91L3.82,4.44L4.00,4.17L11.16,6.76L8.21,1.54L8.46,1.40L13.46,6.00L13.77,1.00L14.04,1.01L15.62,6.35L18.07,2.67L18.28,2.80L17.24,7.16L21.00,5.28L21.14,5.49L18.41,8.67L22.68,9.01L22.73,9.27L18.70,10.34L22.94,13.06L22.88,13.32L18.46,12.11L21.68,17.32L21.49,17.55L17.42,14.03L18.55,20.79L18.27,20.93L15.17,14.30L11.58,23.00L11.24,22.94L13.12,12.79L3.10,18.72L2.89,18.43L11.91,10.94Z";
const EXTRA = {
  Phone: { d: ["M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5z", "M10.5 18.5h3"], w: 1.8, fill: [] },
  Browser: { d: ["M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V6A1.5 1.5 0 0 1 4 4.5z", "M2.5 9h19", "M5.5 6.8h.01", "M8 6.8h.01"], w: 1.8, fill: [] },
  Monitor: { d: ["M4 3.5h16a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 15V5A1.5 1.5 0 0 1 4 3.5z", "M12 16.5v4", "M8 20.5h8"], w: 1.8, fill: [] },
  Refresh: { d: ["M20 11a8 8 0 0 0-14.6-4.5L4 8", "M4 3.5V8h4.5", "M4 13a8 8 0 0 0 14.6 4.5L20 16", "M20 20.5V16h-4.5"], w: 1.9, fill: [] },
  Check: { d: ["M5 12.5 10 17.5 19 7"], w: 2.2, fill: [] },
  Key: { d: ["M4,15a4,4 0 1,0 8,0a4,4 0 1,0 -8,0", "M11 12 20 3", "M17 6l3 3", "M14.5 8.5l2 2"], w: 1.8, fill: [] },
  Download: { d: ["M12 4v11", "m7 10 5 5 5-5", "M5 20h14"], w: 1.9, fill: [] },
  Retry: { d: ["M4 12a8 8 0 1 0 2.4-5.7L4 8.5", "M4 4v4.5h4.5"], w: 2, fill: [] },
};
function icon(name, size = 18) {
  const def = (window.ICONS || {})[name] || EXTRA[name];
  if (!def) return "";
  return `<svg class="ic" style="--s:${size}px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${def.w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${def.d.map((d, i) => `<path d="${d}"${def.fill.includes(i) ? ' fill="currentColor"' : ""}/>`).join("")}</svg>`;
}
function hydrate(root = document) {
  for (const el of $$("[data-ic]", root)) { if (!el.dataset.done) { el.outerHTML = icon(el.dataset.ic, +(el.dataset.s || 18)); } }
  for (const p of $$("[data-impulse]", root)) p.setAttribute("d", IMPULSE);
}
hydrate();
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

/* ── scenes ─────────────────────────────────────────────── */
let scene = "settings";
document.documentElement.dataset.scene = "settings";
function vt(fn, kind) {
  if (!document.startViewTransition || reduce()) return fn();
  if (kind) document.documentElement.dataset.vt = kind;
  const t = document.startViewTransition(fn);
  t.finished.finally(() => delete document.documentElement.dataset.vt);
}
function show(name) {
  const yandex = name === "yandex";
  const target = yandex ? "library" : name;
  for (const b of $$("#mockbar [data-scene]")) b.setAttribute("aria-pressed", String(b.dataset.scene === name));
  if (target !== scene) {
    vt(() => {
      $("#s-settings").hidden = target !== "settings";
      $("#s-library").hidden = target !== "library";
      document.documentElement.dataset.scene = target;
      for (const a of $$(".island a")) a.toggleAttribute("aria-current", a.dataset.go === target);
      $(".gear").toggleAttribute("aria-current", target === "settings");
      scene = target;
    });
    if (target === "settings") setTimeout(phoneIn, 120);
  }
  if (yandex) setTimeout(() => openY(), target !== scene ? 60 : 380);
  else if (ywin) closeY();
}
$$("#mockbar [data-scene]").forEach((b) => b.addEventListener("click", () => show(b.dataset.scene)));
$$("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); if (a.dataset.go === "settings" || a.dataset.go === "library") show(a.dataset.go); }));
$(".gear").toggleAttribute("aria-current", true);
$('.island a[data-go="library"]').toggleAttribute("aria-current", false);
$("#marksBtn").addEventListener("click", (e) => {
  const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", String(on));
  document.documentElement.dataset.marks = on ? "on" : "off";
});
/* two columns (everything at once) or tabs: the mock's switch */
document.documentElement.dataset.layout = "cols";
$$("[data-layout]", $("#mockbar")).forEach((b) => b.addEventListener("click", () => {
  $$("[data-layout]", $("#mockbar")).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  vt(() => { document.documentElement.dataset.layout = b.dataset.layout; placeTab(); });
}));
let tab = "sound";
function placeTab(first) {
  for (const s of $$("#opts .sec")) s.toggleAttribute("data-on", s.dataset.sec === tab);
  const b = $(`#stabs [data-t="${tab}"]`), ul = $("#sul");
  $$("#stabs button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  if (!b || !b.offsetWidth) return;
  if (first || !ul.dataset.placed) { ul.style.transition = "none"; }
  ul.style.setProperty("--x", `${b.offsetLeft}px`); ul.style.setProperty("--w", `${b.offsetWidth}px`);
  if (!ul.dataset.placed) { void ul.offsetWidth; ul.style.transition = ""; ul.dataset.placed = "1"; }
}
$$("#stabs button").forEach((b) => b.addEventListener("click", () => {
  const order = $$("#stabs button").map((x) => x.dataset.t), dir = Math.sign(order.indexOf(b.dataset.t) - order.indexOf(tab));
  if (b.dataset.t === tab) return;
  const old = $(`#opts .sec[data-sec="${tab}"]`);
  tab = b.dataset.t;
  if (reduce()) return placeTab();
  // the library's tabs: a row — what leaves goes out of focus, what comes arrives into focus a beat later
  old.animate([{ opacity: 1, filter: "blur(0)", transform: "none" }, { opacity: 0, filter: "blur(8px)", transform: `translateX(${-dir * 18}px)` }], { duration: 180, easing: "cubic-bezier(.4,0,1,1)" }).onfinish = () => {
    placeTab();
    $(`#opts .sec[data-sec="${tab}"]`).animate([{ opacity: 0, filter: "blur(8px)", transform: `translateX(${dir * 30}px)` }, { opacity: 1, filter: "blur(0)", transform: "none" }], { duration: 520, easing: EMPH });
  };
  const ul = $("#sul"); ul.style.setProperty("--x", `${b.offsetLeft}px`); ul.style.setProperty("--w", `${b.offsetWidth}px`);
  $$("#stabs button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
}));
placeTab(true);

/* ── the theme button ───────────────────────────────────── */
const tb = $("#themeBtn"), tip = $("#themeTip"), hold = $(".hold", tb);
let pref = store.get("mx-mock-theme") || "dark";
const sys = () => (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
const resolved = () => (pref === "system" ? sys() : pref);
function paintTheme() {
  document.documentElement.dataset.theme = resolved();
  tb.dataset.t = pref === "system" ? "system" : resolved();
  $("#tipA").textContent = pref === "system" ? `Как в системе · сейчас ${resolved() === "dark" ? "тёмная" : "светлая"}` : resolved() === "dark" ? "Включить светлую" : "Включить тёмную";
  $("#tipB").textContent = pref === "system" ? "нажми — выберешь сам" : "удерживай — как в системе";
}
function setTheme(p) {
  const r = tb.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const st = document.documentElement.style;
  st.setProperty("--rx", `${x}px`); st.setProperty("--ry", `${y}px`); st.setProperty("--rr", `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
  const before = resolved();
  pref = p; store.set("mx-mock-theme", p);
  if (resolved() === before) return paintTheme();
  vt(paintTheme, "theme");
}
paintTheme();
let tipT = 0, holdT = 0, held = false;
tb.addEventListener("pointerenter", () => { tipT = setTimeout(() => tip.classList.add("on"), 450); });
tb.addEventListener("pointerleave", () => { clearTimeout(tipT); tip.classList.remove("on"); cancelHold(); });
tb.addEventListener("pointerdown", (e) => {
  if (e.button) return;
  held = false; clearTimeout(tipT); tip.classList.remove("on");
  holdT = setTimeout(() => { hold.classList.add("on"); holdT = setTimeout(() => { held = true; hold.classList.remove("on"); setTheme("system"); pop(tb); }, 560); }, 220);
});
function cancelHold() { clearTimeout(holdT); hold.classList.remove("on"); }
tb.addEventListener("pointerup", cancelHold);
tb.addEventListener("click", () => { if (held) { held = false; return; } setTheme(resolved() === "dark" ? "light" : "dark"); });
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => pref === "system" && vt(paintTheme, "theme"));
function pop(el) { if (!reduce()) el.animate([{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(.95)" }, { transform: "scale(1)" }], { duration: 520, easing: SPRING }); }

/* ── switches ───────────────────────────────────────────── */
for (const s of $$(".sw")) s.addEventListener("click", () => {
  const on = s.getAttribute("aria-checked") !== "true";
  s.setAttribute("aria-checked", String(on));
  if (s.id === "swNorm") $("#lufs").toggleAttribute("data-on", on);
  if (s.id === "swBulk" && on) bulk();
  if (s.id === "swIncog") incognito(on);
});
const lufs = $("#lufs");
lufs.innerHTML = [92, 38, 70, 24, 100, 55, 80].map((h, k) => `<i style="--h:${h};--k:${k}"></i>`).join("") + `<span>−14 LUFS</span>`;
let actx;
function bulk() { // the achievement's quiet «бульк»
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(380, t); o.frequency.exponentialRampToValueAtTime(820, t + 0.09); o.frequency.exponentialRampToValueAtTime(520, t + 0.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.3);
  } catch {}
}


/* ── the city and its sky ───────────────────────────────── */
const CITIES = [
  ["Стамбул", "Турция", "Europe/Istanbul"], ["Москва", "Россия", "Europe/Moscow"], ["Санкт-Петербург", "Россия", "Europe/Moscow"], ["Казань", "Россия", "Europe/Moscow"],
  ["Екатеринбург", "Россия", "Asia/Yekaterinburg"], ["Новосибирск", "Россия", "Asia/Novosibirsk"], ["Владивосток", "Россия", "Asia/Vladivostok"], ["Тбилиси", "Грузия", "Asia/Tbilisi"],
  ["Ереван", "Армения", "Asia/Yerevan"], ["Белград", "Сербия", "Europe/Belgrade"], ["Алматы", "Казахстан", "Asia/Almaty"], ["Минск", "Беларусь", "Europe/Minsk"],
  ["Дубай", "ОАЭ", "Asia/Dubai"], ["Берлин", "Германия", "Europe/Berlin"], ["Лиссабон", "Португалия", "Europe/Lisbon"], ["Нью-Йорк", "США", "America/New_York"], ["Токио", "Япония", "Asia/Tokyo"],
];
let city = CITIES[0];
const SKIES = { // the home's palettes, by the hour
  night: { bg: "radial-gradient(80% 90% at 75% 10%, #26305e 0%, transparent 60%), linear-gradient(180deg, #0b1026 0%, #141a3a 60%, #1d1838 100%)", orb: "#e9e6d6", glow: "0 0 18px 4px rgba(233,230,214,.35)", stars: 1, name: "ночь" },
  morning: { bg: "radial-gradient(90% 80% at 25% 100%, #ffb38a 0%, transparent 60%), linear-gradient(180deg, #6fa7e6 0%, #c6b9e6 60%, #ffc3a3 100%)", orb: "#fff4cf", glow: "0 0 26px 8px rgba(255,230,160,.6)", stars: 0, name: "утро" },
  day: { bg: "radial-gradient(70% 70% at 70% 0%, #bfe1ff 0%, transparent 60%), linear-gradient(180deg, #3d86e0 0%, #6aa9ef 60%, #a9cdf5 100%)", orb: "#fffbe8", glow: "0 0 26px 10px rgba(255,250,220,.7)", stars: 0, name: "день" },
  evening: { bg: "radial-gradient(90% 90% at 30% 100%, #ff7a45 0%, transparent 62%), linear-gradient(180deg, #33306e 0%, #8a4a86 55%, #f08a5d 100%)", orb: "#ffd08a", glow: "0 0 24px 8px rgba(255,170,90,.55)", stars: 0.4, name: "вечер" },
};
function paintSky(first) {
  const fmt = new Intl.DateTimeFormat("ru-RU", { timeZone: city[2], hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = fmt.format(new Date()).split(":").map(Number);
  const part = h < 5 || h >= 22 ? "night" : h < 10 ? "morning" : h < 17 ? "day" : "evening";
  const s = SKIES[part], a = $("#skyA");
  const apply = () => { a.style.background = s.bg; $("#skyStars").style.opacity = s.stars; const o = $("#skyOrb"); o.style.background = s.orb; o.style.boxShadow = s.glow;
    const f = ((h + m / 60) % 24) / 24; o.style.transform = `translate(${18 + f * 110}px, ${18 + Math.abs(Math.sin(f * Math.PI * 2)) * 16}px)`; };
  if (first || reduce()) apply(); else { a.animate([{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }], { duration: 900, easing: STD }); setTimeout(apply, 380); }
  $("#skyCity").textContent = city[0];
  $("#skyTime").textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} · ${s.name}`;
}
paintSky(true); setInterval(() => paintSky(true), 30000);
const cin = $("#cityIn"), cfield = $("#cityField");
let places = null, hl = 0, found = [];
function closePlaces() {
  const p = places; places = null; if (!p) return;
  if (reduce()) return p.remove();
  p.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.94) translateY(-4px)" }], { duration: 160, easing: "cubic-bezier(.4,0,1,1)" }).onfinish = () => p.remove();
}
function openPlaces() {
  const q = cin.value.trim().toLowerCase();
  found = CITIES.filter((c) => !q || c[0].toLowerCase().includes(q) || c[1].toLowerCase().startsWith(q)).slice(0, 6);
  hl = 0;
  const fresh = !places;
  if (!places) { places = document.createElement("div"); places.className = "places lg"; cfield.append(places); }
  places.innerHTML = found.length ? found.map((c, i) => `<button type="button" data-k="${i}"${i === hl ? " data-hl" : ""}>${c[0]}<small>${c[1]}</small></button>`).join("") : `<div style="padding:12px;color:var(--glass-ink2);font-size:14px">Такого города не нашлось</div>`;
  for (const b of $$("button", places)) b.addEventListener("mousedown", (e) => { e.preventDefault(); pick(found[+b.dataset.k]); });
  if (fresh && !reduce()) {
    places.animate([{ opacity: 0, transform: "scale(.9) translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: SPRING });
    $$("button", places).forEach((b, i) => b.animate([{ opacity: 0, transform: "translateY(-5px)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: 30 + i * 28, easing: STD, fill: "backwards" }));
  }
}
function pick(c) { city = c; cin.value = c[0]; closePlaces(); cin.blur(); paintSky(); }
cin.addEventListener("focus", () => { cin.select(); openPlaces(); });
cin.addEventListener("input", openPlaces);
cin.addEventListener("blur", () => setTimeout(() => { closePlaces(); cin.value = city[0]; }, 120));
cin.addEventListener("keydown", (e) => {
  if (!places || !found.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); hl = (hl + (e.key === "ArrowDown" ? 1 : found.length - 1)) % found.length; $$("button", places).forEach((b, i) => b.toggleAttribute("data-hl", i === hl)); }
  if (e.key === "Enter") { e.preventDefault(); pick(found[hl]); }
  if (e.key === "Escape") { closePlaces(); cin.blur(); }
});

/* ── devices (his own list, read from prod on 2026-10-12) ── */
const DEVS = [
  { n: "Chrome · Windows", p: "web", v: "2.0.0", seen: "сейчас", cur: true },
  { n: "Google Pixel 9 Pro", p: "android", v: "2.0.5", seen: "был сегодня в 20:45" },
  { n: "PC-5700X2", p: "windows", v: "2.0.0", seen: "был 2 октября" },
];
const OLD = [
  { n: "Google Pixel 9 Pro", p: "android", v: "2.0.1", seen: "до переустановки · 9 октября" },
  { n: "Chrome · Windows", p: "web", v: "2.0.0", seen: "прошлый вход · 7 октября" },
  { n: "legacy-v1", p: "web", v: "", seen: "вход из старой MusiX · 1 октября" },
];
const PLAT = { web: ["Browser", "Браузер"], android: ["Phone", "Android"], windows: ["Monitor", "Windows"] };
function devRow(d, k) {
  const [g, pn] = PLAT[d.p];
  return `<div class="row dev" style="--k:${k}"><span class="glyph">${icon(g, 20)}${d.cur ? '<i class="on"></i>' : ""}</span>
    <span><span class="nm">${d.n}${d.cur ? "<em>это устройство</em>" : ""}</span><span class="sub2">${pn}${d.v ? ` · <span class="mono">${d.v}</span>` : ""} · ${d.seen}</span></span>
    ${d.cur ? "<span></span>" : '<button class="revoke" type="button">Отключить</button>'}</div>`;
}
$("#devs").innerHTML = DEVS.map(devRow).join("");
$("#oldList").innerHTML = OLD.map(devRow).join("") + `<button class="cleanall" type="button" id="cleanAll">Отключить все старые</button>`;
$("#oldBtn").addEventListener("click", () => $("#old").toggleAttribute("data-open"));
function revokeRow(row) {
  if (reduce()) return row.remove();
  row.style.height = `${row.offsetHeight}px`;
  row.classList.add("gone");
  row.addEventListener("animationend", () => { row.remove(); const left = $$("#oldList .dev").length; $("#oldLbl").textContent = `Старые входы · ${left}`; if (!left) $("#old").remove(); }, { once: true });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".revoke");
  if (b) {
    if (!b.dataset.arm) { b.dataset.arm = "1"; b.textContent = "Точно отключить?"; clearTimeout(b._t); b._t = setTimeout(() => { delete b.dataset.arm; b.textContent = "Отключить"; }, 3200); return; }
    return revokeRow(b.closest(".dev"));
  }
  if (e.target.closest("#cleanAll")) { $$("#oldList .dev").forEach((r, i) => setTimeout(() => revokeRow(r), i * 90)); }
});
$("#signout").addEventListener("click", (e) => toast("В макете не выходим — в приложении здесь вход"));

/* ── the code ───────────────────────────────────────────── */
const APK = "https://musixai.ru/download/musix.apk";
function drawQR() {
  if (!window.qrcode) return;
  const q = qrcode(0, "H"); q.addData(APK); q.make();
  const n = q.getModuleCount(), svg = $("#qrsvg");
  svg.setAttribute("viewBox", `-0.5 -0.5 ${n + 1} ${n + 1}`);
  const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const lo = Math.floor(n / 2) - 3, hi = Math.floor(n / 2) + 3, inLogo = (r, c) => r >= lo && r <= hi && c >= lo && c <= hi;
  let out = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!q.isDark(r, c) || finder(r, c) || inLogo(r, c)) continue;
    out += `<circle class="d" cx="${c + 0.5}" cy="${r + 0.5}" r=".43" fill="currentColor" data-r="${Math.hypot(r - n / 2, c - n / 2).toFixed(1)}"/>`;
  }
  for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    out += `<rect x="${c + 0.5}" y="${r + 0.5}" width="6" height="6" rx="1.9" fill="none" stroke="currentColor" stroke-width="1"/><rect x="${c + 2}" y="${r + 2}" width="3" height="3" rx="1" fill="currentColor"/>`;
  }
  const s = hi - lo + 1;
  out += `<rect x="${lo + 0.3}" y="${lo + 0.3}" width="${s - 0.6}" height="${s - 0.6}" rx="1.8" fill="#221c4a"/>`;
  [[0.9, 1.6], [2.1, 2.9], [3.3, 4.0], [4.5, 2.6], [5.7, 1.3]].forEach(([x, hgt]) => { out += `<rect x="${lo + x}" y="${lo + s / 2 - hgt / 2}" width=".55" height="${hgt}" rx=".27" fill="#b9a8ff"/>`; });
  svg.innerHTML = out;
}
drawQR();
let waved = 0;
$("#qr").addEventListener("pointerenter", () => {
  if (reduce() || Date.now() - waved < 1400) return; waved = Date.now();
  for (const d of $$("#qrsvg .d")) d.animate([{ transform: "scale(1)" }, { transform: "scale(.35)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }], { duration: 520, delay: +d.dataset.r * 26, easing: STD });
});
$("#qr").addEventListener("click", async () => {
  const q = $("#qr");
  try { await navigator.clipboard.writeText(APK); } catch {}
  q.dataset.copied = ""; setTimeout(() => delete q.dataset.copied, 1600);
});

/* ── the phone: tilts toward the pointer, like the player's cover ── */
const stagep = $("#stagep"), phone = $("#phone");
$("#pspec").innerHTML = [30, 52, 70, 88, 76, 64, 58, 72, 60, 48, 52, 40, 34, 44, 30, 22, 26, 18, 14, 10].map((h) => `<i style="--h:${h}"></i>`).join("");
let raf = 0;
/* the phone plays the listener's favourite song (/stats: listening.topTrack): its cover, its artist, its colour */
const FAVS = window.FAVS || [];
let fav = 0;
function setFav(i, animate) {
  const f = FAVS[i]; if (!f) return;
  const go = () => {
    $("#phoneCover").src = `img/${f.img}.jpg`; $("#phoneTitle").textContent = f.title; $("#phoneArtist").textContent = f.artist;
    $("#phoneBg").style.backgroundImage = $("#promoBg").style.backgroundImage = `url(img/${f.img}-bg.jpg)`;
    $("#s-settings").style.setProperty("--fav", f.pal.accent.dark);
  };
  if (!animate || reduce()) return go();
  const scr = $("#phone .pc");
  scr.animate([{ opacity: 1, filter: "blur(0)" }, { opacity: 0, filter: "blur(6px)" }], { duration: 200, easing: "cubic-bezier(.4,0,1,1)" }).onfinish = () => {
    go(); scr.animate([{ opacity: 0, filter: "blur(6px)", transform: "translateY(6px)" }, { opacity: 1, filter: "blur(0)", transform: "none" }], { duration: 420, easing: EMPH });
  };
  $("#promoBg").animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], { duration: 700, easing: STD });
}
setFav(0);
$("#favBtn").addEventListener("click", () => { fav = (fav + 1) % FAVS.length; setFav(fav, true); });
/* the banner folds into one line (and, in the app, starts folded once the account has an Android device) */
function fold(slim) {
  const p = $("#promo");
  if (!slim && !reduce()) setTimeout(phoneIn, 120);
  p.toggleAttribute("data-slim", slim);
}
$("#promoFold").addEventListener("click", () => fold(true));
$("#promoOpen").addEventListener("click", () => fold(false));
/* incognito: the mini player wears a mask and counts down */
let incT = 0;
function incognito(on) {
  const pill = $("#incog"); clearInterval(incT);
  if (!on) { if (!reduce()) pill.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.8)" }], { duration: 180, easing: "cubic-bezier(.4,0,1,1)" }).onfinish = () => (pill.hidden = true); else pill.hidden = true; return; }
  pill.hidden = false;
  if (!reduce()) pill.animate([{ opacity: 0, transform: "scale(.6) translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 520, easing: SPRING });
  let left = 6 * 3600;
  const paint = () => { $("#incogT").textContent = `${Math.floor(left / 3600)}:${String(Math.floor((left % 3600) / 60)).padStart(2, "0")}`; };
  paint(); incT = setInterval(() => { left -= 60; paint(); }, 60000);
}
stagep.addEventListener("pointermove", (e) => {
  if (reduce()) return;
  const r = stagep.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => { phone.classList.add("live"); phone.style.setProperty("--ry", `${-10 + x * 18}deg`); phone.style.setProperty("--rx", `${8 - y * 8}deg`); phone.style.setProperty("--gx", `${80 - x * 60}%`); phone.style.setProperty("--gl", ".16"); });
});
stagep.addEventListener("pointerleave", () => { phone.classList.remove("live"); for (const p of ["--ry", "--rx", "--gx", "--gl"]) phone.style.removeProperty(p); });
function phoneIn() {
  if (reduce()) return;
  const ps = getComputedStyle(phone).getPropertyValue("--ps").trim() || "1";
  phone.animate([{ transform: `translateY(90px) rotateY(-30deg) rotateX(18deg) rotateZ(-10deg) scale(${ps})`, opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: `rotateY(-14deg) rotateX(10deg) rotateZ(-6deg) scale(${ps})`, opacity: 1 }], { duration: 1000, easing: SPRING, delay: 150 });
  $("#qr").animate([{ transform: "translateY(24px) rotate(10deg) scale(.9)", opacity: 0 }, { transform: "rotate(3deg)", opacity: 1 }], { duration: 800, easing: SPRING, delay: 420, fill: "backwards" });
}
phoneIn();

/* ── toast ──────────────────────────────────────────────── */
function toast(text) {
  const t = document.createElement("div");
  t.className = "lg";
  t.style.cssText = "position:fixed;left:50%;bottom:104px;z-index:80;transform:translateX(-50%);padding:12px 18px;border-radius:999px;font:500 14px/1.2 var(--sans);white-space:nowrap";
  t.textContent = text; document.body.append(t);
  t.animate([{ opacity: 0, transform: "translate(-50%, 12px) scale(.94)" }, { opacity: 1, transform: "translate(-50%, 0)" }], { duration: 420, easing: SPRING });
  setTimeout(() => { t.animate([{ opacity: 1 }, { opacity: 0, transform: "translate(-50%, 8px) scale(.96)" }], { duration: 220, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).onfinish = () => t.remove(); }, 2600);
}
let ywin = null;
/*LIB*/
})();
