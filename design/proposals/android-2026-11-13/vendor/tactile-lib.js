"use strict";
/* Shared pieces of the mock: springs, the haptics layer, a load meter, and the three mishanaer
   components (Richbox, Password, JoiPro), ported to plain JS from the user's prototype
   (new_design_v2/tactile-music-ui_3.html), which ported them from React. MIT © 2026 mishanaer. */

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp01 = n => Math.max(0, Math.min(1, n));
const lerp = (a, b, t) => a + (b - a) * t;
const $ = id => document.getElementById(id);

/* ---------- load meter: who keeps the screen busy ---------- */
const LIVE = new Set();               // names of rAF loops that are running right now
function live(name, on) { on ? LIVE.add(name) : LIVE.delete(name); }

/* ---------- spring easing for CSS (linear()) ---------- */
function springEase(visualDuration, bounce) {
  const w0 = 2 * Math.PI / visualDuration, z = Math.max(0.05, 1 - bounce);
  const x = t => {
    if (z >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
  };
  let T = 0.05;
  for (let t = 0; t < 4; t += 0.004) if (Math.abs(1 - x(t)) > 0.002) T = t;
  const pts = [];
  for (let i = 0; i <= 48; i++) pts.push(+x(T * i / 48).toFixed(4));
  pts[48] = 1;
  return { easing: `linear(${pts.join(", ")})`, ms: Math.round(T * 1000) };
}
if (CSS.supports("transition-timing-function", "linear(0, 1)")) {
  const s = springEase(0.35, 0.3), q = springEase(0.22, 0.15), root = document.documentElement.style;
  root.setProperty("--spring", s.easing); root.setProperty("--spring-ms", s.ms + "ms");
  root.setProperty("--snap", q.easing); root.setProperty("--snap-ms", q.ms + "ms");
}
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- physics spring: keeps velocity when interrupted, sleeps when settled ---------- */
let springUid = 0;
function createSpring({ value = 0, stiffness = 380, damping = 34, mass = 1, precision = 0.01, onUpdate, onRest, name }) {
  const s = { value, velocity: 0, target: value, stiffness, damping, mass, raf: 0, last: 0, onRest, name: name || "spring" + (++springUid) };
  function step(now) {
    const dt = Math.min(0.064, (now - s.last) / 1000); s.last = now;
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = (-s.stiffness * (s.value - s.target) - s.damping * s.velocity) / s.mass;
      s.velocity += a * h; s.value += s.velocity * h;
    }
    if (Math.abs(s.velocity) < precision * 10 && Math.abs(s.value - s.target) < precision) {
      s.value = s.target; s.velocity = 0; s.raf = 0; live(s.name, false); onUpdate(s.value); s.onRest && s.onRest(); return;
    }
    onUpdate(s.value);
    s.raf = requestAnimationFrame(step);
  }
  s.to = (target, opts = {}) => {
    s.target = target;
    if (opts.velocity !== undefined) s.velocity = opts.velocity;
    if (opts.onRest !== undefined) s.onRest = opts.onRest;
    if (REDUCED) { cancelAnimationFrame(s.raf); s.raf = 0; s.value = target; s.velocity = 0; onUpdate(target); s.onRest && s.onRest(); return; }
    if (!s.raf) { s.last = performance.now(); s.raf = requestAnimationFrame(step); live(s.name, true); }
  };
  s.set = v => { cancelAnimationFrame(s.raf); s.raf = 0; live(s.name, false); s.value = v; s.target = v; s.velocity = 0; onUpdate(v); };
  onUpdate(value);
  return s;
}

/* ---------- haptics: one small vocabulary, mapped 1:1 to Compose HapticFeedbackType ----------
   Rules: only the user's own gesture vibrates (never playback, downloads or answers arriving);
   plain taps on buttons, tabs and rows stay silent; ticks no closer than 45 ms; the same kind
   is not repeated within 120 ms; the keyboard already clicks, so typed digits stay silent.
   On Android Chrome this is navigator.vibrate; on iPhone (Safari 18+) a hidden <input switch>
   gives one fixed system tap, used only for the stronger kinds. */
