/* MusiX — the assistant page, round 1. Data: window.DATA (the frozen v1 snapshot of 2026-10-01,
   read-only, + six real turns run on the prod assistant 2026-10-23). EDIT (edit_block.js) holds
   the example texts the server does not write yet. */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function icon(name, size = 18) {
  const def = window.ICONS[name]; if (!def) return "";
  return `<svg class="ic" style="--s:${size}px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${def.w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${def.d.map((d, i) => `<path d="${d}"${def.fill.includes(i) ? ' fill="currentColor"' : ""}/>`).join("")}</svg>`;
}
const hydrate = (root = document) => { for (const el of $$("[data-ic]", root)) el.outerHTML = icon(el.dataset.ic, +(el.dataset.s || 18)); };
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
const img = (n) => (n ? `img/${n}.jpg` : "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Apple-style spring as a CSS linear() easing: damping ratio + response (s). */
function spring(damping = 0.85, response = 0.5) {
  const w0 = (2 * Math.PI) / response, z = damping, wd = w0 * Math.sqrt(Math.max(1e-6, 1 - z * z));
  const x = (t) => (z >= 1 ? 1 - Math.exp(-w0 * t) * (1 + w0 * t) : 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t)));
  const dur = Math.min(2.2, -Math.log(0.0015) / (z * w0));
  const pts = []; for (let i = 0; i <= 48; i++) pts.push(x((dur * i) / 48).toFixed(4));
  return { easing: `linear(${pts.join(",")})`, duration: Math.round(dur * 1000) };
}
const SPR = spring(0.86, 0.55), SPR_BOUNCE = spring(0.72, 0.5), SPR_SOFT = spring(1, 0.6);
const EXIT = "cubic-bezier(.4,0,1,1)", SWIFT = "cubic-bezier(.16,1,.3,1)";

const D = window.DATA, T = D.tracks, E = window.EDIT;
const S = { v: "b", size: "win", ideas: false, real: false };
try { Object.assign(S, JSON.parse(localStorage.getItem("mx-asst-mock2") || "{}")); } catch {}
const save = () => { try { localStorage.setItem("mx-asst-mock2", JSON.stringify(S)); } catch {} };
const app = $(".app"), page = $("#page"), inner = $("#inner"), stage = $("#stage");
let toastT;
function toast(text) { const t = $("#toast"); t.textContent = text; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600); }

const KIND = {
  lyrics_search: { c: "#6ac8ff", label: "По тексту", c1: [0.42, 0.78, 1.0], c2: [0.3, 0.46, 1.0] },
  audio_search: { c: "#b48cff", label: "По звуку", c1: [0.72, 0.55, 1.0], c2: [0.45, 0.33, 1.0] },
  playlist: { c: "#ffb35c", label: "Подборка", c1: [1.0, 0.7, 0.36], c2: [1.0, 0.42, 0.66] },
  general: { c: "#5ee6c8", label: "Ответ", c1: [0.37, 0.9, 0.78], c2: [0.22, 0.62, 0.9] },
  idle: { c: "#b9b4ff", c1: [0.82, 0.82, 1.0], c2: [0.52, 0.45, 1.0] },
  think: { c: "#cfd5ff", c1: [0.93, 0.95, 1.0], c2: [0.6, 0.68, 1.0] },
  fail: { c: "#e0607e", c1: [0.88, 0.38, 0.49], c2: [0.6, 0.24, 0.34] },
};

