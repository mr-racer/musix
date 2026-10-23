/* The assistant page («ИИ»): the one surface for talking to the AI (design/code/roadmap.md, stage 5;
   the owner's brief and his three rounds of fixes are in design/code/preferences.md, 2026-10-23;
   the approved mock is design/reference/assistant, «Хрусталь»). One room around one object: the
   orb in the middle, the questions on a tilted orbit around it, the field under it, the row of
   hooks below. A request turns the room the colour of what was understood; the answer grows out
   of the orb, which then sits by the answer as its speaker.

   The page is a per-frame machine (a WebGL ball that refracts the room, chips placed every frame,
   covers flying between places), so it is ported as the mock's imperative engine: React only
   mounts it (routes/_app/assistant.tsx). The data is the server's: `GET /assistant/home` (built
   without an LLM, every item carries the `hint` the turn echoes back), `POST /assistant/turns`,
   progress over the socket (`assistant.stage`, the server's own words) and the result of
   `GET /assistant/turns/{id}`.

   What the port changed for resources, with the picture kept: the loop stops when the page is
   left and draws nothing while the orb is scrolled away; the docked orb renders at the size it is
   seen; the room behind the ball is repainted and uploaded only when it changed; per-frame style
   writes happen only when a value moved; the chips' glass blur exists only under the pointer
   (assistant.css); the GPU context is given back on leave. */
import { api, ApiError, ok, type Schemas } from "../api/client";
import { db } from "../api/db";
import { addToPlaylist, createPlaylist } from "../api/playlists";
import { subscribe } from "../api/realtime";
import { imageUrl, remember, warmFromMirror } from "../lib/images";
import { fromTrack, player } from "../player/engine";
import glass from "../ui/glass.module.css";
import { iconSvg, type IconName } from "../ui/icons";
import { toast } from "../ui/toast";
import { makeOrb } from "./orb";
import "./assistant.css";

/* eslint-disable @typescript-eslint/no-explicit-any -- v1's payload shapes are untyped dicts */
type R = Record<string, any>;
type Track = Schemas["TrackOut"];
type Kind = "lyrics_search" | "audio_search" | "playlist" | "general" | "idle" | "think" | "fail";
type Item = { q: string; intent: Kind; hint?: R | null; [k: string]: any };

export interface AssistantDeps {
  openArtist: (id: string) => void;
  initial?: string; // a question to ask on arrival
}

