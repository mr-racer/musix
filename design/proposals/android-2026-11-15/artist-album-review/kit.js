// kit.js — the shared layer of the mock, under the names it will have in core/designsystem.
// The base (frame loop, Spring, haptics, icons, toasts, Swap) is the player review's core.js unchanged;
// below it the pieces this round adds: dragScroll, Sheet, MorphMenu, TrackRow, FlyInto, MorphButton,
// revealOnScroll, Hinge, CoverStack, PageFocus, SourceFlight helpers.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const phone = $('#phone');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const fmt = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const still = () => phone.classList.contains('still') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  snap(v) { this.v = this.to = v; this.vel = 0; this.alive = false; this.on && this.on(v, this); const d = this.done; if (d) { this.done = null; d(); } return this; }
  step(dt) {
    if (!this.alive) return false;
    let t = dt;
    while (t > 0) {
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
// MusixSprings: a response (s) and a damping ratio; 1.0 = no bounce, 0.8 only after a throw
const SPR = (resp, z = 1) => { const w = (2 * Math.PI) / resp; return { k: w * w, c: 2 * z * w, m: 1 }; };
const MENU = { k: 320, c: 32, m: 1 };
const SNAP = SPR(0.22, 0.85);
const FLIGHT = SPR(0.42);            // a cover finding its slot
const HINGE = SPR(0.36, 0.9);        // a leaf on its hinge: a hair of settle
const project = (v, rate = 0.998) => (v / 1000) * rate / (1 - rate);
const rubber = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

function tracker() {
  let pts = [];
  return {
    add(x, y) { const t = performance.now(); pts.push({ x, y, t }); while (pts.length > 2 && t - pts[0].t > 90) pts.shift(); },
    vel() {
      if (pts.length < 2) return { x: 0, y: 0 };
      const a = pts[0], b = pts[pts.length - 1], dt = Math.max(1, b.t - a.t) / 1000;
      if (performance.now() - b.t > 80) return { x: 0, y: 0 };      // held still before letting go
      return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
    },
  };
}

/* ---- haptics: HapticCue, only from the finger; Tick ≤ 1 per 45 ms, the rest ≤ 1 per 120 ms ---- */
const HAPTIC = { Tick: [4], ToggleOn: [12], ToggleOff: [7], Threshold: [10], ThresholdOff: [5], Lift: [14], Drop: [9], Confirm: [10, 40, 16], Reject: [18, 50, 18], Press: [8] };
const hchip = $('#hchip');
let hapT = {}, hchipTimer = 0;
function hap(cue) {
  const now = performance.now(), gap = cue === 'Tick' ? 45 : 120;
  if (now - (hapT[cue] || 0) < gap) return;
  hapT[cue] = now;
  try { navigator.vibrate && navigator.vibrate(HAPTIC[cue]); } catch (e) { /* not available */ }
  if (!$('#rvHaptic')?.checked) return;
  hchip.lastElementChild.textContent = cue;
  hchip.classList.add('show');
  clearTimeout(hchipTimer);
  hchipTimer = setTimeout(() => hchip.classList.remove('show'), 700);
}

/* ---- icons: the app's own set (web/src/ui/icons.tsx) ---- */
function icon(name, cls = 'ic') {
  const def = ICONS[name];
  if (!def) return '';
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">` + def.d.map((d, i) =>
    def.fill.includes(i) ? `<path d="${d}" fill="currentColor" stroke="none"/>` : `<path d="${d}" stroke-width="${def.w}"/>`).join('') + '</svg>';
}
function paintIcons(root = document) { for (const el of $$('[data-icon]', root)) { el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)); el.removeAttribute('data-icon'); } }
const PLAY = '<svg class="pp" viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>';
const PAUSE = '<svg class="pp" viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
const EQ = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>';

