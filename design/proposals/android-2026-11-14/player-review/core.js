// Shared pieces of the mock: the frame loop that parks at rest, springs that keep velocity,
// the haptic vocabulary, icons, toasts. Stand-ins for core/designsystem of the Android app.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const phone = $('#phone');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const fmt = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const still = () => phone.classList.contains('still') || matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---- one frame loop; nothing runs while nothing moves (the «0 кадров в покое» rule) ---- */
const live = new Set();
let rafId = 0, lastT = 0;
const meterEl = $('#rvMeter');
let fpsN = 0, fpsT = 0, fpsLast = 0, fpsWorst = 0;
function frame(now) {
  const raw = now - lastT, dt = Math.min(0.034, raw / 1000) || 0.016;
  lastT = now;
  for (const f of live) if (f(dt, now) === false) live.delete(f);
  rafId = live.size ? requestAnimationFrame(frame) : 0;
  // the measured rate of the frames that were drawn, and the longest gap between two of them
  fpsN++; if (raw < 200) fpsWorst = Math.max(fpsWorst, raw);
  if (now - fpsT >= 500) { fpsLast = Math.round(fpsN * 1000 / (now - fpsT)); setMeter(fpsWorst); fpsN = 0; fpsT = now; fpsWorst = 0; }
  if (!rafId) setMeter();
}
function run(f) {
  live.add(f);
  if (!rafId) { lastT = fpsT = performance.now(); fpsN = 0; fpsWorst = 0; rafId = requestAnimationFrame(frame); setMeter(); }
  return () => live.delete(f);
}
function setMeter(worst) {
  if (!meterEl) return;
  meterEl.classList.toggle('on', !!rafId);
  meterEl.lastElementChild.textContent = rafId ? `Кадры: ${fpsLast || '…'} в секунду${worst ? ` · худший ${worst.toFixed(1)} мс` : ''}` : `Кадры: покой${fpsLast ? ` · было ${fpsLast} в секунду` : ''}`;
}

/* ---- a spring that is re-targeted from where it is, with the velocity it has ---- */
class Spring {
  constructor(v = 0, { k = 240, c = 25, m = 1.15, eps = 0.01 } = {}, on = null) {
    Object.assign(this, { v, to: v, vel: 0, k, c, m, eps, on, alive: false });
    this.step = this.step.bind(this);
  }
  set(to, vel) {
    this.to = to;
    if (vel != null) this.vel = vel;
    if (still()) return this.snap(to);
    if (!this.alive) { this.alive = true; run(this.step); }
    return this;
  }
  snap(v) { this.v = this.to = v; this.vel = 0; this.alive = false; this.on && this.on(v, this); this.done && this.done(); return this; }
  step(dt) {
    if (!this.alive) return false;
    let t = dt;
    while (t > 0) {                       // 4 ms sub-steps keep stiff springs stable
      const h = Math.min(0.004, t); t -= h;
      const a = (-this.k * (this.v - this.to) - this.c * this.vel) / this.m;
      this.vel += a * h; this.v += this.vel * h;
    }
    if (Math.abs(this.v - this.to) < this.eps && Math.abs(this.vel) < this.eps * 20) {
      this.v = this.to; this.vel = 0; this.alive = false; this.on && this.on(this.v, this);
      const d = this.done; if (d) { this.done = null; d(); }
      return false;
    }
    this.on && this.on(this.v, this);
  }
}
const SOFT = { k: 240, c: 25, m: 1.15 };          // the owner's cover spring (Dream «Б · мягкая, с весом»)
const MENU = { k: 320, c: 32, m: 1 };             // MusixSprings.menu
const CRIT = (resp) => { const w = (2 * Math.PI) / resp; return { k: w * w, c: 2 * w, m: 1 }; };   // critically damped
const SNAP = (() => { const w = (2 * Math.PI) / 0.22; return { k: w * w, c: 2 * 0.85 * w, m: 1 }; })();
const SETTLE = (() => { const w = (2 * Math.PI) / 0.35; return { k: w * w, c: 2 * 0.7 * w, m: 1 }; })();

// Apple's momentum projection: where a flick would come to rest
const project = (v, rate = 0.998) => (v / 1000) * rate / (1 - rate);
const rubber = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

/* velocity of a pointer from its last ~80 ms */
function tracker() {
  let pts = [];
  return {
    add(x, y) { const t = performance.now(); pts.push({ x, y, t }); while (pts.length > 2 && t - pts[0].t > 90) pts.shift(); },
    vel() {
      if (pts.length < 2) return { x: 0, y: 0 };
      const a = pts[0], b = pts[pts.length - 1], dt = Math.max(1, b.t - a.t) / 1000;
      return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
    },
    reset() { pts = []; },
  };
}