const HAPTICS = {
  tick:      { web: 7,               android: "SegmentTick" },
  toggleOn:  { web: 14,              android: "ToggleOn" },
  toggleOff: { web: 9,               android: "ToggleOff" },
  threshold: { web: 16,              android: "GestureThresholdActivate" },
  thresholdOff: { web: 6,            android: "GestureThresholdDeactivate" },
  lift:      { web: 26,              android: "LongPress" },
  drop:      { web: 10,              android: "GestureEnd" },
  confirm:   { web: [12, 70, 20],    android: "Confirm" },
  reject:    { web: [22, 45, 22, 45, 22], android: "Reject" },
};
const hapticState = { on: true, show: true, last: 0, lastKind: "", count: 0 };
let iosTap = null;
(function iosSwitch() {
  const ua = navigator.userAgent;
  if (navigator.vibrate || !/iPhone|iPad|iPod/.test(ua)) return;
  const label = document.createElement("label");
  label.style.cssText = "position:fixed;left:-200px;top:0;width:1px;height:1px;overflow:hidden;opacity:0";
  label.setAttribute("aria-hidden", "true");
  const input = document.createElement("input"); input.type = "checkbox"; input.setAttribute("switch", ""); input.tabIndex = -1;
  label.append(input); document.body.append(label);
  iosTap = () => label.click();
})();
let hchipAnim = null;
function haptic(kind) {
  const h = HAPTICS[kind]; if (!h) return;
  const now = performance.now();
  if (kind === "tick" && now - hapticState.last < 45) return;
  if (kind !== "tick" && kind === hapticState.lastKind && now - hapticState.last < 120) return;
  hapticState.last = now; hapticState.lastKind = kind; hapticState.count++;
  if (hapticState.show) {
    const chip = $("hchip");
    chip.querySelector("span").textContent = h.android;
    hchipAnim && hchipAnim.cancel();
    hchipAnim = chip.animate([{ opacity: 0, transform: "translate(-50%, -6px)" }, { opacity: 1, transform: "translate(-50%, 0)", offset: .15 }, { opacity: 1, transform: "translate(-50%, 0)", offset: .75 }, { opacity: 0, transform: "translate(-50%, 0)" }], { duration: 900, easing: "ease-out" });
  }
  if (!hapticState.on) return;
  if (navigator.vibrate) { try { navigator.vibrate(h.web); } catch (_) {} }
  else if (iosTap && kind !== "tick") iosTap();
}