/* ---- toasts: a stack of up to three over the mini player, 4 s, an action, held under the finger ---- */
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
function swap(host, html) {
  const kids = [...host.children], old = kids.pop();
  for (const stale of kids) stale.remove();
  const next = document.createElement('div');
  next.innerHTML = html;
  if (old && !still()) {
    old.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-5px)' }], { duration: 130, easing: 'ease-in', fill: 'forwards' }).onfinish = () => old.remove();
    next.animate([{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 110, easing: 'cubic-bezier(.22,.9,.3,1)', fill: 'backwards' });
  } else if (old) old.remove();
  host.append(next);
  return next;
}
/* cascade: a short ladder of rises, the whole ladder ≤ 216 ms */
function cascade(nodes, { delay = 0, step = 24, by = 10, dur = 420 } = {}) {
  if (still()) return;
  const n = Math.min(nodes.length, 10), s = n > 1 ? Math.min(step, 216 / (n - 1)) : 0;
  nodes.slice(0, n).forEach((el, i) => el.animate([{ opacity: 0, transform: `translateY(${by}px)` }, { opacity: 1, transform: 'none' }], { duration: dur, delay: delay + i * s, easing: 'cubic-bezier(.22,.9,.3,1)', fill: 'backwards' }));
}
const cap = (node, id) => { try { node.setPointerCapture(id); } catch (e) { /* the pointer is already gone */ } };
// the phone is drawn scaled on a desktop: pointer deltas and rects are divided by this
let zoom = 1;
/** a rect in the phone's own coordinates */
function box(el) {
  const p = phone.getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x: (r.left - p.left) / zoom, y: (r.top - p.top) / zoom, w: r.width / zoom, h: r.height / zoom };
}
/** is the element on screen inside the stage (a flight may land on it) */
function onStage(el) {
  if (!el || !el.isConnected || el.closest('[hidden]')) return false;
  const b = box(el), s = box($('#stage'));
  return b.w > 4 && b.y + b.h > s.y + 34 && b.y < s.y + s.h - 66 && b.x + b.w > 0 && b.x < s.w;
}

/* ---------------- dragScroll: a list under a finger ----------------
   The phone keeps touch-action:none, so a mouse on a desktop scrolls like a finger: the content follows,
   a flick glides on (Apple's 0.998), the edges stretch (rubberBand) and spring back. A tap stays a click:
   the pointer is captured only after 10 px. With onPull a downward drag at the top is handed over
   (PullToDismiss). The wheel is the browser's own. */
function dragScroll(sc, { onPull = null, stretch = true } = {}) {
  // the inner layer is looked up each time: a sheet replaces its content on every open
  const inner = () => sc.firstElementChild || sc;
  let g = null, glide = null, over = 0;
  const overS = new Spring(0, SNAP, (v) => { over = v; inner().style.transform = Math.abs(v) > 0.05 ? `translateY(${v.toFixed(1)}px)` : ''; });
  const max = () => sc.scrollHeight - sc.clientHeight;
  sc.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    if (glide) { glide(); glide = null; }
    overS.alive = false;
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, top0: sc.scrollTop, on: false, pull: false, tk: tracker(), over0: over };
    g.tk.add(e.clientX / zoom, e.clientY / zoom);
  });
  sc.addEventListener('pointermove', (e) => {
    if (!g || g.id !== e.pointerId) return;
    const dx = (e.clientX - g.x0) / zoom, dy = (e.clientY - g.y0) / zoom;
    g.tk.add(e.clientX / zoom, e.clientY / zoom);
    if (!g.on) {
      if (Math.hypot(dx, dy) < 10) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.2) { g = null; return; }      // sideways is not a scroll
      g.on = true; g.slop = Math.sign(dy) * 10; cap(sc, e.pointerId);
      sc.dispatchEvent(new CustomEvent('dragstart-mx', { bubbles: true }));
      g.pull = !!onPull && sc.scrollTop <= 0 && dy > 0 && Math.abs(over) < 1;
      if (g.pull) onPull.start();
    }
    const d = dy - g.slop;
    if (g.pull) { onPull.move(Math.max(0, d)); return; }
    const pos = g.top0 - d - g.over0, m = max();
    if (pos < 0) { sc.scrollTop = 0; setOver(stretch ? rubber(-pos, M.H) : 0); }
    else if (pos > m) { sc.scrollTop = m; setOver(stretch ? -rubber(pos - m, M.H) : 0); }
    else { sc.scrollTop = pos; setOver(0); }
  });
  const end = (e) => {
    if (!g || g.id !== e.pointerId) return;
    const was = g; g = null;
    if (!was.on) return;
    const v = was.tk.vel().y;
    if (was.pull) { onPull.end(Math.max(0, (e.clientY - was.y0) / zoom - was.slop), v); return; }
    if (Math.abs(over) > 0.5) { overS.v = over; overS.set(0, v * 0.6); return; }
    let vel = -v;                                        // content velocity, px/s
    if (Math.abs(vel) < 60 || still()) return;
    glide = run((dt) => {
      vel *= Math.pow(0.998, dt * 1000);
      const m = max(), next = sc.scrollTop + vel * dt;
      if (next <= 0 || next >= m) {                       // ran into an edge: the stretch takes the rest
        sc.scrollTop = clamp(next, 0, m);
        if (stretch) { overS.v = 0; overS.set(0, next <= 0 ? Math.abs(vel) * 0.5 : -Math.abs(vel) * 0.5); }
        glide = null; return false;
      }
      sc.scrollTop = next;
      if (Math.abs(vel) < 12) { glide = null; return false; }
    });
  };
  function setOver(v) { over = v; overS.v = v; inner().style.transform =Math.abs(v) > 0.05 ? `translateY(${v.toFixed(1)}px)` : ''; }
  sc.addEventListener('pointerup', end); sc.addEventListener('pointercancel', end);
  return { stop() { if (glide) { glide(); glide = null; } }, reset() { overS.snap(0); } };
}