/* ── layout: one composition, measured for the window or a 14/16/32″ screen ── */
const L = {};
function layout() {
  const W = page.clientWidth, H = page.clientHeight, big = W >= 2200;
  const R = Math.round(clamp(Math.min(H * 0.15, W * 0.095), 84, 210));
  const cardH = big ? 196 : H < 760 ? 148 : 170, rowW = Math.min(W - 92 - 120, big ? 1760 : 1560), gapC = 14;
  const nCards = Math.max(2, Math.floor((rowW + gapC) / ((big ? 330 : 272) + gapC)));
  const G = 2 * R + 34 + 56 + 44 + 46 + cardH, top = Math.max(26, Math.round((H - G) / 2));
  const cx = Math.round((W + 92) / 2), cy = top + R, fieldTop = cy + R + 34, feedTop = fieldTop + 56 + 44;
  const heroH = H;
  const ob = Math.round(R * 3.2), dpr = Math.min(devicePixelRatio || 1, 1.75);
  const rx = Math.min(R * 2.55, (W - 92) / 2 - 230), ry = R * 0.8;
  const ansW = Math.min(cqw(W) >= 2200 ? 1060 : 920, W - 200);
  Object.assign(L, { W, H, R, cx, cy, heroH, ob, dpr, rx, ry, ansW, ansL: Math.round(cx - ansW / 2), fieldTop, feedTop, cardH, rowW, nCards });
  app.style.setProperty("--hero-h", heroH + "px");
  $(".room").style.setProperty("--oy", cy + "px");
  const box = $("#orbbox");
  Object.assign(box.style, { left: cx - ob / 2 + "px", top: cy - ob / 2 + "px", width: ob + "px", height: ob + "px" });
  const cv = $("#orbgl"); cv.width = Math.round(ob * dpr); cv.height = Math.round(ob * dpr);
  bgc.width = Math.round(ob * dpr * 0.5); bgc.height = Math.round(ob * dpr * 0.5);
  const sq = (el, d) => Object.assign(el.style, { left: (ob - d) / 2 + "px", top: (ob - d) / 2 + "px", width: d + "px", height: d + "px" });
  sq($("#orbhit"), 2 * R); sq($("#inside"), 2 * R * 0.92); sq($("#v1orb"), 2 * R);
  $("#v1orb").style.setProperty("--sz", 2 * R + "px");
  $("#capt").style.top = cy + R + 20 + "px";
  L.aw = Math.round(clamp(R * 3.7, 440, 620));
  L.chipF = +clamp(R * 0.095, 14.5, 18.5).toFixed(1); app.style.setProperty("--chip-f", L.chipF + "px");
  L.ph = L.aw < 520 ? "Строчка, настроение или вопрос…" : "Строчка из песни, настроение или вопрос…";
  $("#ask").style.marginLeft = "0";
  $("#capt").style.left = cx + "px";
  if ($("#ask").dataset.mode !== "away") placeAsk($("#ask").dataset.mode || "idle", false);
  $("#answer").style.width = ansW + "px"; $("#answer").style.marginLeft = L.ansL + "px";
  Object.assign($("#feed").style, { left: cx - rowW / 2 + "px", width: rowW + "px", top: feedTop + "px" });
  app.style.setProperty("--card-h", cardH + "px"); app.style.setProperty("--cards", nCards);
  if (nCards !== L.shownCards) { L.shownCards = nCards; if (typeof renderCards === "function") renderCards(false); }
  app.classList.toggle("fits", G <= H);
  if (!app.classList.contains("answering")) inner.style.minHeight = H + "px";
  placeSky(); measureChips();
  if (app.classList.contains("answering")) dockOrb(false);
}
const cqw = (W) => W;
const scaleK = () => (S.size === "win" ? 1 : +getComputedStyle(app).getPropertyValue("--k") || 1);

/* ── the orb ─────────────────────────────────────────────────────────────── */
const bgc = document.createElement("canvas"), bgx = bgc.getContext("2d");
const draw = Orb.make($("#orbgl"), bgc);
const O = { t: 0, e: 0.15, eT: 0.15, c1: [...KIND.idle.c1], c2: [...KIND.idle.c2], k1: KIND.idle.c1, k2: KIND.idle.c2,
  lean: [0, 0], leanT: [0, 0], rip: 9, pulse: 0, dim: 0, dimT: 0, preview: null };
function setKind(k) {
  app.dataset.k = k;
  for (const i of $$(".room i")) i.classList.toggle("on", i.dataset.n === k);
  O.k1 = KIND[k].c1; O.k2 = KIND[k].c2;
}
const ripple = () => { O.rip = 0; };
const pulse = (v = 0.5) => { O.pulse = Math.min(1.2, O.pulse + v); };