const KIND: Record<Kind, { c: string; label: string; c1: number[]; c2: number[] }> = {
  lyrics_search: { c: "#6ac8ff", label: "По тексту", c1: [0.42, 0.78, 1.0], c2: [0.3, 0.46, 1.0] },
  audio_search: { c: "#b48cff", label: "По звуку", c1: [0.72, 0.55, 1.0], c2: [0.45, 0.33, 1.0] },
  playlist: { c: "#ffb35c", label: "Подборка", c1: [1.0, 0.7, 0.36], c2: [1.0, 0.42, 0.66] },
  general: { c: "#5ee6c8", label: "Ответ", c1: [0.37, 0.9, 0.78], c2: [0.22, 0.62, 0.9] },
  idle: { c: "#b9b4ff", label: "", c1: [0.82, 0.82, 1.0], c2: [0.52, 0.45, 1.0] },
  think: { c: "#cfd5ff", label: "", c1: [0.93, 0.95, 1.0], c2: [0.6, 0.68, 1.0] },
  fail: { c: "#e0607e", label: "Не вышло", c1: [0.88, 0.38, 0.49], c2: [0.6, 0.24, 0.34] },
};
const kindOf = (k: unknown): Kind => (typeof k === "string" && k in KIND ? (k as Kind) : "general");

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const icon = (n: IconName, s = 18) => iconSvg(n, s);
const plural = (n: number, a: string, b: string, c: string) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const hash = (s: unknown) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
const mix = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i]! - v) * k);
const dur = (ms: number | null | undefined) => { const s = Math.round((ms ?? 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const G = `lg ${glass.lg}`; // the one glass recipe (ui/glass.module.css); `lg` keeps the page's own .btn.lg rules

/** Apple-style spring as a CSS linear() easing: damping ratio + response (s). */
function spring(damping = 0.85, response = 0.5) {
  const w0 = (2 * Math.PI) / response, z = damping, wd = w0 * Math.sqrt(Math.max(1e-6, 1 - z * z));
  const x = (t: number) => (z >= 1 ? 1 - Math.exp(-w0 * t) * (1 + w0 * t) : 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t)));
  const d = Math.min(2.2, -Math.log(0.0015) / (z * w0));
  const pts = []; for (let i = 0; i <= 48; i++) pts.push(x((d * i) / 48).toFixed(4));
  return { easing: `linear(${pts.join(",")})`, duration: Math.round(d * 1000) };
}
const SPR = spring(0.86, 0.55), SPR_BOUNCE = spring(0.72, 0.5);
const EXIT = "cubic-bezier(.4,0,1,1)", SWIFT = "cubic-bezier(.16,1,.3,1)";

const MARKUP = `<div class="mx-asst" data-k="idle">
  <main class="page"><div class="inner">
    <div class="room" aria-hidden="true">${(["idle", "think", "lyrics_search", "audio_search", "playlist", "general", "fail"] as const).map((n) => `<i data-n="${n}"${n === "idle" ? ' class="on"' : ""}></i>`).join("")}</div>
    <div class="sky"></div>
    <section class="stage">
      <div class="orbbox">
        <canvas></canvas>
        <div class="v1orb"><div class="ring"></div><div class="ball"><span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span><span class="blob b4"></span></div><div class="cap"></div></div>
        <div class="inside"></div>
        <div class="dust"></div>
        <div class="orbhit"></div>
      </div>
      <div class="capt" aria-live="polite"></div>
      <div class="echo"></div>
      <div class="split"></div>
      <form class="ask ${G}" autocomplete="off"><input name="q" placeholder="Строчка из песни, настроение или вопрос…" aria-label="Запрос ассистенту" spellcheck="false"><button class="go" type="submit" aria-label="Спросить"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg></button></form>
    </section>
    <section class="answer" aria-live="polite"></section>
    <section class="feed"></section>
  </div></main>
</div>`;

export function mountAssistant(host: HTMLElement, deps: AssistantDeps): () => void {
  host.innerHTML = MARKUP;
  const $ = <E extends Element = HTMLElement>(s: string, r: ParentNode = host) => r.querySelector(s) as E;
  const $$ = <E extends Element = HTMLElement>(s: string, r: ParentNode = host) => [...r.querySelectorAll(s)] as E[];
  const app = $(".mx-asst"), page = $(".page"), inner = $(".inner"), stage = $(".stage");
  const box = $(".orbbox"), cv = $<HTMLCanvasElement>("canvas", box), field = $<HTMLFormElement>(".ask"), input = $<HTMLInputElement>("input", field);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let dead = false;
  const cleanups: (() => void)[] = [];
  const on = (el: EventTarget, ev: string, fn: (e: any) => void) => { el.addEventListener(ev, fn); cleanups.push(() => el.removeEventListener(ev, fn)); };

  const T = new Map<string, Track>(); // every track an answer named
  const cover = (id: string | null | undefined, px: number) => imageUrl(id, px * Math.min(2, devicePixelRatio || 1)) ?? "";

  /* ── layout: one composition, measured on the window ─────────────────────── */
  const L = {} as { W: number; H: number; R: number; cx: number; cy: number; ob: number; dpr: number; rx: number; ry: number; ansW: number; ansL: number;
    fieldTop: number; feedTop: number; cardH: number; rowW: number; nCards: number; shownCards?: number; aw: number; chipF: number; ph: string; isl: number; res: number };
  L.res = 1;
  const bgc = document.createElement("canvas"), bgx = bgc.getContext("2d")!;
  function sizeCanvas() {
    cv.width = Math.round(L.ob * L.dpr * L.res); cv.height = cv.width;
    bgc.width = Math.round(cv.width * 0.5); bgc.height = bgc.width; bgDirty = true;
  }
  function layout() {
    if (dead) return;
    const isl = matchMedia("(max-width: 760px)").matches ? 0 : 92;
    // until the server has answered, the row of cards is reserved: the orb stands where it will stay
    const W = page.clientWidth, H = page.clientHeight, big = W >= 2200, hasFeed = !homeLoaded || cards.length > 0;
    const R = Math.round(clamp(Math.min(H * 0.15, W * 0.095), 84, 210));
    const cardH = big ? 196 : H < 760 ? 148 : 170, rowW = Math.max(240, Math.min(W - isl - 120, big ? 1760 : 1560)), gapC = 14;
    const nCards = Math.max(2, Math.floor((rowW + gapC) / ((big ? 330 : 272) + gapC)));
    const Gh = 2 * R + 34 + 56 + (hasFeed ? 44 + 46 + cardH : 0), top = Math.max(26, Math.round((H - Gh) / 2));
    const cx = Math.round((W + isl) / 2), cy = top + R, fieldTop = cy + R + 34, feedTop = fieldTop + 56 + 44;
    const ob = Math.round(R * 3.2), dpr = Math.min(devicePixelRatio || 1, 1.75);
    const rx = Math.max(R * 1.4, Math.min(R * 2.55, (W - isl) / 2 - 230)), ry = R * 0.8;
    const ansW = Math.min(W >= 2200 ? 1060 : 920, W - isl - 108);
    Object.assign(L, { W, H, R, cx, cy, ob, dpr, rx, ry, ansW, ansL: Math.round(cx - ansW / 2), fieldTop, feedTop, cardH, rowW, nCards, isl });
    app.style.setProperty("--hero-h", H + "px");
    $(".room").style.setProperty("--oy", cy + "px");
    Object.assign(box.style, { left: cx - ob / 2 + "px", top: cy - ob / 2 + "px", width: ob + "px", height: ob + "px" });
    sizeCanvas();
    const sq = (el: HTMLElement, d: number) => Object.assign(el.style, { left: (ob - d) / 2 + "px", top: (ob - d) / 2 + "px", width: d + "px", height: d + "px" });
    sq($(".orbhit"), 2 * R); sq($(".inside"), 2 * R * 0.92); sq($(".v1orb"), 2 * R);
    $(".v1orb").style.setProperty("--sz", 2 * R + "px");
    $(".capt").style.top = cy + R + 20 + "px";
    L.aw = Math.round(clamp(R * 3.7, 440, Math.min(620, W - isl - 48)));
    L.chipF = +clamp(R * 0.095, 14.5, 18.5).toFixed(1); app.style.setProperty("--chip-f", L.chipF + "px");
    L.ph = L.aw < 520 ? "Строчка, настроение или вопрос…" : "Строчка из песни, настроение или вопрос…";
    $(".capt").style.left = cx + "px";
    if (field.dataset.mode !== "away") placeAsk(field.dataset.mode || "idle", false);
    const ans = $(".answer"); ans.style.width = ansW + "px"; ans.style.marginLeft = L.ansL + "px";
    Object.assign($(".feed").style, { left: cx - rowW / 2 + "px", width: rowW + "px", top: feedTop + "px" });
    app.style.setProperty("--card-h", cardH + "px"); app.style.setProperty("--cards", String(nCards));
    if (nCards !== L.shownCards) { L.shownCards = nCards; renderCards(false); }
    app.classList.toggle("fits", Gh <= H);
    if (!app.classList.contains("answering")) inner.style.minHeight = H + "px";
    placeSky(); measureChips();
    if (app.classList.contains("answering")) dockOrb(false);
  }

  /* ── the orb ─────────────────────────────────────────────────────────────── */
  const orb = makeOrb(cv, bgc);
  app.classList.toggle("nogl", !orb);
  const O = { t: 0, e: 0.15, eT: 0.15, c1: [...KIND.idle.c1], c2: [...KIND.idle.c2], k1: KIND.idle.c1, k2: KIND.idle.c2,
    lean: [0, 0], leanT: [0, 0], rip: 9, pulse: 0, dim: 0, dimT: 0, preview: null as Kind | null };
  let bgDirty = true, bgSig = "";
  function setKind(k: Kind) {
    app.dataset.k = k;
    for (const i of $$(".room i")) i.classList.toggle("on", i.dataset.n === k);
    O.k1 = KIND[k].c1; O.k2 = KIND[k].c2;
  }
  const pulse = (v = 0.5) => { O.pulse = Math.min(1.2, O.pulse + v); };

  /* v1's sphere, the fallback where WebGL is missing: four drops drift under a glass cap, the ring turns */
  const V1 = (() => {
    if (orb) return null;
    const el = $(".v1orb");
    const K = [
      [{ transform: "translate(-18%,-12%) scale(1)" }, { transform: "translate(22%,16%) scale(1.25)" }, { transform: "translate(-18%,-12%) scale(1)" }],
      [{ transform: "translate(20%,18%) scale(1.1)" }, { transform: "translate(-16%,-10%) scale(.9)" }, { transform: "translate(20%,18%) scale(1.1)" }],
      [{ transform: "translate(6%,22%) scale(.9)" }, { transform: "translate(-22%,-16%) scale(1.2)" }, { transform: "translate(6%,22%) scale(.9)" }],
      [{ transform: "translate(20%,18%) scale(1.1)" }, { transform: "translate(-16%,-10%) scale(.9)" }, { transform: "translate(20%,18%) scale(1.1)" }],
    ];
    const drops = $$(".blob", el).map((b, i) => b.animate(K[i]!, { duration: [8000, 10000, 12000, 9000][i], iterations: Infinity, easing: "ease-in-out", direction: i === 3 ? "reverse" : "normal" }));
    const ring = $(".ring", el).animate([{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }], { duration: 7000, iterations: Infinity });
    const bob = el.animate([{ translate: "0 0" }, { translate: "0 -7px" }, { translate: "0 0" }], { duration: 4500, iterations: Infinity, easing: "ease-in-out" });
    let last = -1;
    return (e: number) => { const r = Math.round((1 + e * 3) * 20) / 20; if (r === last) return; last = r; drops.forEach((a) => a.updatePlaybackRate(r)); ring.updatePlaybackRate(1 + e * 2.5); bob.updatePlaybackRate(1 + e); };
  })();

  /* ── the orbit: the listener's own questions (the server builds them by heuristics, no LLM) ── */
  type Chip = { o: Item; el: HTMLButtonElement; a0: number; w: number; h: number; x: number; y: number; depth: number; op: number; s: number; vis: number; gone: boolean; occl?: boolean; tf?: string; opS?: string; front?: boolean; pe?: boolean };
  let chips: Chip[] = [];
  const orbit = { a: 0, rate: 1, hover: null as Chip | null, shown: true, tilt: 0, tiltT: 0, px: 0, pxT: 0 };
  function buildChips(items: Item[]) {
    for (const c of chips) c.el.remove();
    chips = items.map((o, i, all) => {
      const el = document.createElement("button");
      el.type = "button"; el.className = "chip";
      el.style.setProperty("--c", KIND[kindOf(o.intent)].c);
      el.innerHTML = `<i></i>${esc(o.q)}`;
      stage.append(el);
      const c: Chip = { o, el, a0: (i / all.length) * Math.PI * 2 + 0.35, w: 0, h: 0, x: 0, y: 0, depth: 0, op: 1, s: 1, vis: 1, gone: false };
      el.addEventListener("pointerenter", () => { orbit.hover = c; O.preview = kindOf(o.intent); });
      el.addEventListener("pointerleave", () => { if (orbit.hover === c) { orbit.hover = null; O.preview = null; } });
      el.addEventListener("click", () => void ask(o.q, { item: o, chip: c }));
      return c;
    });
    measureChips();
  }
  function measureChips() { for (const c of chips) { c.w = c.el.offsetWidth; c.h = c.el.offsetHeight; } }
  function placeChips(dt: number) {
    orbit.rate += ((orbit.hover || reduce ? 0 : 1) - orbit.rate) * (1 - Math.exp(-dt * 4));
    orbit.a += dt * orbit.rate * ((Math.PI * 2) / 150);
    orbit.tilt += (orbit.tiltT - orbit.tilt) * (1 - Math.exp(-dt * 3)); orbit.px += (orbit.pxT - orbit.px) * (1 - Math.exp(-dt * 3));
    for (const c of chips) {
      if (c.gone) continue;
      const a = c.a0 + orbit.a, d = Math.sin(a);
      c.depth = d;
      c.x = L.cx + Math.cos(a) * L.rx + orbit.px * (0.6 + 0.4 * d);
      c.y = L.cy + d * L.ry * (1 + orbit.tilt);
      c.s = 0.86 + (0.14 * (d + 1)) / 2; c.op = 0.5 + (0.5 * (d + 1)) / 2;
    }
    // where two questions cross, the one further back goes into the shade of the nearer one
    const live = chips.filter((c) => !c.gone);
    for (const c of live) c.occl = false;
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!, b = live[j]!;
      if ((a.w * a.s + b.w * b.s) / 2 + 10 - Math.abs(a.x - b.x) > 0 && (a.h * a.s + b.h * b.s) / 2 - 6 - Math.abs(a.y - b.y) > 0) (a.depth < b.depth ? a : b).occl = true;
    }
    for (const c of live) {
      if (orbit.hover === c) c.occl = false;
      c.vis += ((c.occl ? 0.1 : 1) - c.vis) * (1 - Math.exp(-dt * 7));
      const front = c.depth > 0;
      if (front !== c.front) { c.front = front; c.el.classList.toggle("front", front); }
      const pe = c.vis < 0.4;
      if (pe !== c.pe) { c.pe = pe; c.el.style.pointerEvents = pe ? "none" : ""; }
      const tf = `translate(${(c.x - c.w / 2).toFixed(1)}px,${(c.y - c.h / 2).toFixed(1)}px) scale(${c.s.toFixed(3)})`, op = (c.op * c.vis).toFixed(3);
      if (tf !== c.tf) { c.tf = tf; c.el.style.transform = tf; }
      if (op !== c.opS) { c.opS = op; c.el.style.opacity = op; }
    }
  }
  const forget = (c: Chip) => { c.tf = undefined; c.opS = undefined; c.pe = undefined; };

  /* the room behind the ball, painted for the refraction: its light and the questions behind it */
  function paintBg() {
    const quiet = app.classList.contains("answering") || app.classList.contains("working");
    // with the orbit gone the room only changes with its colour: no repaint, no upload, while it holds
    const sig = quiet ? O.c1.map((v) => v.toFixed(3)).join() + bgc.width : "";
    if (quiet && sig === bgSig && !bgDirty) return false;
    bgSig = sig; bgDirty = false;
    const w = bgc.width, h = bgc.height, k = w / L.ob, ox = L.cx - L.ob / 2, oy = L.cy - L.ob / 2;
    bgx.fillStyle = "#0b0b10"; bgx.fillRect(0, 0, w, h);
    const c = O.c1.map((v) => Math.round(v * 255)), g = bgx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.55);
    g.addColorStop(0, `rgba(${c},.34)`); g.addColorStop(0.5, `rgba(${c},.12)`); g.addColorStop(1, "rgba(0,0,0,0)");
    bgx.fillStyle = g; bgx.fillRect(0, 0, w, h);
    const top = bgx.createLinearGradient(0, 0, 0, h); top.addColorStop(0, "rgba(255,255,255,.05)"); top.addColorStop(0.5, "rgba(0,0,0,0)");
    bgx.fillStyle = top; bgx.fillRect(0, 0, w, h);
    if (quiet) return true;
    bgx.textBaseline = "middle";
    for (const c2 of chips) {
      if (c2.gone || c2.depth > 0.05) continue;
      const x = (c2.x - ox) * k, y = (c2.y - oy) * k;
      if (x < -w * 0.5 || x > w * 1.5) continue;
      bgx.globalAlpha = c2.op * c2.vis * 0.95;
      bgx.font = `400 ${L.chipF * c2.s * k}px Geist, system-ui, sans-serif`;
      const tw = bgx.measureText(c2.o.q).width, x0 = x - tw / 2;
      bgx.fillStyle = KIND[kindOf(c2.o.intent)].c; bgx.beginPath(); bgx.arc(x0 - 10 * k, y, 3.5 * k, 0, 7); bgx.fill();
      bgx.fillStyle = "#f2f2f7"; bgx.fillText(c2.o.q, x0, y);
    }
    bgx.globalAlpha = 1;
    return true;
  }

  /* ── the sky: a star per question asked before ───────────────────────────── */
  let sky: { q: string; intent: Kind; born?: boolean }[] = [];
  function placeSky() {
    const el = $(".sky"); el.innerHTML = "";
    for (const s of sky) {
      let x = 0, y = 0, n = 0;
      do {
        x = L.isl + 28 + hash(s.q + n) * (L.W - L.isl - 88); y = 24 + hash(n + s.q + "y") * (L.fieldTop - 50); n++;
      } while (n < 40 && (((x - L.cx) / (L.rx + 240)) ** 2 + ((y - L.cy) / (L.R * 1.6)) ** 2 < 1 || y > L.fieldTop - 20));
      const st = document.createElement("button");
      st.type = "button"; st.className = "star" + (s.born ? " born" : ""); s.born = false;
      st.style.cssText = `left:${x}px;top:${y}px;--c:${KIND[s.intent].c};--d:${(2 + hash(s.q + "d") * 2.4).toFixed(1)}px;--o:${(0.35 + hash(s.q + "o") * 0.4).toFixed(2)}`;
      st.innerHTML = `<span class="${G}">${esc(s.q)}</span>`;
      st.setAttribute("aria-label", s.q);
      st.addEventListener("click", () => void ask(s.q));
      el.append(st);
    }
  }

  /* ── one turn ────────────────────────────────────────────────────────────── */
  type Opts = { item?: Item | null; chip?: Chip; intent?: Kind; subjectTrackId?: string; subjectArtistSlug?: string; follow?: boolean };
  let busy = false, run = 0, last: { q: string; r: R; text: string } | null = null;
  // frames that arrive before the POST has answered with the turn's id wait here
  const early: { turnId: string; e: any }[] = [];
  let listen: ((e: any) => void) | null = null;
  cleanups.push(subscribe((e) => {
    if (e.type !== "assistant.stage" && e.type !== "assistant.done") return;
    if (listen) listen(e); else if (busy) early.push({ turnId: e.turnId, e });
  }));

  async function ask(text: string, opts: Opts = {}) {
    text = String(text || "").trim();
    if (!text || busy || dead) return;
    if (app.classList.contains("answering")) await reset(true);
    busy = true; const my = ++run; early.length = 0;
    const t0 = performance.now();
    page.scrollTo({ top: 0, behavior: "smooth" });
    input.value = ""; field.classList.remove("has"); input.blur(); placeAsk("away");
    app.classList.add("working"); setKind("think"); O.eT = 0.6;
    hideOrbit(opts.chip);
    showEcho(text);
    if (opts.chip) { await sleep(520); pulse(0.7); } else pulse(0.5);
    caption("Разбираю запрос", true);
    const follow = opts.follow && last;
    const body: R = {
      message: text, lang: "ru", limit: 15,
      ...(opts.item?.hint ? { hint: opts.item.hint } : {}),
      ...(opts.intent ? { intent: opts.intent } : {}),
      ...(opts.subjectTrackId ? { subjectTrackId: opts.subjectTrackId } : {}),
      ...(opts.subjectArtistSlug ? { subjectArtistSlug: opts.subjectArtistSlug } : {}),
      ...(follow ? { slots: last!.r.slots ?? {}, contextId: last!.r.context_id ?? null,
        history: [{ role: "user", content: last!.q }, { role: "assistant", content: last!.text.slice(0, 4000) }] } : {}),
    };
    let turn: R | null = null, failText = "";
    try {
      const acc = await ok(api.POST("/api/v2/assistant/turns", { body: body as Schemas["AssistantTurnIn"] }));
      if (my !== run) return;
      turn = await follow_(acc.turnId, my);
    } catch (e) {
      failText = e instanceof ApiError && e.status === 403 ? "Владелец выключил ИИ для слушателей" : "Не получилось связаться с ассистентом";
    }
    if (my !== run || dead) return;
    const rest = 1100 - (performance.now() - t0); if (rest > 0) await sleep(rest); // the turn reads as a turn even when the library answers at once
    if (my !== run || dead) return;
    const r: R | null = turn?.status === "done" ? (turn.result as R) : null;
    const secs = turn?.finishedAt && turn?.createdAt ? (Date.parse(turn.finishedAt) - Date.parse(turn.createdAt)) / 1000 : (performance.now() - t0) / 1000;
    if (turn) { remember(turn.images); for (const [id, t] of Object.entries(turn.tracks as Record<string, Track>)) T.set(id, t); }
    if (r?.clarify?.length) { await clarify(r.clarify.map((o: R) => ({ k: kindOf(o.intent), t: o.label, go: () => ask(text, { intent: kindOf(o.intent) }) }))); busy = false; return; }
    if (r?.disambiguate?.length) {
      await clarify(r.disambiguate.slice(0, 4).map((o: R) => ({ k: "general" as Kind, t: o.title, sub: o.subtitle,
        go: () => ask(text, o.track_id ? { subjectTrackId: o.track_id } : { subjectArtistSlug: o.artist_slug }) })));
      busy = false; return;
    }
    const scn = scenario(text, r, secs, failText || turn?.error);
    await answer(scn);
    last = { q: text, r: r ?? {}, text: scn.text || scn.title || "" };
    busy = false;
  }

  /** The turn's progress (the socket, a poll every 3 s for a dropped one) until it is done. */
  function follow_(turnId: string, my: number): Promise<R | null> {
    return new Promise((resolve) => {
      let settled = false, lastLine = "";
      const read = () => ok(api.GET("/api/v2/assistant/turns/{turn_id}", { params: { path: { turn_id: turnId } } })) as Promise<R>;
      const finish = async (t?: R) => {
        if (settled) return; settled = true;
        listen = null; clearInterval(poll); clearTimeout(limit);
        try { resolve(t ?? (await read())); } catch { resolve(null); }
      };
      const frame = (e: any) => {
        if (e.turnId !== turnId || my !== run) return;
        if (e.type === "assistant.done") return void finish();
        const f = e.frame ?? {};
        if (f.stage === "answer_delta") return;
        if (f.intent && f.intent in KIND && app.dataset.k === "think") { setKind(kindOf(f.intent)); O.eT = 0.75; pulse(0.7); }
        if (Array.isArray(f.track_ids) && f.track_ids.length) void coversInside(f.track_ids);
        if (/iteration|web|fetch|read/.test(String(f.stage))) sparks(8); else pulse(0.35);
        const line = String(f.human || "").trim();
        if (line && line !== lastLine) { lastLine = line; caption(line); }
      };
      listen = frame;
      for (const x of early.splice(0)) frame(x.e);
      const poll = setInterval(() => void read().then((t) => { if (t.status === "done" || t.status === "error") void finish(t); }).catch(() => undefined), 3000);
      const limit = setTimeout(() => void finish(), 180_000);
      cleanups.push(() => { settled = true; clearInterval(poll); clearTimeout(limit); });
    });
  }

  type Scn = { kind: Kind; q: string; secs: number; title?: string; blurb?: string | null; source?: string | null; tracks?: string[]; hits?: R[]; message?: string;
    confidence?: string; text?: string; subject?: R | null; sources?: string[]; next?: Item[]; links?: R[] };
  function scenario(q: string, r: R | null, secs: number, err?: string | null): Scn {
    const ids = (list: R[] | undefined) => (list ?? []).map((t) => String(t.track_id)).filter((id) => T.has(id));
    if (r?.intent === "playlist" || r?.intent === "audio_search") {
      const tracks = ids(r.playlist?.tracks);
      if (tracks.length) return { kind: r.intent as Kind, q, secs, title: r.playlist?.title || q, blurb: r.playlist?.blurb, source: r.playlist?.source, tracks };
    }
    if (r?.intent === "lyrics_search") {
      const hits = (r.search?.hits ?? []).filter((h: R) => T.has(String(h.track?.track_id)));
      if (hits.length) return { kind: "lyrics_search", q, secs, hits, message: r.search?.message, confidence: r.search?.confidence };
      if (r.search?.message) return { kind: "fail", q, secs, text: r.search.message };
    }
    if (r?.answer?.answer) {
      const next: Item[] = (r.next ?? []).length ? r.next : (r.answer.follow_ups ?? []).map((f: string) => ({ q: f, intent: "general" }));
      return { kind: "general", q, secs, text: r.answer.answer, subject: r.answer.subject, sources: r.sources ?? [], next, links: r.links ?? [] };
    }
    return { kind: "fail", q, secs, text: r?.human || (err && !/Traceback|Error:/.test(err) ? err : "") || "Не получилось ответить. Попробуй спросить иначе" };
  }

  function hideOrbit(chip?: Chip) {
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
      forget(c);
      c.el.classList.add("taken");
    }
  }
  function showOrbit() {
    orbit.shown = true;
    chips.forEach((c, i) => {
      c.gone = false; c.el.classList.remove("taken");
      for (const a of c.el.getAnimations()) a.cancel();
      forget(c); placeChips(0);
      const to = c.el.style.transform;
      c.el.animate([{ transform: `translate(${L.cx - c.w / 2}px,${L.cy - c.h / 2}px) scale(.4)`, opacity: 0, filter: "blur(6px)" }, { transform: to, opacity: c.op, filter: "blur(0)" }],
        { duration: SPR.duration, easing: SPR.easing, delay: 80 + i * 45, fill: "backwards" });
    });
  }

  function caption(line: string, first = false) {
    const el = $(".capt");
    el.innerHTML = line ? `<span class="in">${app.dataset.k !== "think" && !first ? '<i class="k"></i>' : ""}<span class="shim">${esc(line)}</span></span>` : "";
  }
  function showEcho(text: string) {
    const el = $(".echo");
    for (const a of el.getAnimations()) a.cancel();
    el.textContent = text;
    Object.assign(el.style, { textAlign: "left", width: "fit-content", opacity: "1", transform: "translateX(-50%)", maxWidth: Math.min(860, L.W - L.isl - 108) + "px" });
    el.style.left = L.cx + "px";
    // on a short screen the question needs room above the orb: the orb and its caption step down for the turn
    const top = L.cy - L.R - 36 - el.offsetHeight, shift = top < 22 ? 22 - top : 0;
    el.style.top = top + shift + "px";
    if (shift) {
      box.style.transform = `translateY(${shift}px)`;
      box.animate([{ transform: "none" }, { transform: `translateY(${shift}px)` }], { duration: SPR.duration, easing: SPR.easing });
      $(".capt").style.top = L.cy + L.R + 20 + shift + "px";
    }
    el.animate([{ opacity: 0, transform: "translateX(-50%) translateY(14px)", filter: "blur(8px)" }, { opacity: 1, transform: "translateX(-50%)", filter: "blur(0)" }],
      { duration: 700, easing: SWIFT, fill: "backwards", delay: 120 });
  }
  function sparks(n: number) {
    if (reduce) return;
    const d0 = $(".dust");
    for (let i = 0; i < n; i++) {
      const b = document.createElement("b"), a = Math.random() * Math.PI * 2, d = L.R * (1.7 + Math.random() * 1.1);
      d0.append(b);
      b.animate([{ transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d}px) scale(1)`, opacity: 0 }, { opacity: 0.95, offset: 0.2 },
        { transform: `translate(${Math.cos(a) * L.R * 0.2}px,${Math.sin(a) * L.R * 0.2}px) scale(.3)`, opacity: 0 }],
        { duration: 900 + Math.random() * 500, delay: Math.random() * 500, easing: "cubic-bezier(.5,0,.9,.6)" }).finished.then(() => b.remove(), () => b.remove());
    }
  }
  /** covers drift inside the ball while it picks (the answer's covers will come out of here) */
  async function coversInside(ids: string[]) {
    const rows = (await db.tracks.bulkGet(ids.slice(0, 12))).filter((t) => t?.coverImageId);
    const cids = [...new Set(rows.map((t) => t!.coverImageId!))].slice(0, 6);
    await warmFromMirror(cids);
    const el = $(".inside");
    if (dead || !app.classList.contains("working") || el.childElementCount) return;
    cids.forEach((cid, i) => {
      const src = cover(cid, 96); if (!src) return;
      const im = new Image(); im.src = src; im.alt = ""; im.dataset.cid = cid; el.append(im);
      const a = (i / 6) * 360, r = 95 + (i % 3) * 35;
      im.animate([0, 1, 2, 3, 4].map((k) => {
        const ang = ((a + k * 90) * Math.PI) / 180, z = Math.sin(ang);
        return { transform: `translate(${Math.cos(ang) * r}%,${z * r * 0.4}%) scale(${0.7 + (0.35 * (z + 1)) / 2})`, opacity: k === 0 ? 0 : 0.1 + (0.24 * (z + 1)) / 2 };
      }), { duration: 9000, iterations: Infinity, easing: "linear", delay: -i * 1500 });
    });
  }

  /* ── the answer ──────────────────────────────────────────────────────────── */
  async function answer(scn: Scn) {
    const ans = $(".answer");
    // the answer's pictures are in the cache before it shows: nothing flies in empty
    const urls = picturesOf(scn);
    await Promise.race([Promise.all(urls.map((u) => { const i = new Image(); i.src = u; return i.decode().catch(() => undefined); })), sleep(900)]);
    if (dead) return;
    caption("");
    if (scn.kind === "fail") setKind("fail"); else if (app.dataset.k === "think") setKind(scn.kind);
    app.classList.add("answering"); app.classList.remove("working");
    inner.style.minHeight = "";
    O.eT = 0.22;
    const s = scn.secs;
    ans.innerHTML = `<div class="meta rise"><i></i>${esc(KIND[scn.kind].label)}<span>· ${s.toFixed(s < 10 ? 1 : 0).replace(".", ",")} с</span><button class="new" type="button">${icon("Close", 14)}Новый вопрос</button></div><div class="body"></div>`;
    $(".new", ans).addEventListener("click", () => void reset());
    const body = $(".body", ans);
    if (scn.kind === "playlist") renderPlaylist(body, scn);
    if (scn.kind === "audio_search") renderSound(body, scn);
    if (scn.kind === "lyrics_search") renderLyrics(body, scn);
    if (scn.kind === "general" || scn.kind === "fail") renderAnswer(body, scn);
    body.insertAdjacentHTML("beforeend", '<div class="slot"></div>');
    releaseCovers($$<HTMLImageElement>("[data-fly]", body));
    dockOrb(true); dockEcho(); placeAsk("answer");
    if (scn.kind !== "fail") { sky.push({ q: scn.q, intent: scn.kind, born: true }); placeSky(); }
  }
  function picturesOf(scn: Scn): string[] {
    const ids = scn.tracks ?? (scn.hits ?? []).map((h) => String(h.track.track_id));
    const out = ids.slice(0, 15).map((id) => cover(T.get(id)?.coverImageId, 216));
    if (scn.subject?.image_id) out.push(cover(scn.subject.image_id, 248));
    return out.filter(Boolean);
  }

  /** the orb shrinks to the answer's side and stays there as its speaker; click = back */
  let dockT: ReturnType<typeof setTimeout> | undefined;
  function dockOrb(animate: boolean) {
    const k = 30 / L.R, tx = L.ansL + 30 - L.cx, ty = 66 - L.cy, from = box.style.transform || "none";
    const to = `translate(${tx}px,${ty}px) scale(${k})`;
    if (animate) box.animate([{ transform: from }, { transform: to }], { duration: SPR.duration, easing: SPR.easing });
    box.style.transform = to;
    // docked, the ball is 60 px on screen: once it has landed it renders at that size, not at the hero's
    clearTimeout(dockT);
    dockT = setTimeout(() => { if (app.classList.contains("answering")) { L.res = clamp(k * 1.5, 0.18, 1); sizeCanvas(); } }, animate ? SPR.duration + 40 : 0);
  }
  function dockEcho() {
    const el = $(".echo"), first = el.getBoundingClientRect();
    for (const a of el.getAnimations()) a.cancel();
    Object.assign(el.style, { left: L.ansL + 78 + "px", transform: "none", maxWidth: L.ansW - 90 + "px", opacity: "1" });
    el.style.top = Math.round(66 - el.offsetHeight / 2) + "px";
    const lst = el.getBoundingClientRect();
    el.animate([{ transform: `translate(${first.left - lst.left}px,${first.top - lst.top}px)` }, { transform: "none" }], { duration: SPR.duration, easing: SPR.easing });
  }
  /** the field: under the orb at rest; away while the orb works (the question is over the orb);
   *  after the answer it stands at the answer's end, in the flow, never over the text */
  function placeAsk(mode: string, animate = true) {
    const was = field.classList.contains("away") || (field.dataset.shown && field.dataset.shown !== mode);
    field.dataset.mode = mode;
    if (mode === "away") { field.classList.add("away"); return; }
    let aw = L.aw, left = L.cx - L.aw / 2, top = L.cy + L.R + 58;
    if (mode === "answer") {
      const slot = $(".answer .slot"); if (!slot) return;
      aw = Math.min(620, L.ansW); left = L.ansL;
      top = slot.getBoundingClientRect().top - stage.getBoundingClientRect().top;
    }
    Object.assign(field.style, { width: aw + "px", left: left + "px", top: top + "px" });
    input.placeholder = mode === "answer" ? "Уточнить или спросить ещё…" : L.ph;
    field.classList.remove("away"); field.dataset.shown = mode;
    if (animate && was) field.animate([{ opacity: 0, transform: "translateY(14px) scale(.98)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
      { duration: SPR.duration, easing: SPR.easing, delay: mode === "answer" ? 650 : 200, fill: "backwards" });
  }

  async function reset(quick = false) {
    run++; busy = false; listen = null;
    const ans = $(".answer");
    if (app.classList.contains("answering")) {
      await ans.animate([{ opacity: 1, filter: "blur(0)" }, { opacity: 0, filter: "blur(10px)", transform: "translateY(16px)" }], { duration: 260, easing: EXIT }).finished;
      if (dead) return;
      ans.innerHTML = "";
    }
    clearTimeout(dockT);
    if (L.res !== 1) { L.res = 1; sizeCanvas(); }
    app.classList.remove("answering", "working");
    $(".split").innerHTML = ""; $(".inside").innerHTML = ""; O.dimT = 0;
    const from = box.style.transform || "none";
    box.style.transform = "";
    box.animate([{ transform: from }, { transform: "none" }], { duration: SPR.duration, easing: SPR.easing });
    const echo = $(".echo");
    for (const a of echo.getAnimations()) a.cancel();
    echo.style.opacity = "0"; echo.animate([{ opacity: 1 }, { opacity: 0, filter: "blur(8px)" }], { duration: 240, easing: EXIT });
    $(".capt").innerHTML = ""; setKind("idle"); O.eT = 0.15;
    layout(); placeAsk("idle");
    showOrbit();
    if (!quick) await sleep(200);
  }

  /* the answer's covers come out of the orb: a cover that was already turning inside flies from where it
     was (blurred, as it was seen through the smoke), the others leave the orb's heart; covers inside that
     are not in the answer sink back into the smoke as the orb shrinks */
  function releaseCovers(targets: HTMLImageElement[], stagger = 42) {
    const a0 = app.getBoundingClientRect(), o = $(".orbhit").getBoundingClientRect();
    const ox = o.left + o.width / 2, oy = o.top + o.height / 2;
    const inside = $$<HTMLImageElement>(".inside img").map((im) => ({ im, cid: im.dataset.cid, r: im.getBoundingClientRect(), op: +getComputedStyle(im).opacity }));
    targets.forEach((im, i) => {
      const r = im.getBoundingClientRect(); if (!r.width || reduce) return;
      const j = inside.findIndex((x) => x.cid && x.cid === im.dataset.cid), from = j >= 0 ? inside.splice(j, 1)[0]! : null;
      if (from) from.im.remove();
      im.style.opacity = "0";
      const fl = document.createElement("img"); fl.src = im.currentSrc || im.src; fl.alt = "";
      const rad = +(im.dataset.fly ?? 0) >= 999 ? "50%" : im.dataset.fly + "px";
      fl.style.cssText = `position:fixed;z-index:60;left:${r.left - a0.left}px;top:${r.top - a0.top}px;width:${r.width}px;height:${r.height}px;object-fit:cover;border-radius:${rad};pointer-events:none`;
      app.append(fl);
      const fx = from ? from.r.left + from.r.width / 2 : ox + Math.cos(i * 2.4) * o.width * 0.12, fy = from ? from.r.top + from.r.height / 2 : oy + Math.sin(i * 2.4) * o.height * 0.12;
      const sc = from ? from.r.width / r.width : 0.1;
      fl.animate([{ transform: `translate(${fx - (r.left + r.width / 2)}px,${fy - (r.top + r.height / 2)}px) scale(${sc})`, opacity: from ? Math.max(0.35, from.op) : 0, filter: "blur(7px)" },
        { opacity: 1, offset: 0.35 }, { transform: "none", opacity: 1, filter: "blur(0)" }],
        { duration: SPR_BOUNCE.duration + 120, easing: SPR_BOUNCE.easing, delay: (from ? 0 : 90) + i * stagger, fill: "backwards" }).finished.then(() => { im.style.opacity = ""; fl.remove(); }, () => fl.remove());
    });
    for (const x of inside) x.im.animate([{ opacity: x.op, filter: "blur(7px)" }, { opacity: 0, filter: "blur(14px)" }], { duration: 450, easing: EXIT }).finished.then(() => x.im.remove(), () => x.im.remove());
  }

  /* ── the four answer cards (the owner: a card per answer type, «органично и к месту») ── */
  let playIds: string[] = []; // the list the answer's rows play from
  const tr = (id: string) => T.get(id)!;
  const rowHTML = (id: string, i: number) => { const t = tr(id); return `<div class="row rise" style="--d:${300 + i * 35}" data-play="${i}"><span class="no">${i + 1}</span><span class="cw"><img src="${cover(t.coverImageId, 44)}" alt=""><span class="pl">${icon("Play", 16)}</span></span><span class="t"><b>${esc(t.titleDisplay ?? t.title)}</b><span>${esc(t.artistDisplay)}${t.album ? " · " + esc(t.album) : ""}</span></span><span class="du">${dur(t.durationMs)}</span></div>`; };
  function mosaicOf(ids: string[]) {
    const seen = new Set<string>(), out: string[] = [];
    for (const id of ids) { const c = T.get(id)?.coverImageId; if (c && !seen.has(c)) { seen.add(c); out.push(c); } if (out.length === 4) break; }
    while (out.length < 4 && out.length) out.push(out[out.length % Math.max(1, out.length)]!);
    return out;
  }
  const SOURCE: Record<string, string> = { credits: "Из титров твоей библиотеки.", chart: "Самое популярное по чарту Deezer, что есть у тебя.", listens: "То, что ты слушаешь чаще." };
  function renderPlaylist(body: HTMLElement, scn: Scn) {
    const ids = scn.tracks!.slice(0, 15), m = mosaicOf(ids), mins = Math.round(ids.reduce((s, id) => s + (tr(id).durationMs || 0), 0) / 60000);
    playIds = ids;
    const src = scn.source ? SOURCE[scn.source] : "";
    body.innerHTML = `<div class="pl-head"><div style="position:relative"><div class="mosaic-glow">${m.map((c) => `<img src="${cover(c, 108)}" alt="">`).join("")}</div><div class="mosaic">${m.map((c) => `<img src="${cover(c, 108)}" alt="" data-fly="3" data-cid="${c}">`).join("")}</div></div>
      <div class="rise" style="--d:120"><h1>${esc(scn.title)}</h1><div class="sub">${ids.length} ${plural(ids.length, "песня", "песни", "песен")} · ${mins} мин</div>
      ${scn.blurb || src ? `<p>${esc(scn.blurb || "")} ${src ? `<span class="src">${esc(src)}</span>` : ""}</p>` : ""}
      <div class="acts"><button class="btn solid" type="button" data-play="0">${icon("Play", 16)}Слушать</button><button class="btn ${G}" type="button" data-save>${icon("Plus", 16)}Сохранить</button><button class="btn ${G} round" type="button" aria-label="Перемешать" data-shuffle>${icon("Shuffle", 16)}</button></div></div></div>
      <div class="rows">${ids.map(rowHTML).join("")}</div>`;
  }
  function bars(id: string) { let s = ""; for (let i = 0; i < 18; i++) s += `<b style="--h:${Math.round(22 + 78 * hash(id + i))};--i:${i}"></b>`; return s; }
  function renderSound(body: HTMLElement, scn: Scn) {
    const ids = scn.tracks!.slice(0, 15);
    playIds = ids;
    const title = scn.title && scn.title !== scn.q ? scn.title : scn.q.replace(/^что-нибудь\s*/i, "").replace(/^./, (c) => c.toUpperCase());
    scn.title = title;
    body.innerHTML = `<div class="snd-head rise" style="--d:80"><h1>${esc(title)}</h1><div class="sub">${ids.length} ${plural(ids.length, "песня", "песни", "песен")} из твоей библиотеки, близких по звуку</div>
      <div class="acts"><button class="btn solid" type="button" data-play="0">${icon("Play", 16)}Слушать всё</button><button class="btn ${G}" type="button" data-save>${icon("Plus", 16)}Сохранить как плейлист</button></div></div>
      <div class="grid">${ids.map((id, i) => { const t = tr(id); return `<div class="tile" data-play="${i}"><div class="cw"><img src="${cover(t.coverImageId, 216)}" alt="" data-fly="12" data-cid="${t.coverImageId ?? ""}"><span class="wave">${bars(id)}</span><span class="pl">${icon("Play", 18)}</span></div><b>${esc(t.titleDisplay ?? t.title)}</b><span>${esc(t.artistDisplay)}</span></div>`; }).join("")}</div>`;
  }
  function verse(lyrics: string | null | undefined, line: string | null | undefined) {
    const ls = String(lyrics || "").split("\n").filter((x) => x.trim());
    if (!ls.length) return line ? `<span class="hit">${esc(line)}</span>` : "";
    const want = String(line || "").trim().toLowerCase();
    const i = Math.max(0, ls.findIndex((x) => x.trim().toLowerCase() === want || (want && x.toLowerCase().includes(want))));
    return ls.slice(Math.max(0, i - 2), i + 2).map((x, j) => (Math.max(0, i - 2) + j === i && want ? `<span class="hit">${esc(x)}</span>` : esc(x))).join("<br>");
  }
  function renderLyrics(body: HTMLElement, scn: Scn) {
    const [best, ...more] = scn.hits!, id = String(best!.track.track_id), t = tr(id);
    playIds = scn.hits!.map((h) => String(h.track.track_id));
    const sure = scn.confidence === "high";
    body.innerHTML = `<div class="lyr-best"><div class="cw"><img src="${cover(t.coverImageId, 232)}" alt="" data-fly="16" data-cid="${t.coverImageId ?? ""}"></div><div class="rise" style="--d:150">
      <span class="sure">${icon(sure ? "Check" : "Search", 14)}${sure ? "Точно она" : "Похоже, она"}</span><h1>${esc(t.titleDisplay ?? t.title)}</h1><div class="by">${esc(t.artistDisplay)}${t.album ? " · " + esc(t.album) : ""}${t.year ? " · " + t.year : ""}</div>
      <div class="verse">${verse(best!.lyrics, best!.matched_line)}</div>
      <div class="acts"><button class="btn solid" type="button" data-play="0">${icon("Play", 16)}Слушать</button></div>
      ${scn.message ? `<div class="why">${esc(scn.message)}</div>` : ""}</div></div>
      ${more.length ? `<div class="lyr-more rise" style="--d:420"><h3>Похоже, но слабее</h3>${more.slice(0, 6).map((h, k) => { const m = tr(String(h.track.track_id)); return `<div class="row" data-play="${k + 1}"><span class="cw"><img src="${cover(m.coverImageId, 44)}" alt=""><span class="pl">${icon("Play", 16)}</span></span><span class="t"><b>${esc(m.titleDisplay ?? m.title)}</b><span>${esc(m.artistDisplay)}</span></span><q>${esc(h.matched_line || "совпадение по смыслу, не по словам")}</q></div>`; }).join("")}</div>` : ""}`;
  }
  let nextItems: Item[] = [];
  function linkNames(html: string, links: R[]) {
    let out = html;
    for (const l of [...links].sort((a, b) => String(b.name).length - String(a.name).length)) {
      const n = esc(l.name), i = out.indexOf(n);
      if (i >= 0 && !out.slice(0, i).includes(`>${n}<`) && !/<a [^>]*$/.test(out.slice(0, i))) out = out.slice(0, i) + `<a href="#" data-artist="${n}">${n}</a>` + out.slice(i + n.length);
    }
    return out;
  }
  function renderAnswer(body: HTMLElement, scn: Scn) {
    const s = scn.subject, text = scn.text || "", paras = text.split(/\n\n+/);
    nextItems = scn.next ?? [];
    const pic = s?.image_id ? cover(s.image_id, 248) : "", song = s?.kind === "song";
    if (song && s?.track_id && T.has(String(s.track_id))) playIds = [String(s.track_id)];
    const aside = s && pic ? `<aside class="ans-aside"><div class="cw${song ? "" : " round"}"><img src="${pic}" alt="" data-fly="${song ? 14 : 999}" data-cid="${s.image_id}"></div>
      <b class="rise" style="--d:350">${esc(s.title)}</b><span class="rise" style="--d:400">${esc(s.subtitle || (song ? "" : "артист"))}</span>
      ${song && s.track_id && T.has(String(s.track_id)) ? `<button class="btn solid rise" style="--d:480" type="button" data-play="0">${icon("Play", 16)}Слушать</button>`
        : !song && s.title ? `<button class="btn ${G} rise" style="--d:480" type="button" data-artist="${esc(s.title)}">Открыть</button>` : ""}</aside>` : "";
    const tail = 400 + Math.min(text.length, 900) * 6;
    body.innerHTML = `<div class="ans-grid"><div class="ans-main"><div class="ans-text"></div>${(scn.sources ?? []).length ? `<div class="ans-src rise" style="--d:${tail}">${scn.sources!.map((x) => `<b>${esc(x)}</b>`).join("")}</div>` : ""}
      <div class="follow">${nextItems.slice(0, 4).map((f, i) => `<button class="rise" style="--d:${tail + 200 + i * 90};--c:${KIND[kindOf(f.intent)].c}" type="button" data-next="${i}"><i></i>${esc(f.q)}</button>`).join("")}</div></div>${aside}</div>`;
    let n = 0;
    // words surface one after another at reading pace; past ~900 characters the rest comes at once
    $(".ans-text", body).innerHTML = paras.map((p) => `<p>${linkNames(esc(p), scn.links ?? []).split(/(\s+|<a [^>]*>.*?<\/a>)/).map((w) => (w.trim() ? `<span class="w" style="animation-delay:${Math.min(n++, 150) * 26 + 300}ms">${w}</span>` : w)).join("")}</p>`).join("");
  }

  /* clarify: the kinds it could be, as glass options where the field stood */
  async function clarify(opts: { k: Kind; t: string; sub?: string; go: () => void }[]) {
    caption("Не уверен, что именно нужно, уточни");
    O.dimT = 0.2;
    const sp = $(".split"); sp.innerHTML = "";
    const row = document.createElement("div"); row.className = "opts";
    row.style.left = L.cx + "px"; row.style.top = L.cy + L.R + 62 + "px";
    sp.append(row);
    opts.forEach((o, i) => {
      const el = document.createElement("button"); el.type = "button"; el.className = `opt ${G}`; el.style.setProperty("--c", KIND[o.k].c);
      el.innerHTML = `<i></i>${esc(o.t)}<small>${esc(o.sub || KIND[o.k].label)}</small>`;
      row.append(el);
      el.animate([{ opacity: 0, transform: "translateY(12px) scale(.96)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: SPR.duration, easing: SPR.easing, delay: 120 + i * 70, fill: "backwards" });
      el.addEventListener("click", async () => {
        for (const m of $$(".opt", row)) if (m !== el) { m.style.opacity = "0"; m.animate([{ opacity: 1 }, { opacity: 0, filter: "blur(6px)" }], { duration: 200, easing: EXIT }); }
        const r = el.getBoundingClientRect(), s0 = stage.getBoundingClientRect();
        const dx = L.cx - (r.left + r.width / 2 - s0.left), dy = L.cy - (r.top + r.height / 2 - s0.top);
        el.style.opacity = "0";
        await el.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(.35)`, opacity: 0, filter: "blur(3px)" }], { duration: 520, easing: SWIFT }).finished;
        sp.innerHTML = ""; O.dimT = 0; pulse(0.6);
        busy = false; app.classList.remove("working"); o.go();
      });
    });
  }

  /* ── the carousel «Интересное в твоей музыке» (built from the library and the facts, no LLM) ── */
  let cards: Item[] = [], homeLoaded = false, deal = 0;
  function cardHTML(c: Item, i: number) {
    const k = `<div class="kick"><i style="--c:${KIND[kindOf(c.intent)].c}"></i>${esc(c.kicker)}</div>`;
    const fan = ((c.covers as string[]) || []).slice(0, 4).map((x, j) => `<img src="${cover(x, 64)}" alt="" style="--i:${j};z-index:${4 - j}">`).join("");
    const go = `<span class="ask-l">Спросить ${icon("ChevronRight", 13)}</span>`;
    const n = (v: number, a: string, b2: string, c2: string) => `${v} ${plural(v, a, b2, c2)}`;
    const im = cover(c.image_id, 76);
    if (c.kind === "qday") return `<button type="button" class="card qday" data-card="${i}">${k}<div class="tt">${esc(c.title)}</div>${go}</button>`;
    if (c.kind === "producer" || c.kind === "guest") return `<button type="button" class="card ${c.kind}" data-card="${i}">${k}<div class="fan">${fan}</div><div class="tt">${esc(c.title)}</div><div class="ln">${n(c.n, "песня", "песни", "песен")} у ${n(c.m, "артиста", "артистов", "артистов")} твоей библиотеки</div>${go}</button>`;
    if (c.kind === "story" && im) return `<button type="button" class="card story" data-card="${i}"><span class="lit" style="background-image:url(${im})"></span>${k}<img class="cv" src="${im}" alt=""><div class="tt">${esc(c.title)}</div><div class="ln">${esc(c.line)}</div>${go}</button>`;
    if (c.kind === "name" && im) return `<button type="button" class="card name" data-card="${i}"><span class="lit" style="background-image:url(${im})"></span>${k}<img class="ph" src="${im}" alt=""><div class="tt">${esc(c.line)}</div>${go}</button>`;
    if (c.kind === "year" && im) return `<button type="button" class="card year" data-card="${i}"><span class="lit" style="background-image:url(${im})"></span>${k}<img class="cv" src="${im}" alt=""><div class="tt">${esc(c.title)}</div><div class="ln">${esc(c.artist || "")} · ${c.years} ${plural(c.years, "год", "года", "лет")}</div>${go}</button>`;
    if (c.kind === "forgotten" && im) return `<button type="button" class="card forgotten" data-card="${i}">${k}<img class="ph" src="${im}" alt=""><div class="tt">${esc(c.title)}</div><div class="ln">${esc(c.line)}</div>${go}</button>`;
    return `<button type="button" class="card" data-card="${i}">${k}<div class="tt">${esc(c.title)}</div><div class="ln">${esc(c.line)}</div>${go}</button>`;
  }
  function renderFeed() {
    const feed = $(".feed");
    if (!cards.length) { feed.innerHTML = ""; return; }
    feed.innerHTML = `<div class="hd"><h2>Интересное в твоей музыке</h2>${cards.length > L.nCards ? `<button class="more" type="button">${icon("Refresh", 15)}Другие</button>` : ""}</div><div class="rail"></div>`;
    const more = $(".more", feed);
    more?.addEventListener("click", async () => {
      $(".ic", more).animate([{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }], { duration: 700, easing: SWIFT });
      const old = $$(".rail .card");
      await Promise.all(old.map((c, i) => c.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-10px) scale(.97)", filter: "blur(6px)" }], { duration: 220, easing: EXIT, delay: i * 30, fill: "forwards" }).finished));
      deal = (deal + 1) % Math.ceil(cards.length / L.nCards); renderCards(true);
    });
  }
  function renderCards(animate: boolean) {
    const rail = $(".rail"); if (!rail || !cards.length) return;
    const n = L.nCards || 4, from = (deal * n) % cards.length, idx: number[] = [];
    for (let i = 0; i < Math.min(n, cards.length); i++) idx.push((from + i) % cards.length);
    rail.innerHTML = idx.map((i) => cardHTML(cards[i]!, i)).join("");
    if (animate) $$(".card", rail).forEach((c, i) => c.animate([{ opacity: 0, transform: "translateY(14px) scale(.97)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: SPR.duration, easing: SPR.easing, delay: 60 + i * 55, fill: "backwards" }));
  }

  /* save: the playlist becomes the listener's; its picture flies into «Библиотека» on the island and is taken in */
  async function save(btn: HTMLButtonElement) {
    const title = $(".answer h1")?.textContent || "Подборка ассистента";
    btn.disabled = true;
    const made = (async () => { const id = await createPlaylist(title); await addToPlaylist(id, playIds); })();
    const src = $(".mosaic") || $(".grid .cw"), lib = document.querySelector<HTMLElement>('nav[aria-label="Разделы"] a[href="/library"]');
    let flew: Promise<void> = Promise.resolve();
    if (src && lib && !reduce) {
      const r = src.getBoundingClientRect(), t = lib.getBoundingClientRect();
      const fl = src.cloneNode(true) as HTMLElement;
      fl.style.cssText = `position:fixed;z-index:60;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;pointer-events:none`;
      document.body.append(fl);
      const dx = t.left + t.width / 2 - (r.left + r.width / 2), dy = t.top + t.height / 2 - (r.top + r.height / 2);
      flew = fl.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${dx * 0.55}px,${dy * 0.35 - 60}px) scale(.45) rotate(-6deg)`, opacity: 1, offset: 0.55 }, { transform: `translate(${dx}px,${dy}px) scale(.08)`, opacity: 0.2 }],
        { duration: 900, easing: "cubic-bezier(.5,0,.3,1)" }).finished.then(() => {
        fl.remove(); lib.animate([{ transform: "scale(1)" }, { transform: "scale(1.14)" }, { transform: "scale(1)" }], { duration: SPR_BOUNCE.duration, easing: SPR_BOUNCE.easing });
      }, () => fl.remove());
    }
    try {
      await Promise.all([made, flew]);
      if (dead) return;
      btn.classList.add("saved"); btn.innerHTML = `${icon("Check", 16)}В библиотеке`; toast(`«${title}» — в библиотеке`);
    } catch {
      btn.disabled = false; toast("Не получилось сохранить");
    }
  }
  function play(i: number, shuffle = false) {
    const ids = playIds.filter((id) => T.has(id));
    if (!ids.length) return;
    let items = ids.map((id) => fromTrack(tr(id), "search"));
    if (shuffle) { items = [...items].sort(() => Math.random() - 0.5); i = 0; }
    void player.playTracks(items, clamp(i, 0, items.length - 1));
  }
  async function openArtist(name: string) {
    const lower = name.trim().toLowerCase();
    const a = await db.artists.filter((x) => x.name.toLowerCase() === lower).first();
    if (a) deps.openArtist(a.id); else toast(`${name} — не в твоей библиотеке`);
  }

  /* ── the frame loop and the events ──────────────────────────────────────── */
  let lastT = performance.now(), typing = 0, raf = 0, seen = true, caustic = "";
  const io = new IntersectionObserver((es) => { seen = es[es.length - 1]!.isIntersecting; }, { root: page });
  io.observe(box);
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    const idle = !busy && !app.classList.contains("answering");
    const pv = O.preview && idle ? KIND[O.preview] : null;
    const k1 = pv ? mix(O.k1, pv.c1, 0.6) : O.k1, k2 = pv ? mix(O.k2, pv.c2, 0.6) : O.k2, kc = 1 - Math.exp(-dt * 3);
    O.c1 = mix(O.c1, k1, kc); O.c2 = mix(O.c2, k2, kc);
    typing *= Math.exp(-dt * 1.5);
    O.e += (O.eT + (pv ? 0.05 : 0) + typing * 0.08 - O.e) * (1 - Math.exp(-dt * 1.6));
    O.t += dt * (1 + O.e * 0.25) * (reduce ? 0.3 : 1);
    O.pulse *= Math.exp(-dt * 3.2); O.rip += dt; O.dim += (O.dimT - O.dim) * (1 - Math.exp(-dt * 4));
    O.lean = mix(O.lean, O.leanT, 1 - Math.exp(-dt * 3));
    if (orbit.shown) placeChips(dt);
    if (orb) {
      if (seen) { const changed = paintBg(); orb.draw({ t: O.t, r: L.R * L.dpr * L.res, c1: O.c1, c2: O.c2, e: O.e, mat: 0, lean: O.lean, rip: O.rip, pulse: O.pulse, dim: O.dim, bgChanged: changed }); }
    } else V1?.(O.e);
    const cs = (0.22 + O.e * 0.7).toFixed(2);
    if (cs !== caustic) { caustic = cs; field.style.setProperty("--caustic", cs); }
  }

  on(field, "submit", (e: Event) => { e.preventDefault(); void ask(input.value, { follow: field.dataset.mode === "answer" }); });
  on(input, "input", () => { field.classList.toggle("has", !!input.value.trim()); typing = Math.min(1, typing + 0.35); pulse(0.04); O.leanT = [0, -0.85]; });
  on(input, "blur", () => { O.leanT = [0, 0]; });
  on(stage, "pointermove", (e: PointerEvent) => {
    if (document.activeElement === input && input.value) return;
    const r = stage.getBoundingClientRect();
    const nx = clamp((e.clientX - r.left - L.cx) / (L.W / 2), -1, 1), ny = clamp((e.clientY - r.top - L.cy) / (L.H / 2), -1, 1);
    orbit.pxT = nx * 26; orbit.tiltT = ny * 0.14; O.leanT = [nx * 0.7, -ny * 0.7];
  });
  on(stage, "pointerleave", () => { orbit.pxT = 0; orbit.tiltT = 0; O.leanT = [0, 0]; });
  on($(".orbhit"), "click", () => { if (app.classList.contains("answering")) void reset(); else pulse(0.5); });
  on(host, "click", (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const nx = t.closest<HTMLElement>("[data-next]"); if (nx) { const it = nextItems[+nx.dataset.next!]; if (it) void ask(it.q, { item: it, follow: true }); return; }
    const c = t.closest<HTMLElement>("[data-card]"); if (c) { const card = cards[+c.dataset.card!]; if (card) void ask(card.ask || card.q, { item: card }); return; }
    const p = t.closest<HTMLElement>("[data-play]"); if (p) { play(+p.dataset.play!); return; }
    const sh = t.closest<HTMLElement>("[data-shuffle]"); if (sh) { play(0, true); return; }
    const sv = t.closest<HTMLButtonElement>("[data-save]"); if (sv && !sv.classList.contains("saved")) { void save(sv); return; }
    const ar = t.closest<HTMLElement>("[data-artist]"); if (ar) { e.preventDefault(); void openArtist(ar.dataset.artist!); }
  });
  on(document, "keydown", (e: KeyboardEvent) => { if (e.key === "Escape" && (app.classList.contains("answering") || app.classList.contains("working"))) void reset(); });
  const ro = new ResizeObserver(() => layout());
  ro.observe(page);
  void document.fonts?.ready.then(() => { if (!dead) measureChips(); });

  // the room is laid out at once (the orb where it will stand, with the row of cards reserved); the
  // questions fly out of the orb and the cards rise when the server has built them
  layout();
  raf = requestAnimationFrame(frame);
  if (deps.initial) void ask(deps.initial);
  void ok(api.GET("/api/v2/assistant/home", { params: { query: { lang: "ru", hour: new Date().getHours() } } })).then((h) => {
    if (dead) return;
    remember(h.images);
    const orbitItems = (h.orbit as Item[]).slice(0, 8);
    const day = (h.orbit as Item[]).slice(8).find((o) => o.intent === "general");
    cards = [...(day ? [{ ...day, kind: "qday", kicker: "Вопрос дня", title: day.q, ask: day.q }] : []), ...(h.cards as Item[])];
    sky = (h.sky as R[]).map((s) => ({ q: String(s.q), intent: kindOf(s.intent) }));
    homeLoaded = true;
    buildChips(orbitItems);
    L.shownCards = undefined;
    layout(); renderFeed(); renderCards(true);
    if (app.classList.contains("answering") || app.classList.contains("working")) hideOrbit(); else showOrbit();
  }).catch(() => { homeLoaded = true; if (!dead) layout(); });

  return () => {
    dead = true; run++;
    cancelAnimationFrame(raf); clearTimeout(dockT);
    io.disconnect(); ro.disconnect();
    for (const f of cleanups) f();
    orb?.release();
    host.innerHTML = "";
  };
}