/* ---------------- Sheet + SheetHost ---------------- */
const sheetEl = $('#sheet'), scrimEl = $('#scrim'), sheetBody = $('#sheetBody'), sheetHead = $('#sheetHead');
const sh = { def: null, h: 600, dim: 0.4, over: false };
sh.y = new Spring(0, { k: 260, c: 30, m: 1, eps: 0.05 }, drawSheet);
function drawSheet(y) {
  const o = clamp(1 - y / sh.h);
  sheetEl.style.transform = `translateY(${y.toFixed(1)}px)`;
  scrimEl.style.opacity = (o * sh.dim).toFixed(3);
}
let sheetScroll = null;
/** def: { title, aside, glass: 'deep' | null, dim, build(inner) } */
function openSheet(def) {
  const fresh = !sh.def;
  sh.def = def; sh.dim = def.dim ?? 0.4;
  $('#sheetTitle').textContent = def.title; $('#sheetAside').textContent = def.aside || '';
  sheetBody.innerHTML = '<div class="sc-in"></div>'; sheetBody.scrollTop = 0;
  sheetEl.className = 'sheet live' + (def.glass ? ' lg ' + def.glass : '');
  def.build($('.sc-in', sheetBody));
  paintIcons(sheetEl);
  scrimEl.classList.add('on');
  sheetEl.setAttribute('aria-hidden', 'false');
  sh.h = sheetEl.offsetHeight + 28;
  sh.y.done = null;
  if (fresh) sh.y.snap(sh.h);
  sh.y.set(0);
  if (!sheetScroll) sheetScroll = dragScroll(sheetBody, { stretch: true });
}
function closeSheet(vel = 0) {
  if (!sh.def) return;
  sh.h = sheetEl.offsetHeight + 28;
  sh.y.done = () => { sheetEl.classList.remove('live'); scrimEl.classList.remove('on'); sheetEl.setAttribute('aria-hidden', 'true'); sh.def = null; sheetBody.innerHTML = ''; };
  sh.y.set(sh.h, vel);
  scrimEl.classList.remove('on');
}
scrimEl.addEventListener('click', () => closeSheet());
$('#sheetClose').addEventListener('click', () => closeSheet());
sheetHead.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  sh.h = sheetEl.offsetHeight + 28;
  const y0 = e.clientY, base = sh.y.v, tk = tracker();
  sh.y.alive = false; sh.over = false;
  const move = (ev) => {
    tk.add(ev.clientX / zoom, ev.clientY / zoom);
    let y = base + (ev.clientY - y0) / zoom;
    if (y < 0) y = -rubber(-y, 160);
    sh.y.v = y; drawSheet(y);
    const over = y > sh.h * 0.4; if (over !== sh.over) { sh.over = over; hap(over ? 'Threshold' : 'ThresholdOff'); }
  };
  const up = () => {
    sheetHead.removeEventListener('pointermove', move); sheetHead.removeEventListener('pointerup', up); sheetHead.removeEventListener('pointercancel', up);
    const v = tk.vel().y;
    if (sh.y.v + project(v, 0.992) > sh.h * 0.4) closeSheet(v); else { sh.y.done = null; sh.y.set(0, v); }
  };
  cap(sheetHead, e.pointerId);
  sheetHead.addEventListener('pointermove', move); sheetHead.addEventListener('pointerup', up); sheetHead.addEventListener('pointercancel', up);
});