/* v1's sphere (variant А): four drops drift under a glass cap, the ring turns; WAAPI rates follow the energy */
const V1 = (() => {
  const el = $("#v1orb");
  const K = [
    [{ transform: "translate(-18%,-12%) scale(1)" }, { transform: "translate(22%,16%) scale(1.25)" }, { transform: "translate(-18%,-12%) scale(1)" }],
    [{ transform: "translate(20%,18%) scale(1.1)" }, { transform: "translate(-16%,-10%) scale(.9)" }, { transform: "translate(20%,18%) scale(1.1)" }],
    [{ transform: "translate(6%,22%) scale(.9)" }, { transform: "translate(-22%,-16%) scale(1.2)" }, { transform: "translate(6%,22%) scale(.9)" }],
    [{ transform: "translate(20%,18%) scale(1.1)" }, { transform: "translate(-16%,-10%) scale(.9)" }, { transform: "translate(20%,18%) scale(1.1)" }],
  ];
  const drops = $$(".blob", el).map((b, i) => b.animate(K[i], { duration: [8000, 10000, 12000, 9000][i], iterations: Infinity, easing: "ease-in-out", direction: i === 3 ? "reverse" : "normal" }));
  const ring = $(".ring", el).animate([{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }], { duration: 7000, iterations: Infinity });
  const bob = el.animate([{ translate: "0 0" }, { translate: "0 -7px" }, { translate: "0 0" }], { duration: 4500, iterations: Infinity, easing: "ease-in-out" });
  let last = -1;
  return (e) => { const r = Math.round((1 + e * 3) * 20) / 20; if (r === last) return; last = r; drops.forEach((a) => a.updatePlaybackRate(r)); ring.updatePlaybackRate(1 + e * 2.5); bob.updatePlaybackRate(1 + e); };
})();

/* ── the orbit ───────────────────────────────────────────────────────────── */
const PICK = [0, 2, 3, 4, 6, 7, 8, 10];
const chips = PICK.map((i) => D.orbit[i]).filter(Boolean).map((o, i, all) => {
  const el = document.createElement("button");
  el.type = "button"; el.className = "chip";
  el.style.setProperty("--c", KIND[o.intent].c);
  el.innerHTML = `<i></i>${esc(o.q)}`;
  stage.append(el);
  const c = { o, el, a0: (i / all.length) * Math.PI * 2 + 0.35, w: 0, h: 0, x: 0, y: 0, depth: 0, op: 1, s: 1, vis: 1, gone: false };
  el.addEventListener("pointerenter", () => { orbit.hover = c; O.preview = o.intent; });
  el.addEventListener("pointerleave", () => { if (orbit.hover === c) { orbit.hover = null; O.preview = null; } });
  el.addEventListener("click", () => ask(o.q, { item: o, chip: c }));
  return c;
});
const orbit = { a: 0, rate: 1, hover: null, shown: true, tilt: 0, tiltT: 0, px: 0, pxT: 0 };
function measureChips() { for (const c of chips) { c.w = c.el.offsetWidth; c.h = c.el.offsetHeight; } }
function placeChips(dt) {
  orbit.rate += ((orbit.hover ? 0 : 1) - orbit.rate) * (1 - Math.exp(-dt * 4));
  orbit.a += dt * orbit.rate * ((Math.PI * 2) / 150);
  orbit.tilt += (orbit.tiltT - orbit.tilt) * (1 - Math.exp(-dt * 3)); orbit.px += (orbit.pxT - orbit.px) * (1 - Math.exp(-dt * 3));
  for (const c of chips) {
    if (c.gone) continue;
    const a = c.a0 + orbit.a, d = Math.sin(a);
    c.depth = d;
    c.x = L.cx + Math.cos(a) * L.rx + orbit.px * (0.6 + 0.4 * d);
    c.y = L.cy + d * L.ry * (1 + orbit.tilt);
    c.s = 0.86 + 0.14 * (d + 1) / 2; c.op = 0.5 + 0.5 * (d + 1) / 2;
  }
  // where two questions cross, the one further back goes into the shade of the nearer one
  const live = chips.filter((c) => !c.gone);
  for (const c of live) c.occl = false;
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    if ((a.w * a.s + b.w * b.s) / 2 + 10 - Math.abs(a.x - b.x) > 0 && (a.h * a.s + b.h * b.s) / 2 - 6 - Math.abs(a.y - b.y) > 0) (a.depth < b.depth ? a : b).occl = true;
  }
  for (const c of live) {
    if (orbit.hover === c) c.occl = false;
    c.vis += ((c.occl ? 0.1 : 1) - c.vis) * (1 - Math.exp(-dt * 7));
    c.el.classList.toggle("front", c.depth > 0);
    c.el.style.pointerEvents = c.vis < 0.4 ? "none" : "";
    c.el.style.transform = `translate(${(c.x - c.w / 2).toFixed(1)}px,${(c.y - c.h / 2).toFixed(1)}px) scale(${c.s.toFixed(3)})`;
    c.el.style.opacity = (c.op * c.vis).toFixed(3);
  }
}