/* ---------- gestures ---------- */
function tracker() {
  let samples = [];
  return {
    add(v) { const t = performance.now(); samples.push([t, v]); samples = samples.filter(s => t - s[0] < 90); },
    vel() { if (samples.length < 2) return 0; const a = samples[0], b = samples[samples.length - 1]; return (b[1] - a[1]) / Math.max(1, b[0] - a[0]) * 1000; },
    reset() { samples = []; },
  };
}
function dragGesture(el, { canStart, onStart, onMove, onEnd, onTap }) {
  let st = null;
  el.addEventListener("pointerdown", e => {
    if (e.button !== 0 || (canStart && !canStart(e))) return;
    st = { x: e.clientX, y: e.clientY, axis: null, id: e.pointerId, target: e.target };
  });
  el.addEventListener("pointermove", e => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.axis) {
      if (Math.hypot(dx, dy) < 7) return;
      st.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      onStart && onStart(st);
    }
    onMove && onMove(st, dx, dy);
  });
  const end = e => {
    if (!st || e.pointerId !== st.id) return;
    const s = st; st = null;
    if (!s.axis) { e.type === "pointerup" && onTap && onTap(s, e); return; }
    onEnd && onEnd(s, e.clientX - s.x, e.clientY - s.y);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

/* =====================================================================
   Richbox — github.com/mishanaer/richbox (MIT © 2026 mishanaer). Colours retuned for MusiX:
   progress is light, done is green, error red. The "waiting" turn sleeps between turns
   (setTimeout), so a queued download costs ~0 between its quarter-turns.
   ===================================================================== */
function cubicBezier(x1, y1, x2, y2) {
  const b = (u, a, c) => 3 * a * u * (1 - u) * (1 - u) + 3 * c * u * u * (1 - u) + u * u * u;
  return t => {
    if (t <= 0) return 0; if (t >= 1) return 1;
    let lo = 0, hi = 1, u = t;
    for (let i = 0; i < 24; i++) { u = (lo + hi) / 2; if (b(u, x1, x2) < t) lo = u; else hi = u; }
    return b(u, y1, y2);
  };
}
const RB_STATES = ["dashed", "waiting", "empty", "progress-25", "progress-50", "progress-75", "done", "cancelled", "error", "warning"];
const P30 = "rgba(238,238,243,0.38)", P60 = "rgba(238,238,243,0.6)", PL = "rgba(238,238,243,0.86)";
const RB_COLORS = [P30, P60, P60, PL, PL, PL, "#5EC257", P60, "#E36C5A", "#E6BD1F"];
const RB_SHAPES = [[33, 51, 44, 62, 44, 62, 68, 38], [38, 38, 62, 62, 38, 62, 62, 38], [82, 18, 50, 50, 50, 50, 18, 82], [50, 29, 50, 52, 50, 70, 50, 71]];
const rbMix = (a, b, t) => a + (b - a) * t;
const rbBlend = (a, b, t) => a.map((n, i) => rbMix(n, b[i], t));
const rbSpring = n => { const t = clamp01(n); return (1 - (1 + 8 * t) * Math.exp(-8 * t)) / (1 - 9 * Math.exp(-8)); };
const rbEaseInOut = cubicBezier(.42, 0, .58, 1);
function rbScaleAt(elapsed, initial) {
  if (elapsed < 150) return rbMix(initial, .9, rbEaseInOut(clamp01(elapsed / 150)));
  const t = clamp01((elapsed - 150) / 150), clock = t * t * (3 - 2 * t);
  return .9 + .1 * (1 - (1 + 3 * clock) * Math.exp(-3 * clock)) / (1 - 4 * Math.exp(-3));
}
const WAIT_TURN = 300, WAIT_PAUSE = 1000, WAIT_CYCLE = WAIT_TURN + WAIT_PAUSE;
function waitingOffset(elapsed) {
  if (elapsed <= WAIT_PAUSE) return 0;
  const phase = Math.max(0, elapsed - WAIT_PAUSE);
  return -25 * (Math.floor(phase / WAIT_CYCLE) % 4 + rbSpring((phase % WAIT_CYCLE) / WAIT_TURN));
}
function richboxFrame(state) {
  const index = RB_STATES.indexOf(state);
  return {
    points: RB_SHAPES[Math.max(0, index - 6)].slice(),
    reveal: index >= 6 ? [1, 1] : [0, 0],
    colors: RB_STATES.map((_, i) => i === index ? 1 : 0),
    fill: index >= 3 && index <= 5 ? (index - 2) / 4 : 0,
    dash: index === 0 ? 8 : index === 1 ? 21 : 100,
    gap: index === 0 ? 4.5 : index === 1 ? 4 : 0,
    offset: 0, scale: 1, stroke: index === 8 ? 8.5 : 9,
  };
}
function rbInterpolate(a, b, t) {
  return {
    points: rbBlend(a.points, b.points, t), reveal: rbBlend(a.reveal, b.reveal, t), colors: rbBlend(a.colors, b.colors, t),
    fill: rbMix(a.fill, b.fill, t),
    dash: rbMix(a.gap === 0 && b.gap > 0 ? b.dash + b.gap : a.dash, b.gap === 0 && a.gap > 0 ? a.dash + a.gap : b.dash, t),
    gap: rbMix(a.gap, b.gap, t), offset: a.offset, scale: a.scale, stroke: rbMix(a.stroke, b.stroke, t),
  };
}
function rbErase(source, amount) {
  const lengths = [0, 4].map(i => Math.max(.00001, Math.hypot(source.points[i + 2] - source.points[i], source.points[i + 3] - source.points[i + 1])));
  const removed = amount * (lengths[0] * source.reveal[0] + lengths[1] * source.reveal[1]);
  return [Math.max(0, source.reveal[0] - Math.max(0, removed - lengths[1] * source.reveal[1]) / lengths[0]), Math.max(0, source.reveal[1] - removed / lengths[1])];
}
function rbDraw(target, amount) {
  const lengths = [0, 4].map(i => Math.hypot(target.points[i + 2] - target.points[i], target.points[i + 3] - target.points[i + 1]));
  const split = lengths[0] / (lengths[0] + lengths[1]);
  return [clamp01(amount / split), clamp01((amount - split) / (1 - split))];
}
function richboxTransition(source, state) {
  const target = richboxFrame(state);
  const hasSymbol = source.reveal.some(n => n > 0), toSymbol = target.reveal[0] === 1;
  const filling = !hasSymbol && toSymbol && source.fill > 0, erasing = hasSymbol && !toSymbol;
  const duration = filling || erasing ? 550 : 350;
  return {
    duration,
    sample(elapsed) {
      if (elapsed <= 0) return source;
      if (elapsed >= duration) return { ...target, offset: state === "waiting" ? 0 : source.offset };
      const p = rbSpring((elapsed - 150) / 200), scale = rbScaleAt(elapsed, source.scale);
      if (elapsed <= 150) return { ...source, scale };
      if (filling && elapsed < 350) return { ...source, fill: rbMix(source.fill, 1, p), scale };
      if (erasing && elapsed < 350) return { ...source, reveal: rbErase(source, p), scale };
      if (erasing) return { ...rbInterpolate({ ...source, reveal: [0, 0] }, target, rbSpring((elapsed - 350) / 200)), scale };
      if (toSymbol && !hasSymbol) {
        const amount = rbSpring((elapsed - (filling ? 350 : 150)) / 200);
        return { ...rbInterpolate(source, target, amount), points: target.points, fill: 0, reveal: rbDraw(target, amount), scale };
      }
      return { ...rbInterpolate(source, target, p), scale };
    },
  };
}
const RB_OUTLINE = "M50 5 C85 5 95 15 95 50 C95 85 85 95 50 95 C15 95 5 85 5 50 C5 15 15 5 50 5Z";
const RB_INNER = "M50 17 C77 17 83 23 83 50 C83 77 77 83 50 83 C23 83 17 77 17 50 C17 23 23 17 50 17Z";
let rbUid = 0;
function createRichbox(host, size, initial = "dashed") {
  const id = "rb" + (++rbUid);
  host.innerHTML = `<svg viewBox="0 0 100 100" width="${size}" height="${size}" style="display:block;overflow:visible;transform-origin:center" aria-hidden="true">
    <defs><clipPath id="${id}c"><path d="${RB_INNER}"/></clipPath>
    <mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100" style="mask-type:alpha">
      <path class="m0" fill="none" stroke="white" stroke-linecap="round" pathLength="1" stroke-dasharray="1"/>
      <path class="m1" fill="none" stroke="white" stroke-linecap="round" pathLength="1" stroke-dasharray="1"/></mask></defs>
    <path class="ol" d="${RB_OUTLINE}" fill="none" stroke="currentColor" stroke-width="8.5" stroke-linecap="round" pathLength="100"/>
    <path class="fl" clip-path="url(#${id}c)" fill="currentColor"/>
    <rect x="0" y="0" width="100" height="100" fill="currentColor" mask="url(#${id}m)"/></svg>`;
  const svg = host.firstElementChild, ol = svg.querySelector(".ol"), fl = svg.querySelector(".fl"), m0 = svg.querySelector(".m0"), m1 = svg.querySelector(".m1");
  let frame = richboxFrame(initial), state = initial, raf = 0, timer = 0;
  function color() {
    const entries = frame.colors.map((w, i) => ({ w, c: RB_COLORS[i] })).filter(e => e.w > 0);
    return entries.reduce((res, item, idx) => {
      if (idx === 0) return item.c;
      const sum = entries.slice(0, idx + 1).reduce((t, e) => t + e.w, 0);
      return `color-mix(in srgb, ${res} ${(1 - item.w / sum) * 100}%, ${item.c})`;
    }, entries[0] ? entries[0].c : P30);
  }
  function wedge() {
    const p = Math.min(.99999, frame.fill);
    return `M50 50 L50 -50 A100 100 0 ${p > .5 ? 1 : 0} 1 ${50 + 100 * Math.sin(p * Math.PI * 2)} ${50 - 100 * Math.cos(p * Math.PI * 2)} Z`;
  }
  const seg = i => `M${frame.points[i]} ${frame.points[i + 1]} L${frame.points[i + 2]} ${frame.points[i + 3]}`;
  function render() {
    svg.style.color = color();
    svg.style.transform = `scale(${frame.scale})`;
    ol.setAttribute("stroke-dasharray", `${frame.dash} ${frame.gap}`);
    ol.setAttribute("stroke-dashoffset", frame.offset);
    fl.setAttribute("d", wedge()); fl.setAttribute("opacity", frame.fill > 0 ? 1 : 0);
    [m0, m1].forEach((m, k) => {
      m.setAttribute("d", seg(k * 4)); m.setAttribute("stroke-width", frame.stroke);
      m.setAttribute("stroke-dashoffset", 1 - frame.reveal[k]); m.setAttribute("opacity", frame.reveal[k] > 0 ? 1 : 0);
    });
  }
  function setState(next) {
    state = next; cancelAnimationFrame(raf); clearTimeout(timer); live(id, false);
    if (REDUCED) { frame = richboxFrame(next); render(); return; }
    const source = frame, transition = richboxTransition(source, next);
    const settled = JSON.stringify(source) === JSON.stringify(richboxFrame(next));
    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      if (!settled && elapsed < transition.duration) { frame = transition.sample(elapsed); render(); live(id, true); raf = requestAnimationFrame(tick); return; }
      const waitingTime = elapsed - (settled ? 0 : transition.duration);
      frame = { ...richboxFrame(next), offset: next === "waiting" ? waitingOffset(waitingTime) : source.offset }; render();
      if (next !== "waiting") { live(id, false); return; }
      const phase = Math.max(0, waitingTime - WAIT_PAUSE) % WAIT_CYCLE;
      if (waitingTime < WAIT_PAUSE || phase >= WAIT_TURN) {
        live(id, false);
        timer = setTimeout(tick, waitingTime < WAIT_PAUSE ? WAIT_PAUSE - waitingTime : WAIT_CYCLE - phase); return;
      }
      live(id, true); raf = requestAnimationFrame(tick);
    };
    if (!settled || next === "waiting") tick();
  }
  render();
  if (initial === "waiting") setState("waiting");
  return { setState, get state() { return state; } };
}