/* ---------------- MorphMenu: a panel that grows out of what was touched (+ glass) ---------------- */
const menuEl = $('#menu'), menuIn = $('#menuIn'), mscrim = $('#mscrim');
const mn = { open: false, r: null, onClose: null, r0: 20 };
const mm = new Spring(0, MENU, (v) => {
  if (!mn.r) return;
  const t = Math.max(0, v), q = 1 - t, R = mn.r, r = lerp(mn.r0, 22, clamp(t));
  menuEl.style.clipPath = `inset(${(R.t * q).toFixed(1)}px ${(R.r * q).toFixed(1)}px ${(R.b * q).toFixed(1)}px ${(R.l * q).toFixed(1)}px round ${r.toFixed(1)}px)`;
  menuIn.style.opacity = clamp((t - 0.35) / 0.45).toFixed(3);
  mscrim.style.opacity = (clamp(t) * mn.dim).toFixed(3);
  menuEl.style.opacity = clamp(t * 6).toFixed(3);
});
/** openMorph(src, html, { glass: 'deep' | null, width, place(b, w, h) → {x, y}, dim, onOpen(root) }) */
function openMorph(src, html, opt = {}) {
  if (mn.open) closeMorph(true);
  menuIn.innerHTML = html; paintIcons(menuIn);
  menuEl.className = 'menu live' + (opt.glass ? ' lg ' + opt.glass : '');
  menuEl.style.width = (opt.width || 300) + 'px';
  menuEl.style.clipPath = 'inset(50%)';
  const b = box(src), mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
  const p = opt.place ? opt.place(b, mw, mh) : { x: clamp(b.x, 10, M.W - mw - 10), y: clamp(b.y + b.h - mh, 40, M.H - mh - 10) };
  menuEl.style.left = p.x + 'px'; menuEl.style.top = p.y + 'px';
  const ins = (v) => Math.max(0, v);
  mn.r = { t: ins(b.y - p.y), l: ins(b.x - p.x), r: ins(p.x + mw - (b.x + b.w)), b: ins(p.y + mh - (b.y + b.h)) };
  mn.r0 = Math.min(b.h / 2, 24); mn.dim = opt.dim ?? 0.28; mn.onClose = opt.onClose || null;
  mscrim.classList.add('on');
  mn.open = true; mm.done = null; mm.set(1);
  opt.onOpen && opt.onOpen(menuIn);
}
function closeMorph(now = false) {
  if (!mn.open) return; mn.open = false;
  mscrim.classList.remove('on');
  const f = mn.onClose; mn.onClose = null; f && f();
  mm.done = () => { menuEl.classList.remove('live'); menuIn.innerHTML = ''; };
  if (now) mm.snap(0); else mm.set(0);
}
mscrim.addEventListener('click', () => closeMorph());

/* ---------------- TrackRow + EQ ----------------
   48 dp: the number (EQ when it plays) · the title and feat in one line · the fire on the most played ·
   a dot on one not heard yet · the time · «Играть следующим», which becomes the place in the queue. */
const HOT = '<svg class="hot" viewBox="0 0 24 24" aria-label="слушаешь чаще всего"><path d="M12 2.5c.6 3.2 2.3 4.9 3.9 6.6C17.6 10.9 19 12.8 19 15.5A7 7 0 0 1 5 15.5c0-2.2 1-3.9 2.4-5.1.2 1.7 1 2.8 2.2 3.4C9.1 9.7 10.2 5.7 12 2.5Z"/></svg>';
function trackRow(t, { no = '', hot = false, isNew = false, sub = '', art = '', queued = 0 } = {}) {
  return `<div class="trow${art ? ' two' : ''}" data-id="${esc(t.id)}" role="button" tabindex="0" aria-label="${esc(t.t)}">`
    + (art ? `<span class="art"><img src="${art}" alt="" loading="lazy"></span>` : `<span class="no">${isNew ? '<i class="new"></i>' : ''}<span class="nn">${no}</span>${EQ}</span>`)
    + `<span class="tt"><b>${esc(t.t)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>`
    + (hot ? HOT : '') + `<span class="d">${fmt(t.d)}</span>`
    + `<button class="qn${queued ? ' on' : ''}" aria-label="${queued ? `В очереди ${queued}-й — убрать` : 'Играть следующим'}">${icon('QueueNext')}<i>${queued || ''}</i></button></div>`;
}

/* ---------------- FlyInto: a copy of the words flies an arc into its target ----------------
   x and y run on two layers with two easings, which is what makes the path an arc. */