/* the room behind the ball, painted for the refraction: its light, the stars, the questions behind it */
function paintBg() {
  const w = bgc.width, h = bgc.height, k = w / L.ob, ox = L.cx - L.ob / 2, oy = L.cy - L.ob / 2;
  bgx.fillStyle = "#0b0b10"; bgx.fillRect(0, 0, w, h);
  const c = O.c1.map((v) => Math.round(v * 255)), g = bgx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.55);
  g.addColorStop(0, `rgba(${c},.34)`); g.addColorStop(0.5, `rgba(${c},.12)`); g.addColorStop(1, "rgba(0,0,0,0)");
  bgx.fillStyle = g; bgx.fillRect(0, 0, w, h);
  const top = bgx.createLinearGradient(0, 0, 0, h); top.addColorStop(0, "rgba(255,255,255,.05)"); top.addColorStop(0.5, "rgba(0,0,0,0)");
  bgx.fillStyle = top; bgx.fillRect(0, 0, w, h);
  if (app.classList.contains("answering") || app.classList.contains("working")) return;
  bgx.textBaseline = "middle";
  for (const c2 of chips) {
    if (c2.gone || c2.depth > 0.05) continue;
    const x = (c2.x - ox) * k, y = (c2.y - oy) * k;
    if (x < -w * 0.5 || x > w * 1.5) continue;
    bgx.globalAlpha = c2.op * c2.vis * 0.95;
    bgx.font = `400 ${L.chipF * c2.s * k}px Geist, system-ui, sans-serif`;
    const tw = bgx.measureText(c2.o.q).width, x0 = x - tw / 2;
    bgx.fillStyle = KIND[c2.o.intent].c; bgx.beginPath(); bgx.arc(x0 - 10 * k, y, 3.5 * k, 0, 7); bgx.fill();
    bgx.fillStyle = "#f2f2f7"; bgx.fillText(c2.o.q, x0, y);
  }
  bgx.globalAlpha = 1;
}

/* ── the sky: a star per question asked before ───────────────────────────── */
const sky = D.sky.map((s) => ({ ...s }));
function placeSky() {
  const box = $("#sky"); box.innerHTML = "";
  for (const s of sky) {
    let x, y, n = 0;
    do {
      x = 120 + hash(s.q + n) * (L.W - 180); y = 24 + hash(n + s.q + "y") * (L.fieldTop - 50); n++;
    } while (n < 40 && (((x - L.cx) / (L.rx + 240)) ** 2 + ((y - L.cy) / (L.R * 1.6)) ** 2 < 1 || y > L.fieldTop - 20));
    const el = document.createElement("div");
    el.className = "star" + (s.born ? " born" : ""); s.born = false;
    el.style.cssText = `left:${x}px;top:${y}px;--c:${KIND[s.intent].c};--d:${(2 + hash(s.q + "d") * 2.4).toFixed(1)}px;--o:${(0.35 + hash(s.q + "o") * 0.4).toFixed(2)}`;
    el.innerHTML = `<span class="lg">${esc(s.q)}</span>`;
    box.append(el);
  }
}