/* =====================================================================
   JoiPro — github.com/mishanaer/joipro (MIT © 2026 mishanaer), repurposed.
   Changes for MusiX: no "Pro" — the banner is an album or an achievement, lit by its own
   colours; the rim shine is off by default (the owner's rule: no rendered gloss);
   the dust rises in bursts (on appearing, on touch) and then the canvas sleeps.
   ===================================================================== */
const SHINE_SPEED = 55.2, SHINE_RUNWAY = 53, SHINE_PHASE = 1.6;
const shinePeriod = pw => (pw + SHINE_RUNWAY * 2) / SHINE_SPEED;
function shineOffset(time, pw) { const p = shinePeriod(pw); const ph = (((time + SHINE_PHASE) % p) + p) % p; return -SHINE_RUNWAY + ph * SHINE_SPEED; }
const PARTICLE_LIFE = 0.9, PARTICLE_PEAK = 0.5, PARTICLE_INSET = 14;
function jpHash(index, channel) {
  let v = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(channel + 1, 0xc2b2ae35);
  v = Math.imul(v ^ (v >>> 15), 0x2c1b3c6d); v = Math.imul(v ^ (v >>> 12), 0x297a2d39);
  return ((v ^ (v >>> 15)) >>> 0) / 4294967296;
}
/* Pure function of time, as in the original; `until` stops new particles from being born. */
function particlesAt(time, width, height, count, until) {
  const sx = width - PARTICLE_INSET * 2, sy = height - PARTICLE_INSET * 2;
  if (sx <= 0 || sy <= 0 || !count) return [];
  const rate = count / PARTICLE_LIFE, out = [];
  const first = Math.floor((time - PARTICLE_LIFE) * rate) - 1, lastI = Math.floor(time * rate);
  for (let i = first; i <= lastI; i++) {
    const born = (i + jpHash(i, 0)) / rate;
    if (born > until) continue;
    const age = time - born;
    if (age < 0 || age >= PARTICLE_LIFE) continue;
    const pr = age / PARTICLE_LIFE;
    out.push({ x: PARTICLE_INSET + jpHash(i, 1) * sx, y: PARTICLE_INSET + jpHash(i, 2) * sy - (4 + jpHash(i, 3) * 9) * age * 1.6, r: (0.5 + jpHash(i, 4) * 0.8) * (1 - pr / 2), a: pr < PARTICLE_PEAK ? pr / PARTICLE_PEAK : (1 - pr) / (1 - PARTICLE_PEAK) });
  }
  return out;
}
function bannerPath(width, height, corner = 30, exponent = 2.9, steps = 16) {
  const r = Math.min(corner, width / 2, height / 2), pts = [];
  [[r, r, -1, -1], [width - r, r, 1, -1], [width - r, height - r, 1, 1], [r, height - r, -1, 1]].forEach(([cx, cy, sx, sy], ci) => {
    for (let i = 0; i <= steps; i++) {
      const step = ci % 2 === 1 ? steps - i : i, ang = (step / steps) * (Math.PI / 2);
      pts.push(`${pts.length ? "L" : "M"}${(cx + sx * r * Math.cos(ang) ** (2 / exponent)).toFixed(2)} ${(cy + sy * r * Math.sin(ang) ** (2 / exponent)).toFixed(2)}`);
    }
  });
  return pts.join(" ") + " Z";
}
function createJoiPro(host, { kicker, title, subtitle, action, art, icon, colors, particles = 28, onAction }) {
  host.innerHTML = `<div class="joipro" role="group" aria-label="${title}"><canvas aria-hidden="true"></canvas>
    <div class="jp-card">${art ? `<img src="${art}" alt="">` : `<div class="jp-ico">${icon}</div>`}
    <div><div class="jp-kicker">${kicker}</div><div class="jp-title">${title}</div><div class="jp-sub">${subtitle}</div></div>
    <button class="jp-action" type="button"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg><span>${action}</span></button></div></div>`;
  const root = host.firstElementChild, canvas = root.querySelector("canvas"), btn = root.querySelector(".jp-action");
  root.style.setProperty("--jp1", colors[0]); root.style.setProperty("--jp2", colors[1]);
  const size = { w: 0, h: 0, b: 0, ratio: 1 };
  let clock = 0, until = -1, raf = 0, prev = 0, visible = false, shine = false;
  const name = "joipro" + (++rbUid);
  function render() {
    if (shine) btn.style.setProperty("--joipro-shine", shineOffset(clock, size.b).toFixed(2) + "px");
    const ctx = canvas.getContext("2d");
    ctx.setTransform(size.ratio, 0, 0, size.ratio, 0, 0); ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = "#fff";
    for (const p of particlesAt(clock, size.w, size.h, particles, until)) { ctx.globalAlpha = p.a * .9; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  function frame(now) {
    clock += Math.min(0.05, (now - prev) / 1000); prev = now;
    render();
    const busy = visible && !document.hidden && (shine || clock < until + PARTICLE_LIFE);
    if (busy) raf = requestAnimationFrame(frame); else { raf = 0; live(name, false); }
  }
  function wake() { if (!raf && !REDUCED && visible) { prev = performance.now(); live(name, true); raf = requestAnimationFrame(frame); } }
  function burst(seconds) { until = Math.max(until, clock + seconds); wake(); }
  function measure() {
    size.w = root.offsetWidth; size.h = root.offsetHeight; size.b = btn.offsetWidth; size.ratio = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(size.w * size.ratio); canvas.height = Math.round(size.h * size.ratio);
    root.style.clipPath = `path("${bannerPath(size.w, size.h)}")`;
    render();
  }
  new ResizeObserver(measure).observe(root);
  new IntersectionObserver(([e]) => { const was = visible; visible = e.isIntersecting; if (visible && !was) burst(2.6); }, { threshold: .6 }).observe(root);
  root.addEventListener("pointerdown", () => burst(1.4));
  btn.addEventListener("click", e => { e.stopPropagation(); burst(2.2); root.classList.add("opened"); haptic("confirm"); onAction && onAction(); });
  return {
    setShine(on) { shine = on; root.classList.toggle("shine", on); if (on) wake(); },
    setParticles(n) { particles = n; },
  };
}

/* =====================================================================
   Password — github.com/mishanaer/password (MIT © 2026 mishanaer, from Smintfy/ui-snippet).
   Changes: digits are silent (the keyboard clicks already), Confirm / Reject at the end;
   the check "wave" holds 1.2 s instead of 2 s; the correct code is 123456.
   ===================================================================== */
function createPassword(host, { length = 6, onDone }) {
  host.innerHTML = `<form class="pw" aria-label="Код с сайта" novalidate>
    <div class="pw-shake"><div class="pw-row"><div class="pw-ring"></div><span class="pw-sep" aria-hidden="true"></span>
    <input class="pw-input" inputmode="numeric" autocomplete="one-time-code" aria-label="Код с сайта"></div></div>
    <div class="pw-msg" role="status" aria-live="polite"></div></form>`;
  const form = host.firstElementChild, shake = form.querySelector(".pw-shake"), row = form.querySelector(".pw-row"), ring = form.querySelector(".pw-ring"), sep = form.querySelector(".pw-sep"), input = form.querySelector(".pw-input"), msg = form.querySelector(".pw-msg");
  let value = "", slots = [], timer = 0;
  const W = 42, G = 6, SEP = 18;
  const xAt = i => i * (W + G) + (length === 6 && i >= 3 ? SEP : 0);
  const glyph = ch => ch === null ? '<span class="ph">0</span>' : `<span>${ch}</span>`;
  const enter = { duration: 220, easing: cssVar("--snap") || "ease-out" };
  function swap(slot, ch) {
    const old = slot.el.querySelector("span");
    const show = () => {
      slot.el.insertAdjacentHTML("beforeend", glyph(ch));
      const n = slot.el.lastElementChild;
      if (!REDUCED) n.animate([{ opacity: .25, transform: "translateY(15px)" }, { opacity: 1, transform: "none" }], enter);
    };
    if (old) {
      if (REDUCED) { old.remove(); show(); return; }
      old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, easing: "ease-out" }).onfinish = () => { old.remove(); show(); };
    } else show();
  }
  function build() {
    slots.forEach(s => s.el.remove()); slots = [];
    for (let i = 0; i < length; i++) {
      const el = document.createElement("div"); el.className = "pw-slot"; el.style.transform = `translateX(${xAt(i)}px)`;
      row.insertBefore(el, input);
      const slot = { el, ch: undefined }; slots.push(slot); swap(slot, null); slot.ch = null;
      if (!REDUCED) el.animate([{ opacity: 0, transform: `translate(${xAt(i)}px, 15px)` }, { opacity: 1, transform: `translateX(${xAt(i)}px)` }], { ...enter, delay: i * 40, fill: "backwards" });
    }
    row.style.width = (xAt(length - 1) + W) + "px";
    sep.style.left = (xAt(2) + W + (G + SEP) / 2 - 4) + "px";
    sep.style.opacity = length === 6 ? 1 : 0;
    input.maxLength = length; value = ""; input.value = ""; sync();
  }
  function sync() {
    slots.forEach((s, i) => { const ch = value[i] ?? null; if (ch !== s.ch) { s.ch = ch; swap(s, ch); } });
    ring.style.transform = `translateX(${xAt(Math.min(value.length, length - 1))}px)`;
  }
  function verify() {
    if (timer || value.length !== length) return;
    form.classList.add("verifying"); input.readOnly = true; msg.textContent = "Проверяем код…"; msg.className = "pw-msg";
    timer = setTimeout(() => {
      const ok = value === "123456".slice(0, length);
      if (ok) { msg.textContent = "Телефон привязан"; msg.className = "pw-msg ok"; haptic("confirm"); }
      else {
        msg.textContent = "Код не подошёл. Проверьте его на сайте"; msg.className = "pw-msg bad"; haptic("reject");
        form.classList.add("shaking");
        if (!REDUCED) shake.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }], { duration: 480 }).onfinish = () => form.classList.remove("shaking");
        else form.classList.remove("shaking");
      }
      form.classList.remove("verifying"); input.readOnly = false; timer = 0;
      if (ok) { input.blur(); onDone && setTimeout(onDone, 500); }
      else { value = ""; input.value = ""; sync(); }
    }, 1200);
  }
  input.addEventListener("input", () => {
    if (timer) { input.value = value; return; }
    const next = input.value.replace(/\D/g, "").slice(0, length);
    input.value = next;
    if (next === value) return;
    value = next; msg.textContent = ""; sync();
    if (value.length === length) verify();
  });
  input.addEventListener("focus", () => form.classList.add("focus"));
  input.addEventListener("blur", () => form.classList.remove("focus"));
  form.addEventListener("submit", e => { e.preventDefault(); verify(); });
  build();
  return { focus() { input.focus({ preventScroll: true }); }, reset() { clearTimeout(timer); timer = 0; form.classList.remove("verifying"); input.readOnly = false; msg.textContent = ""; build(); } };
}