/* ---- haptics: nine cues, only from the finger; Tick ≤ 1 per 45 ms, the rest ≤ 1 per 120 ms ---- */
const HAPTIC = { Tick: [4], ToggleOn: [12], ToggleOff: [7], Threshold: [10], ThresholdOff: [5], Lift: [14], Drop: [9], Confirm: [10, 40, 16], Reject: [18, 50, 18] };
const hchip = $('#hchip');
let hapT = {}, hchipTimer = 0;
function hap(cue) {
  const now = performance.now(), gap = cue === 'Tick' ? 45 : 120;
  if (now - (hapT[cue] || 0) < gap) return;
  hapT[cue] = now;
  try { navigator.vibrate && navigator.vibrate(HAPTIC[cue]); } catch (e) { /* not available */ }
  if (!$('#rvHaptic').checked) return;
  hchip.lastElementChild.textContent = cue;
  hchip.classList.add('show');
  clearTimeout(hchipTimer);
  hchipTimer = setTimeout(() => hchip.classList.remove('show'), 700);
}

/* ---- icons: the app's own set (web/src/ui/icons.tsx) plus two that the phone needs ---- */
ICONS.Queue = { d: ['M3 6h18', 'M3 12h18', 'M3 18h12'], w: 2, fill: [] };
ICONS.ArrowUp = { d: ['M5 12h14', 'm13 6 6 6-6 6'], w: 2, fill: [] };
function icon(name, cls = 'ic') {
  const def = ICONS[name];
  if (!def) return '';
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">` + def.d.map((d, i) =>
    def.fill.includes(i) ? `<path d="${d}" fill="currentColor" stroke="none"/>` : `<path d="${d}" stroke-width="${def.w}"/>`).join('') + '</svg>';
}
function glyph(key) {
  const shape = GLYPHS.shapes[GLYPHS.by[key]] || GLYPHS.shapes.NOTE;
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + shape.map((p) => p.fill ? `<path d="${p.d}" fill="currentColor" stroke="none"/>` : `<path d="${p.d}"/>`).join('') + '</svg>';
}
function paintIcons(root = document) { for (const el of $$('[data-icon]', root)) { el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)); el.removeAttribute('data-icon'); } }
const PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';

/* ---- toasts: a stack of up to three over the tray, 4 s, an action, held under the finger ---- */
const toastsEl = $('#toasts');
function toast(text, action, onAction) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(text)}</span>` + (action ? `<button>${esc(action)}</button>` : '');
  toastsEl.append(el);
  const all = $$('.toast:not(.out)', toastsEl);
  all.forEach((t, i) => { const d = all.length - 1 - i; t.style.transform = d ? `translateY(${-d * 9}px) scale(${1 - d * 0.06})` : ''; t.style.opacity = d > 2 ? 0 : ''; });
  let timer = setTimeout(close, 4000);
  function close() { el.classList.add('out'); setTimeout(() => el.remove(), 240); }
  el.addEventListener('pointerdown', () => clearTimeout(timer));
  el.addEventListener('pointerup', () => { timer = setTimeout(close, 1600); });
  if (action) el.lastElementChild.addEventListener('click', () => { hap('Confirm'); onAction && onAction(); close(); });
  return close;
}

/* ---- Swap: the old content leaves fast, the new one arrives after it, in place ---- */
function swap(host, html, cls = '') {
  const kids = [...host.children], old = kids.pop();
  for (const stale of kids) stale.remove();                    // a third swap in a row must not leave the middle one behind
  const next = document.createElement('div');
  next.innerHTML = html;
  host.className = host.className.replace(/\bplain\b/g, '').trim() + (cls ? ' ' + cls : '');
  if (old && !still()) {
    old.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-5px)' }], { duration: 130, easing: 'ease-in', fill: 'forwards' }).onfinish = () => old.remove();
    next.animate([{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 110, easing: 'cubic-bezier(.22,.9,.3,1)', fill: 'backwards' });
  } else if (old) old.remove();
  host.append(next);
  return next;
}
const rise = (el, delay = 120, by = 10) => { if (!still()) el.animate([{ opacity: 0, transform: `translateY(${by}px)` }, { opacity: 1, transform: 'none' }], { duration: 480, delay, easing: 'cubic-bezier(.22,.9,.3,1)', fill: 'backwards' }); };

/* a tap that does not fire after a drag, with the 10 px hysteresis */
function onTap(el, fn) {
  let sx = 0, sy = 0, ok = false;
  el.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; ok = true; });
  el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) ok = false; });
  el.addEventListener('click', (e) => { if (ok || e.detail === 0) fn(e); });
}
const cap = (node, id) => { try { node.setPointerCapture(id); } catch (e) { /* the pointer is already gone */ } };
// the phone is drawn scaled on a desktop: pointer deltas are divided by this
let zoom = 1;