function flyWord(fromEl, text, toEl, { lift = 46, dur = 620, onLand } = {}) {
  const a = box(fromEl), b = box(toEl);
  if (still()) { onLand && onLand(); return; }
  const fx = document.createElement('div'), fy = document.createElement('div');
  fx.className = 'flyer'; fy.className = 'flyer word'; fy.style.position = 'relative';
  const cs = getComputedStyle(fromEl);
  fy.style.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; fy.style.color = cs.color; fy.style.letterSpacing = cs.letterSpacing;
  fy.textContent = text; fx.append(fy); phone.append(fx);
  const w = fy.offsetWidth, h = fy.offsetHeight, s = 0.34;
  const x0 = a.x, y0 = a.y + (a.h - h) / 2, x1 = b.x + b.w / 2 - (w * s) / 2, y1 = b.y + b.h / 2 - (h * s) / 2;
  const top = Math.min(y0, y1) - lift;
  fx.animate([{ transform: `translateX(${x0}px)` }, { transform: `translateX(${x1}px)` }], { duration: dur, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' });
  fy.animate([
    { transform: `translateY(${y0}px) scale(1)`, opacity: 1, offset: 0 },
    { transform: `translateY(${top}px) scale(.8)`, opacity: 1, offset: 0.42, easing: 'cubic-bezier(.5,0,.9,.6)' },
    { transform: `translateY(${y1}px) scale(${s})`, opacity: 0.85, offset: 0.94 },
    { transform: `translateY(${y1}px) scale(${s * 0.6})`, opacity: 0, offset: 1 },
  ], { duration: dur, easing: 'cubic-bezier(.2,.5,.4,1)', fill: 'forwards' }).onfinish = () => fx.remove();
  setTimeout(() => onLand && onLand(), dur - 80);
}

/* ---------------- MorphButton: one control, two states, the content flows, the size holds ---------------- */
function playLabel(on, [a, b] = ['Слушать', 'Пауза']) { return on ? `${EQ}<span>${b}</span>` : `${PLAY}<span>${a}</span>`; }
function setPlayButton(btn, on, labels) {
  const k = on ? '1' : '0';
  if (btn.dataset.on === k) return;
  const first = btn.dataset.on == null;
  btn.dataset.on = k; btn.classList.toggle('playing', on);
  btn.setAttribute('aria-label', on ? (labels?.[1] || 'Пауза') : (labels?.[0] || 'Слушать'));
  if (first || still()) { btn.innerHTML = `<div class="mb-in">${playLabel(on, labels)}</div>`; return; }
  const d = swap(btn, playLabel(on, labels)); d.className = 'mb-in';
}

/* ---------------- revealOnScroll: a head that comes in once the hero has gone ----------------
   It watches a state (is the hero above the line?), not every frame: Compose `derivedStateOf`. */
function revealOnScroll(sc, line, onChange) {
  let on = false;
  const check = () => { const v = sc.scrollTop > line(); if (v !== on) { on = v; onChange(on); } };
  sc.addEventListener('scroll', check, { passive: true });
  return { check, get on() { return on; }, reset() { on = false; onChange(false); } };
}

/* ---------------- Hinge: a leaf that opens down from its top edge ----------------
   Only rotateX in perspective (a transform) and the opacity of its own shade; folded the leaf lies
   edge-on into the screen, so nothing ever crosses the camera. */
class Hinge {
  constructor(leaf, shade) { this.leaf = leaf; this.shade = shade; this.s = new Spring(1, HINGE, (v) => this.draw(v)); }
  draw(h) {
    const a = (1 - h) * -90;
    this.leaf.style.transform = Math.abs(a) > 0.04 ? `perspective(1200px) rotateX(${a.toFixed(2)}deg)` : '';
    this.shade.style.opacity = clamp((1 - h) * 1.25).toFixed(3);
    this.leaf.style.visibility = h < 0.004 ? 'hidden' : '';
  }
  open(vel) { this.s.set(1, vel); return this; }
  fold(vel) { this.s.set(0, vel); return this; }
  snap(v) { this.s.snap(v); return this; }
}

/* ---------------- CoverStack: a fan of covers; the finger lifts one, Tick on each, let go = pick ---------------- */
function coverStack(host, items, { size = 92, onPick } = {}) {
  host.classList.add('stack'); host.style.setProperty('--sz', size + 'px');
  host.innerHTML = `<span class="stack-name"></span>` + items.map((it, i) => `<span class="sc" data-i="${i}"><img src="${it.img}" alt="${esc(it.name)}"></span>`).join('');
  const cards = $$('.sc', host), name = $('.stack-name', host), n = items.length;
  let W = 0, step = 0, held = -1, lift = [];
  const springs = cards.map((c, i) => new Spring(0, SPR(0.3, 0.86), (v) => draw(i, v)));
  function layout() {
    W = host.clientWidth;
    if (!W) { requestAnimationFrame(layout); return; }           // not laid out yet: measure on the next frame
    step = n > 1 ? Math.min(size * 0.72, (W - size) / (n - 1)) : 0;
    cards.forEach((c, i) => draw(i, springs[i].v));
  }
  function draw(i, v) {
    const base = i * step, spread = held < 0 ? 0 : (i < held ? -1 : i > held ? 1 : 0) * Math.min(14, step * 0.4) * Math.max(...springs.map((s) => s.v));
    const tilt = (i - (n - 1) / 2) * (held < 0 ? 1.2 : 0.6);
    cards[i].style.transform = `translateX(${(base + spread).toFixed(1)}px) translateY(${(-16 * v).toFixed(1)}px) rotate(${(tilt * (1 - v)).toFixed(2)}deg) scale(${(1 + 0.08 * v).toFixed(3)})`;
    cards[i].style.zIndex = held === i ? 50 : i;
  }
  function at(x) { return clamp(Math.floor((x - (step ? 0 : 0)) / Math.max(1, step)), 0, n - 1); }
  function hold(i) {
    if (i === held) return;
    held = i; hap('Tick');
    springs.forEach((s, j) => s.set(j === i ? 1 : 0));
    const it = items[i];
    name.innerHTML = `${esc(it.name)}<small>${it.year || ''}</small>`;
    const x = clamp(i * step + size / 2 - name.offsetWidth / 2, 0, W - name.offsetWidth);
    name.style.transform = `translateX(${x.toFixed(1)}px)`;
  }
  function letGo() { held = -1; host.classList.remove('held'); springs.forEach((s) => s.set(0)); }
  host.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); cap(host, e.pointerId); host.classList.add('held');
    const r = box(host);
    hold(at((e.clientX - phone.getBoundingClientRect().left) / zoom - r.x));
    const move = (ev) => hold(at((ev.clientX - phone.getBoundingClientRect().left) / zoom - r.x));
    const up = (ev) => {
      host.removeEventListener('pointermove', move); host.removeEventListener('pointerup', up); host.removeEventListener('pointercancel', up);
      const i = held; letGo();
      if (ev.type === 'pointerup' && i >= 0) onPick && onPick(i, cards[i]);
    };
    host.addEventListener('pointermove', move); host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
  });
  layout();
  return { layout, cards };
}

/* ---------------- PageFocus: the shell's change of page, as on the web, with the blur ----------------
   forward: the old page steps back into the blur, the new one comes out of it; back — the other way. */
function pageFocus(from, to, back = false, dur = 380) {
  to.hidden = false;
  if (!from || from === to) return;
  if (still()) { from.hidden = true; return; }
  const k = back ? 1.035 : 0.965, k2 = back ? 0.965 : 1.035;
  from.style.zIndex = 1; to.style.zIndex = 2;
  from.animate([{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: `scale(${k})`, filter: 'blur(8px)' }], { duration: dur * 0.7, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
    .onfinish = (e) => { from.hidden = true; from.style.zIndex = ''; e.target.cancel(); };
  to.animate([{ opacity: 0, transform: `scale(${k2})`, filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: dur, delay: dur * 0.18, easing: 'cubic-bezier(.22,.9,.3,1)', fill: 'backwards' })
    .onfinish = () => { to.style.zIndex = ''; };
}

/* ---------------- SourceFlight helpers ----------------
   «what was touched is what flies»: a picture becomes the picture (sharedElement), a word becomes the
   word (sharedBounds + the text's scale). These two return the transform that puts a target where its
   source is, so the target itself can travel (no copy, no blank frame). */
function fromRect(target, src) {
  const s = src.w / target.w;
  return { x: src.x - target.x, y: src.y - target.y, s };
}
const tf = (x, y, s) => `translate(${x.toFixed(2)}px,${y.toFixed(2)}px) scale(${s.toFixed(4)})`;
