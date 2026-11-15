// The player itself: the stage (cover / text / sound), the seek line, reactions, the fold into the mini player.
const T = DATA.tracks;
const st = {
  q: T.map((_, i) => ({ k: 'q' + i, ti: i })), qi: 0, playing: true, pos: 37, mode: 'cover', scene: 'ready',
  fire: new Set(), water: new Set(), added: new Map(), shuffle: false, remain: false, viz: 'stage', pick: null, turn: 'page', lyrics: 'static',
};
let keyN = 100;
const cur = () => T[st.q[st.qi].ti];
const trackAt = (i) => (i >= 0 && i < st.q.length ? T[st.q[i].ti] : null);
const snd = (t = cur()) => (st.scene === 'nosound' ? null : t.sound);
const blocked = () => ['loading', 'error', 'elsewhere', 'empty'].includes(st.scene);

const el = Object.fromEntries(['player', 'pl', 'backdrop', 'stage', 'flipper', 'track', 'soundface', 'sfViz', 'sfScales', 'lyricsFace', 'lyList', 'burst', 'sidePP',
  'hint', 'veil', 'modes', 'lens', 'title', 'artist', 'album', 'slot', 'reason', 'reasonText', 'seek', 'moments', 'blocks', 'wave', 'wavePath', 'thumb', 'bubble', 'mlabel',
  'sec', 'secName', 'elapsed', 'duration', 'fire', 'water', 'shuffle', 'ask', 'tray', 'stack', 'nextTitle', 'queueCount', 'topMid', 'addBtn', 'collapse', 'top',
  'stub', 'stubPage', 'mini', 'miniArt', 'miniTitle', 'miniArtist', 'miniPlay', 'miniLine', 'empty', 'emptyPlay'].map((id) => [id, $('#' + id)]));
let M = { W: 412, H: 915, cover: 372, step: 398, seekW: 364, lines: 2 };
const pt = (e) => { const r = phone.getBoundingClientRect(); return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom }; };
const box = (node) => { const r = node.getBoundingClientRect(), p = phone.getBoundingClientRect(); return { x: (r.left - p.left) / zoom, y: (r.top - p.top) / zoom, w: r.width / zoom, h: r.height / zoom }; };

/* ================= the cover carousel ================= */
const cards = [-1, 0, 1].map((slot) => {
  const node = document.createElement('div');
  node.className = 'card';
  node.innerHTML = `<div class="art"><img class="sharp" alt="" draggable="false"><img class="soft" alt="" draggable="false"><i class="shade"></i><span class="ppi lg on-art">${PLAY}</span></div>`;
  el.track.append(node);
  return { node, slot, ti: -1, shade: node.querySelector('.shade') };
});
const center = () => cards.find((c) => c.slot === 0);
function fill(card, t) {
  card.node.style.visibility = t ? '' : 'hidden';
  if (!t || card.t === t) return;
  card.t = t;
  $('.sharp', card.node).src = t.cover; $('.soft', card.node).src = t.soft || t.cover;
}
/** The out-of-focus copy of a cover is drawn once into a small picture: a live blur filter on a moving
 *  layer is what costs frames. */
function bake(t) {
  return new Promise((done) => {
    const img = new Image();
    img.onload = () => {
      const make = (dim) => {
        const c = document.createElement('canvas'); c.width = c.height = 96;
        const x = c.getContext('2d');
        x.filter = `blur(4px) brightness(${dim}) saturate(1.15)`;
        x.drawImage(img, -10, -10, 116, 116);
        return c.toDataURL('image/jpeg', 0.82);
      };
      try { t.soft = make(0.72); t.dark = make(0.42); } catch (e) { /* keeps the sharp cover */ }
      done();
    };
    img.onerror = done; img.src = t.cover;
  });
}
const sx = new Spring(0, SOFT, layout);                       // how far the change has gone, in px of the finger
const press = new Spring(1, { k: 520, c: 26, m: 1, eps: 0.0005 }, layout);
const pauseS = new Spring(1, { k: 200, c: 18, m: 1, eps: 0.0005 }, layout);
const tiltX = new Spring(0, { k: 300, c: 24, m: 1, eps: 0.005 }, layout), tiltY = new Spring(0, { k: 300, c: 24, m: 1, eps: 0.005 }, layout);
const travel = () => (st.turn === 'page' ? M.cover : M.step);
const commitAt = () => travel() * (st.turn === 'page' ? 0.3 : 0.42);   // a page is let go once it stands past ~45°
function setTurn(kind) {
  st.turn = kind; phone.dataset.turn = kind;
  Object.assign(sx, kind === 'page' ? CRIT(0.42) : SOFT);       // a page settles without a wobble; the carousel keeps its soft spring
  sx.snap(0);
  for (const c of cards) { c.node.style.transformOrigin = ''; c.shade.style.opacity = 0; }
  layoutNow();
}
let layQ = false;
function layout() { if (!layQ) { layQ = true; run(layFlush); } }
function layFlush() { layQ = false; layoutNow(); return false; }
const restPose = () => `translate3d(0,${((1 - press.v) * -60).toFixed(2)}px,0) scale(${(press.v * pauseS.v).toFixed(4)}) rotateX(${tiltX.v.toFixed(2)}deg) rotateY(${tiltY.v.toFixed(2)}deg)`;
function layoutNow() {
  if (st.turn === 'page') return layoutPage();
  for (const c of cards) {
    const off = c.slot * M.step + sx.v, far = clamp(Math.abs(off) / M.step), mid = c.slot === 0;
    const s = lerp(1, 0.9, far) * (mid ? press.v * pauseS.v : 1);
    c.node.style.transform = `translate3d(${off.toFixed(2)}px,${mid ? (1 - press.v) * -60 : 0}px,0) scale(${s.toFixed(4)})` + (mid ? ` rotateX(${tiltX.v.toFixed(2)}deg) rotateY(${tiltY.v.toFixed(2)}deg)` : '');
    c.node.style.opacity = mid ? 1 : clamp(Math.abs(sx.v) / 46).toFixed(3);     // neighbours do not stick out at rest
    c.node.style.zIndex = mid ? 2 : 1;
  }
}
/** «Перелист»: the sleeve is hinged on its left edge and its free edge stays under the finger (the angle is
 *  the arc cosine of what is left of the width). The next cover already lies beneath and comes up into the light.
 *  Going back, the previous sleeve unfolds from the hinge and closes over the current one. */
function layoutPage() {
  const W = M.cover, x = sx.v, d = Math.min(W, Math.abs(x)), p = d / W, moving = d > 0.05;
  const door = x < 0 ? 0 : -1, under = x < 0 ? 1 : 0;
  for (const c of cards) {
    const n = c.node;
    if (moving && c.slot === door) {
      const th = Math.acos(clamp(x < 0 ? 1 - p : p)) * 57.2958;
      n.style.transformOrigin = '0 50%';
      n.style.transform = `rotateY(${th.toFixed(2)}deg)`;
      n.style.opacity = clamp((90 - th) / 8).toFixed(3);
      n.style.zIndex = 3; c.shade.style.opacity = (Math.sin(th / 57.2958) * 0.62).toFixed(3);
    } else if (moving && c.slot === under) {
      const open = x < 0 ? p : 1 - p;                          // how much of it is out from under the sleeve
      n.style.transformOrigin = '';
      n.style.transform = `scale(${lerp(0.93, 1, open).toFixed(4)})`;
      n.style.opacity = 1; n.style.zIndex = 1; c.shade.style.opacity = ((1 - open) * 0.58).toFixed(3);
    } else if (c.slot === 0) {
      n.style.transformOrigin = ''; n.style.transform = restPose(); n.style.opacity = 1; n.style.zIndex = 2; c.shade.style.opacity = 0;
    } else { n.style.opacity = 0; n.style.zIndex = 0; n.style.transform = ''; c.shade.style.opacity = 0; }
  }
}
/* the light of the screen follows the finger: the next song's backdrop comes up as far as the change has gone */
let bdPeek = null;
function peekBackdrop(dir, amount) {
  const t = trackAt(st.qi + dir); if (!t) return;
  const layers = $$('i', el.backdrop), on = layers.find((l) => l.classList.contains('on')), other = layers.find((l) => l !== on);
  if (!bdPeek || bdPeek.dir !== dir) { other.style.backgroundImage = `url(${t.bg})`; bdPeek = { dir, layer: other }; }
  other.style.transition = 'none'; other.style.zIndex = 2;    // over the current light, which stays whole beneath
  other.style.opacity = (clamp(amount) * (phone.dataset.theme === 'light' ? 0.2 : 1)).toFixed(3);
}
function endPeek() {
  if (!bdPeek) return;
  const l = bdPeek.layer; bdPeek = null;
  l.style.transition = 'opacity .35s ease'; l.style.opacity = '';
  setTimeout(() => { if (!bdPeek || bdPeek.layer !== l) { l.style.zIndex = ''; l.style.transition = ''; } }, 380);
}
/* the backdrops are decoded before the first swipe: a picture decoded under the finger is a missed frame */
const warm = [];
function warmBackdrops() { for (const t of T) { const im = new Image(); im.src = t.bg; if (im.decode) im.decode().catch(() => {}); warm.push(im); } }
function markCenter() {
  for (const c of cards) {
    c.node.classList.toggle('center', c.slot === 0);
    c.node.classList.toggle('paused', c.slot === 0 && !st.playing && !blocked());
    c.node.classList.toggle('dim', c.slot === 0 && st.mode === 'sound');
  }
}
function refill() {
  for (const c of cards) fill(c, trackAt(st.qi + c.slot));
  markCenter(); layoutNow();
}
/** dir +1 next, −1 previous. The arriving card is the same element all the way. */
function go(dir, vel = 0, from = 'tap') {
  const ni = st.qi + dir;
  if (ni < 0 || ni >= st.q.length) {                          // the end of the queue: a nudge against the edge
    if (dir < 0 && st.pos > 3) { st.pos = 0; drawSeek(true); }
    if (from !== 'swipe') { hap('Reject'); sx.set(0, -dir * 700); } else sx.set(0, vel);
    return false;
  }
  st.qi = ni;
  for (const c of cards) c.slot -= dir;
  const far = cards.find((c) => Math.abs(c.slot) === 2);
  far.slot = dir; fill(far, trackAt(st.qi + dir));
  sx.v += dir * travel();                                     // same picture, new roles
  sx.set(0, vel);
  st.pos = 0;
  markCenter(); showTrack(dir);
  return true;
}
function jump(i) {
  if (i === st.qi || !trackAt(i)) return;
  const dir = i > st.qi ? 1 : -1;
  st.qi = i - dir;
  fill(cards.find((c) => c.slot === dir), trackAt(i));
  go(dir);
}

/* one pointer on the stage: tap (pause), sideways (next / previous), down (fold the player) */
let g = null;
const tr = tracker();
el.stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.veil .pill,.ly-cap') || blocked()) return;
  if (st.mode !== 'cover' && !e.target.closest('.soundface,.back')) return;
  const p = pt(e);
  g = { id: e.pointerId, x0: p.x, y0: p.y, dir: null, base: sx.v, over: false, side: e.target.closest('.soundface,.back') };
  sx.alive = false;                                          // grab it mid-flight
  if (!g.side) cap(el.stage, e.pointerId);     // on the text and sound sides a tap belongs to the line or the pool
  tr.reset(); tr.add(p.x, p.y);
  if (st.mode === 'cover') {
    const b = box(el.stage);
    press.set(0.97);
    tiltY.set(((p.x - b.x) / b.w - 0.5) * 6); tiltX.set(-((p.y - b.y) / b.h - 0.5) * 6);
  }
});
el.stage.addEventListener('pointermove', (e) => {
  if (!g || e.pointerId !== g.id) return;
  const p = pt(e), dx = p.x - g.x0, dy = p.y - g.y0;
  tr.add(p.x, p.y); g.dx = dx;
  if (!g.dir) {
    if (Math.hypot(dx, dy) < 10) return;
    g.dir = Math.abs(dx) > Math.abs(dy) ? (st.mode === 'cover' ? 'x' : 'flick') : dy > 0 && st.mode !== 'text' ? 'down' : 'none';   // on the text side a vertical move scrolls the words
    g.sx = dx; g.sy = dy;
    press.set(1); tiltX.set(0); tiltY.set(0);
    if (g.dir === 'down') { fold.grab(); if (g.side) cap(el.stage, e.pointerId); }
  }
  if (g.dir === 'x') {
    let x = g.base + dx - g.sx;
    if ((x > 0 && !trackAt(st.qi - 1)) || (x < 0 && !trackAt(st.qi + 1))) x = rubber(x, M.cover) * (st.turn === 'page' ? 0.5 : 1);
    sx.v = x; layoutNow();
    peekBackdrop(x < 0 ? 1 : -1, Math.abs(x) / travel());
    const over = Math.abs(x) > commitAt();
    if (over !== g.over) { g.over = over; hap(over ? 'Threshold' : 'ThresholdOff'); }
  } else if (g.dir === 'down') fold.drag(dy - g.sy);
});
function stageUp(e) {
  if (!g || e.pointerId !== g.id) return;
  const was = g; g = null;
  press.set(1); tiltX.set(0); tiltY.set(0);
  const v = tr.vel();
  if (!was.dir) {
    const floor = st.mode === 'sound' && !e.target.closest('.pool,.scale');
    if (e.type === 'pointerup' && (!was.side || floor)) togglePlay(true);
    sx.set(0);
  } else if (was.dir === 'x') {
    const land = sx.v + project(v.x, 0.992);
    if (land < -commitAt() && trackAt(st.qi + 1) && e.type === 'pointerup') go(1, v.x, 'swipe');
    else if (land > commitAt() && trackAt(st.qi - 1) && e.type === 'pointerup') go(-1, v.x, 'swipe');
    else { endPeek(); sx.set(0, v.x); }
  } else if (was.dir === 'flick') { if (e.type === 'pointerup' && Math.abs(was.dx) > 56) go(was.dx < 0 ? 1 : -1); }
  else if (was.dir === 'down') fold.release(v.y, e.type === 'pointercancel');
  else sx.set(0);
}
el.stage.addEventListener('pointerup', stageUp);
el.stage.addEventListener('pointercancel', stageUp);
/* no arrows on the screen: the swipe is taught once; the keyboard (and TalkBack actions in the app) keep the way */
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input,select,[role=slider],[role=tab],[role=tablist]') || sh.kind || menuOpen) return;
  if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1);
});

/* ================= play / pause ================= */
const AMP = 3.2;
const amp = new Spring(0, CRIT(0.34), () => drawSeek());
let phase = 0, closedTimer = 0;
function setPlaying(on, user) {
  st.playing = on;
  const ppi = $('.ppi', center().node);
  if (on) { ppi.classList.add('gone'); setTimeout(() => ppi.classList.remove('gone'), 320); }
  markCenter();
  pauseS.set(on || st.mode !== 'cover' ? 1 : 1.03);
  el.sidePP.innerHTML = el.miniPlay.innerHTML = on ? PAUSE : PLAY;
  el.sidePP.setAttribute('aria-label', on ? 'Пауза' : 'Слушать');
  phone.classList.toggle('playing', on && !blocked());
  if (user) { hap(on ? 'ToggleOn' : 'ToggleOff'); hideHint(true); }
  syncMotion();
}
const togglePlay = (user) => setPlaying(!st.playing, user);
function syncMotion() {
  const moving = st.playing && !blocked() && !scrub && fold.p.v < 0.5;
  amp.set(moving ? AMP : 0);
  if (moving) run(playTick);
  clearInterval(closedTimer);
  if (st.playing && !blocked() && fold.p.v >= 0.5) closedTimer = setInterval(() => { st.pos += 0.5; if (st.pos >= cur().d) st.pos = 0; el.miniLine.style.transform = `scaleX(${st.pos / cur().d})`; }, 500);
}
function playTick(dt) {
  if (!st.playing || blocked() || scrub || fold.p.v >= 0.5) return false;
  st.pos += dt; phase += dt * 5.2;
  if (st.pos >= cur().d) { if (!go(1, 0, 'auto')) { st.pos = 0; setPlaying(false); return false; } }
  drawSeek();
}

/* ================= the seek line: the song's form, one continuous wave over it ================= */
let secs = [], moms = [], secI = -1, lastSec = -1, scrub = null;
const secX = new Spring(0, CRIT(0.5), (v) => { el.sec.style.transform = `translateX(${v.toFixed(1)}px)`; });
const PLAIN_KINDS = new Set(['bass_back', 'beat_back', 'beat_out', 'bass_in']);
function buildSeek() {
  const t = cur(), s = snd();
  secs = s ? s.sections : [{ start: 0, end: t.d, kind: 'whole', label: '' }];
  moms = s ? s.moments.filter((m) => !PLAIN_KINDS.has(m.kind) && !m.label.includes('новая партия')).slice(0, 6).map((m) => ({ ...m, label: m.label.replace(/\s*\(.*\)$/, '') })) : [];
  el.blocks.innerHTML = secs.map((x) => `<i class="${x.kind === 'chorus' ? 'chorus' : ''}" style="flex:${(x.end - x.start).toFixed(2)} 1 0"></i>`).join('');
  el.moments.innerHTML = moms.map((m) => `<i style="left:${(m.t / t.d * 100).toFixed(2)}%"></i>`).join('');
  secI = -1; lastSec = -1;
  el.duration.textContent = st.remain ? '−' + fmt(t.d - st.pos) : fmt(t.d);
  drawSeek(true);
}
const secAt = (pos) => { let i = secs.findIndex((x) => pos < x.end); return i < 0 ? secs.length - 1 : i; };
function nameSection(i, instant) {
  const s = secs[i], name = s.label ? s.label[0].toUpperCase() + s.label.slice(1) : '';
  const place = () => {
    el.secName.textContent = name; el.sec.style.visibility = name ? '' : 'hidden';
    const x = clamp(s.start / cur().d * M.seekW, 0, M.seekW - el.sec.offsetWidth);
    instant ? secX.snap(x) : secX.set(x);
  };
  if (instant || still()) return place();
  el.sec.classList.add('swap');
  setTimeout(() => { place(); el.sec.classList.remove('swap'); }, 130);
}
function drawSeek(force) {
  const t = cur(), w = M.seekW, x = clamp(st.pos / t.d) * w, A = amp.v;
  let d = 'M0 12';
  if (x > 0.5) {
    if (A < 0.05) d += `H${x.toFixed(1)}`;
    else for (let i = 1, n = Math.ceil(x / 2.5); i <= n; i++) {
      const xi = x * i / n, env = Math.min(1, xi / 12, (x - xi) / 10 + 0.0);
      d += `L${xi.toFixed(1)} ${(12 + Math.sin(xi * 0.3 - phase) * A * Math.max(0, env)).toFixed(2)}`;
    }
  }
  el.wavePath.setAttribute('d', d);
  el.thumb.style.transform = `translateX(${x.toFixed(1)}px)`;
  const i = secAt(st.pos);
  if (i !== secI || force) {
    const kids = el.blocks.children;
    for (let k = 0; k < kids.length; k++) kids[k].style.setProperty('--p', k < i ? 1 : 0);
    if (i !== secI) nameSection(i, force || secI < 0);
    secI = i;
  }
  const b = el.blocks.children[i];
  if (b) b.style.setProperty('--p', clamp((st.pos - secs[i].start) / (secs[i].end - secs[i].start)).toFixed(3));
  const sec = Math.floor(st.pos);
  if (sec !== lastSec || force) {
    lastSec = sec;
    el.elapsed.textContent = fmt(st.pos);
    if (st.remain) el.duration.textContent = '−' + fmt(t.d - st.pos);
    el.seek.setAttribute('aria-valuenow', Math.round(st.pos / t.d * 100));
    el.seek.setAttribute('aria-valuetext', `${fmt(st.pos)} из ${fmt(t.d)}`);
    el.miniLine.style.transform = `scaleX(${(st.pos / t.d).toFixed(3)})`;
    watchMoments();
    if (st.mode === 'text') lyricAt();
  }
}
/* a moment says what it is a few seconds ahead: its dot swells twice, the name comes out on glass */
let mTimer = 0;
function watchMoments() {
  moms.forEach((m, k) => {
    const dot = el.moments.children[k], ahead = m.t - st.pos;
    dot.classList.toggle('past', ahead < 0);
    if (ahead > 6.5 || ahead < -1) m.said = false;
    if (st.playing && !scrub && ahead > 0 && ahead <= 6 && !m.said) {
      m.said = true;
      dot.classList.remove('soon'); void dot.offsetWidth; dot.classList.add('soon');
      sayMoment(k, 3200);
    }
  });
}
function sayMoment(k, ms) {
  const m = moms[k]; if (!m) return;
  el.mlabel.textContent = m.label;
  el.mlabel.style.left = clamp(m.t / cur().d * M.seekW, 60, M.seekW - 60) + 'px';
  el.mlabel.classList.add('show');
  clearTimeout(mTimer); mTimer = setTimeout(() => el.mlabel.classList.remove('show'), ms);
}
function lightMoment(at) {
  const k = moms.findIndex((m) => Math.abs(m.t - at) < 0.6); if (k < 0) return;
  const dot = el.moments.children[k];
  dot.classList.add('lit'); sayMoment(k, 2400);
  setTimeout(() => dot.classList.remove('lit'), 2400);
}
/* scrubbing: 1:1 with the finger, the line thickens, time and section ride above it, a tick on every border */
function scrubTo(e) {
  const b = box(el.seek), x = clamp(pt(e).x - b.x, 0, M.seekW);
  st.pos = x / M.seekW * cur().d;
  const i = secAt(st.pos);
  if (i !== scrub.i) { if (scrub.i >= 0) hap('Tick'); scrub.i = i; }
  el.bubble.firstElementChild.textContent = fmt(st.pos);
  el.bubble.lastElementChild.textContent = secs[i].label || '';
  el.bubble.style.left = clamp(x, 52, M.seekW - 52) + 'px';
  drawSeek(true);
}
el.seek.addEventListener('pointerdown', (e) => {
  if (blocked()) return;
  cap(el.seek, e.pointerId);
  scrub = { id: e.pointerId, i: -1 };
  el.seek.classList.add('scrub'); el.mlabel.classList.remove('show');
  amp.set(0); scrubTo(e);
});
el.seek.addEventListener('pointermove', (e) => { if (scrub && e.pointerId === scrub.id) scrubTo(e); });
const endScrub = (e) => { if (!scrub || e.pointerId !== scrub.id) return; scrub = null; el.seek.classList.remove('scrub'); moms.forEach((m) => { m.said = m.t - st.pos < 6; }); syncMotion(); };
el.seek.addEventListener('pointerup', endScrub); el.seek.addEventListener('pointercancel', endScrub);
el.seek.addEventListener('keydown', (e) => {
  const d = { ArrowLeft: -5, ArrowRight: 5, Home: -1e4, End: 1e4 }[e.key]; if (!d) return;
  e.preventDefault(); st.pos = clamp(st.pos + d, 0, cur().d - 1); drawSeek(true);
});
el.duration.addEventListener('click', () => { st.remain = !st.remain; el.duration.textContent = st.remain ? '−' + fmt(cur().d - st.pos) : fmt(cur().d); });

/* ================= the three sides ================= */
const flip = new Spring(0, { k: 120, c: 13.5, m: 1, eps: 0.02 }, (v) => { el.flipper.style.transform = `rotateY(${v.toFixed(2)}deg)`; });
const lensL = new Spring(0, SNAP, drawLens), lensR = new Spring(0, SNAP, drawLens);
function drawLens() { el.lens.style.transform = `translateX(${lensL.v.toFixed(1)}px)`; el.lens.style.width = Math.max(8, lensR.v - lensL.v).toFixed(1) + 'px'; }
function lensTo(btn, instant) {
  const l = btn.offsetLeft, r = l + btn.offsetWidth;
  if (instant) { lensL.snap(l); lensR.snap(r); return; }
  const right = l > lensL.to;                                 // the leading edge runs, the other one follows: the lens stretches
  Object.assign(lensL, right ? SETTLE : SNAP); Object.assign(lensR, right ? SNAP : SETTLE);
  lensL.set(l); lensR.set(r);
}
function setMode(m, user) {
  if (m === 'sound' && !snd()) m = 'cover';
  if (m === st.mode) return;
  st.mode = m; st.pick = null;
  phone.dataset.mode = m;
  for (const b of $$('button', el.modes)) b.setAttribute('aria-selected', b.dataset.mode === m);
  lensTo($(`[data-mode=${m}]`, el.modes));
  flip.set(m === 'text' ? 180 : 0);
  pauseS.set(st.playing || m !== 'cover' ? 1 : 1.03);
  if (m === 'text') { buildLyrics(); lyricAt(true); tip('mx-lyrics-hint', 'Коснись строчки — и спроси о ней'); }
  if (m === 'sound') buildSound(true);
  el.soundface.setAttribute('aria-hidden', m !== 'sound');
  markCenter(); showSlot();
  if (user) { hap('Tick'); hideHint(true); }
}
let modeDrag = null;
el.modes.addEventListener('pointerdown', (e) => { modeDrag = e.pointerId; cap(el.modes, e.pointerId); pickMode(e); });
el.modes.addEventListener('pointermove', (e) => { if (modeDrag === e.pointerId) pickMode(e); });
el.modes.addEventListener('pointerup', () => { modeDrag = null; });
el.modes.addEventListener('pointercancel', () => { modeDrag = null; });
el.modes.addEventListener('keydown', (e) => {
  const list = $$('button:not([disabled])', el.modes), i = list.findIndex((b) => b.dataset.mode === st.mode), d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
  if (d && list[i + d]) { setMode(list[i + d].dataset.mode, true); list[i + d].focus(); }
  if (e.key === 'Enter' || e.key === ' ') { const b = document.activeElement.closest('[data-mode]'); if (b) setMode(b.dataset.mode, true); }
});
function pickMode(e) {
  const x = pt(e).x - box(el.modes).x;
  const b = $$('button:not([disabled])', el.modes).find((n) => x >= n.offsetLeft - 2 && x <= n.offsetLeft + n.offsetWidth + 2);
  if (b) setMode(b.dataset.mode, true);
}
el.sidePP.addEventListener('click', () => togglePlay(true));

/* ---- text: the back of the cover. Demo lines only: the song's words are not in the mock.
   Most songs have plain words (no timing): the reader scrolls them. Some are synced: the line being sung is lit
   and the words follow the voice until the reader touches them. Either way a tap picks a line (a neighbour's tap
   adds it, up to four), and a small glass capsule under it offers to ask about it. ---- */
const DEMO = ['Здесь идут слова песни', 'Коснись любой строчки — она выделится', 'Под ней появится «Спросить о строчке»', 'Коснись соседней — возьмёшь две сразу',
  'Ассистент объяснит, что за ними стоит', 'Текст можно листать пальцем', 'Обложка просто повернулась спиной', 'Переверни обратно — музыка не прервётся'];
const HOOK = ['Припев возвращается теми же словами', 'Его узнаёшь раньше, чем дочитаешь', 'И линия внизу здесь светлее'];
let lines = [], lineI = -2, sel = [], followHold = 0;
const lyTop = new Spring(0, CRIT(0.6), (v) => { el.lyList.scrollTop = v; });
function buildLyrics() {
  const t = cur(), key = t.id + st.scene + st.lyrics;
  if (el.lyList.dataset.for === key) return;
  el.lyList.dataset.for = key; el.lyList.dataset.kind = st.lyrics;
  $('.ly-bg', el.lyricsFace).style.backgroundImage = `url(${t.dark || t.cover})`;
  const quiet = /вступление|проигрыш|концовка/;
  const parts = (snd() ? snd().sections : [{ start: 8, end: t.d - 10, kind: 'verse', label: '' }]).filter((s) => !quiet.test(s.label));
  lines = []; let n = 0, html = '';
  parts.forEach((s, si) => {
    const hook = s.kind === 'chorus', count = hook ? 3 : clamp(Math.round((s.end - s.start) / 7), 2, 6);
    for (let i = 0; i < count; i++) {
      const text = hook ? HOOK[i] : DEMO[n++ % DEMO.length];
      lines.push({ t: s.start + (s.end - s.start) * i / count, text, part: si });
      html += `<button class="ln" data-i="${lines.length - 1}">${esc(text)}</button>`;
    }
    if (si < parts.length - 1) html += '<div class="gap"></div>';
  });
  el.lyList.innerHTML = `<div class="ly-in">${html}<div class="ly-cap" id="lyCap"><div class="ly-pill lg on-art"></div></div></div>`;
  sel = []; lineI = -2; lyTop.snap(0);
}
function lyricAt(instant) {
  const kids = $$('.ln', el.lyList);
  if (st.lyrics !== 'sync') { if (lineI !== -1) { kids.forEach((b) => b.classList.remove('on')); lineI = -1; } return; }
  let i = -1;
  for (let k = 0; k < lines.length; k++) if (lines[k].t <= st.pos + 0.2) i = k; else break;
  if (i === lineI && !instant) return;
  lineI = i;
  kids.forEach((b, k) => b.classList.toggle('on', k === i));
  if (performance.now() < followHold || sel.length) return;   // the reader is scrolling, or holds a line
  const y = Math.max(0, (kids[Math.max(0, i)] ? kids[Math.max(0, i)].offsetTop : 0) - M.cover * 0.3);
  if (instant) lyTop.snap(y); else { lyTop.v = el.lyList.scrollTop; lyTop.set(y); }
}
const holdFollow = () => { followHold = performance.now() + 4000; lyTop.alive = false; };
el.lyList.addEventListener('pointerdown', holdFollow);
el.lyList.addEventListener('wheel', holdFollow, { passive: true });
function pickLine(i) {
  const near = sel.length && sel.length < 4 && lines[i].part === lines[sel[0]].part && (i === sel[0] - 1 || i === sel[sel.length - 1] + 1);
  if (sel.length === 1 && sel[0] === i) sel = [];
  else if (near) sel = i < sel[0] ? [i, ...sel] : [...sel, i];
  else sel = [i];
  drawSel();
}
function drawSel() {
  const kids = $$('.ln', el.lyList), cap = $('#lyCap'); if (!cap) return;
  kids.forEach((b, k) => b.classList.toggle('sel', sel.includes(k)));
  el.lyList.classList.toggle('picking', sel.length > 0);
  if (!sel.length) { cap.classList.remove('show'); return; }
  const last = kids[sel[sel.length - 1]];
  if (cap.previousElementSibling !== last) { cap.classList.remove('show'); last.after(cap); void cap.offsetWidth; }   // the words below move down to make room
  cap.firstElementChild.innerHTML = `<button data-do="ask">${icon('Sparkles')}Спросить о ${sel.length > 1 ? sel.length + ' строчках' : 'строчке'}</button>`
    + (st.lyrics === 'sync' ? `<button data-do="from">${icon('Play')}Отсюда</button>` : '');
  cap.classList.add('show');
  const need = last.offsetTop + last.offsetHeight + 66 - (el.lyList.scrollTop + el.lyList.clientHeight);
  if (need > 0) { lyTop.v = el.lyList.scrollTop; lyTop.set(el.lyList.scrollTop + need); }
}
onTap(el.lyList, (e) => {
  const act = e.target.closest('[data-do]');
  if (act) {
    if (act.dataset.do === 'ask') { hap('Tick'); openSheet('ask', { quote: sel.map((i) => lines[i].text) }); }
    else { st.pos = lines[sel[0]].t; sel = []; drawSel(); followHold = 0; drawSeek(true); lyricAt(true); if (!st.playing) setPlaying(true, true); else hap('Tick'); }
    return;
  }
  const b = e.target.closest('.ln');
  if (!b) { if (sel.length) { sel = []; drawSel(); } return; }
  hap('Tick'); pickLine(+b.dataset.i); hideHint(false);
});

/* ---- sound: a still cast of the mix. Who plays, where they stand, how much room there is ---- */
const RARE = new Set(['brass', 'winds', 'sax', 'woodwind', 'piano', 'electric_piano', 'organ', 'harpsichord', 'harp', 'sitar', 'banjo', 'mandolin', 'ukulele', 'accordion', 'harmonica', 'bagpipes', 'theremin']);
const ORDER = ['strings', 'acoustic_guitar', 'electric_guitar', 'slide_guitar', 'guitar', 'synthesizer', 'synths', 'lead', 'bass_guitar', 'double_bass', 'synth_bass', 'bass_808'];
function instruments(t = cur()) {
  const s = snd(t); if (!s) return [];
  let keys = s.instruments.map((x) => x.key);
  if (keys.includes('brass')) keys = keys.filter((k) => k !== 'winds');
  const label = new Map(s.instruments.map((x) => [x.key, x.label]));
  keys.sort((a, b) => Number(RARE.has(b)) - Number(RARE.has(a)) || ORDER.indexOf(a) - ORDER.indexOf(b));
  const out = keys.map((k) => ({ key: k, label: label.get(k), at: null }));
  if (s.drums) out.push({ key: s.drums.key === 'live' ? 'drums_live' : 'drum_machine', label: s.drums.label, at: null });
  if (s.vocals && !['voice', 'vocal'].includes(s.vocals.key)) out.push({ key: s.vocals.key, label: s.vocals.label, at: null });
  for (const it of out) { const word = it.label.split(' ').at(-1); const m = moms.find((x) => x.label.includes(word)); it.at = m ? m.t : null; }
  return out.slice(0, 6);
}
const SHOW = { tech: [25, 70], space: [10, 90], odd: [0, 70] };
const shown = (r, k) => Math.round(clamp((r[k] - SHOW[k][0]) / (SHOW[k][1] - SHOW[k][0])) * 100);
const SCALE = { tech: 'Техничность', space: 'Простор', odd: 'Необычность' };
const MEAN = { tech: 'сколько труда в звуке: слои, обработка, игра.', space: 'насколько звук вокруг тебя, а не в одной точке.', odd: 'насколько песня звучит непривычно.' };
const FACET = { layers: 'много слоёв', sound_work: 'много обработки', playing: 'непростая игра', development: 'музыка развивается', width: 'широкая стереосцена', spread: 'инструменты разведены по сторонам',
  echo: 'много эха', sounds: 'непривычные звуки', mix_extremes: 'резкое сведение', form: 'необычное построение', style: 'экспериментальный стиль' };
function character(s) {
  const out = [], pace = s.pace && s.pace.key, feel = s.feel && s.feel.key;
  const drums = s.drums ? (s.drums.key === 'live' ? 'на живых барабанах' : s.drums.key === 'machine' ? 'на драм-машине' : null) : null;
  if (feel === 'free' || feel === 'no_pulse') out.push(`<b>${feel === 'free' ? 'Свободный ритм' : 'Без чёткого ритма'}</b>, без ударной сетки.`);
  else if (pace) {
    const word = { slow: 'Медленный', unhurried: 'Неспешный', medium: 'Ровный', brisk: 'Бодрый', fast: 'Быстрый' }[pace] || s.pace.label;
    const how = feel === 'driving' ? 'напористый' : feel === 'swinging' ? 'качающий' : null;
    out.push(`<b>${how ? word + ', ' + how : word}</b> ритм${drums ? ` <b>${drums}</b>` : ''}.`);
  } else if (drums) out.push(`Ритм <b>${drums}</b>.`);
  const echo = { dry: 'Сухой звук, близко к уху', little: 'Немного эха', noticeable: 'Заметное эхо', hall: 'Много эха, как в зале' }[s.echo.key];
  const width = s.width ? { narrow: 'узкая, почти моно сцена', medium: 'сцена средней ширины', wide: 'широкая сцена', very_wide: 'сцена от уха до уха' }[s.width.key] : null;
  if (echo || width) out.push([echo && `<b>${echo}</b>`, width && `<b>${width}</b>`].filter(Boolean).join(', ') + '.');
  return out.join(' ');
}
/** The parts of the mix: voice in front, drums at the back (a stage plot), placed by their measured pan and width. */
function parts(t) {
  const s = snd(t), by = (stem) => t.stems.filter((x) => stem.includes(x.stem));
  const out = [], drums = by(['kick', 'snare', 'toms', 'hh', 'cym']);
  const side = (pan) => (pan < -0.2 ? 'слева' : pan > 0.2 ? 'справа' : 'по центру');
  for (const v of by(['vocals'])) out.push({ key: v.name, label: s.vocals ? s.vocals.label : 'голос', pan: v.pan, width: v.width, share: t.share.vocals, row: 3, voice: true });
  for (const x of by(['guitar', 'piano', 'other'])) { const known = s.instruments.find((i) => i.key === x.name); out.push({ key: x.name, label: known ? known.label : { synth_other: 'синтезаторы', strings: 'струнные', guitar: 'гитара', piano: 'пианино' }[x.name] || x.name, pan: x.pan, width: x.width, share: t.share[x.stem] || 0.05, row: 2 }); }
  for (const b of by(['bass'])) { const known = s.instruments.find((i) => i.key === b.name); out.push({ key: b.name, label: known ? known.label : 'бас', pan: b.pan, width: b.width, share: t.share.bass, row: 1 }); }
  if (drums.length) {
    const pans = drums.map((d) => d.pan), lo = Math.min(...pans), hi = Math.max(...pans);
    out.push({ key: s.drums && s.drums.key === 'machine' ? 'drum_machine' : 'drums_live', label: s.drums ? s.drums.label : 'ударные', pan: (lo + hi) / 2, width: clamp((hi - lo) / 2 + 0.3, 0.2, 0.9), share: t.share.drums, row: 0 });
  }
  const top = Math.max(...out.map((p) => p.share), 0.01);
  const ins = instruments(t);
  for (const p of out) { p.a = 0.34 + 0.66 * Math.sqrt(p.share / top); p.where = side(p.pan); const it = ins.find((i) => i.label === p.label); p.at = it ? it.at : null; }
  return out;
}
let sfTimer = 0;
function buildSound(animate) {
  const t = cur(), s = snd(); if (!s) return;
  const ps = parts(t), W = M.cover, H = M.cover - 92, k = W / 372;
  const soft = { dry: 1, little: 3, noticeable: 6, hall: 11 }[s.echo.key] || 4;
  let html = '';
  if (st.viz === 'stage') {
    const rowY = [0.2, 0.4, 0.6, 0.8], depth = [0.74, 0.82, 0.9, 1];
    const rings = rowY.map((y, i) => `<ellipse cx="${W / 2}" cy="${H * 1.12}" rx="${W * (0.86 - i * 0.2)}" ry="${H * (1.12 - y)}"/>`).join('');
    html += `<svg class="sf-rings" viewBox="0 0 ${W} ${H}">${rings}</svg><span class="sf-side l">слева</span><span class="sf-side r">справа</span>`;
    const taken = {};
    ps.forEach((p, i) => {
      const n = (taken[p.row] = (taken[p.row] || 0) + 1), w = (64 + p.width * 132) * k * depth[p.row], h = (54 + 34 * p.a) * k * depth[p.row];
      const x = clamp(0.5 + p.pan * 0.46, 0.2, 0.8) * W, y = (rowY[p.row] + (n > 1 ? (n % 2 ? -0.085 : 0.085) : 0)) * H + 8;
      html += `<button class="pool" data-i="${i}" aria-label="${esc(p.label)}, ${p.where}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${w.toFixed(0)}px;height:${h.toFixed(0)}px;--a:${p.a.toFixed(2)};--soft:${(soft * depth[p.row]).toFixed(1)}px;--light:color-mix(in oklab,var(--acc) ${p.voice ? 22 : 52}%,white)"><i></i>${glyph(p.key)}</button>`;
    });
    html += `<span class="sf-you">${glyph('listener')}</span>`;
  } else {
    const order = [...ps].sort((a, b) => b.row - a.row), gap = (H - 26) / order.length;
    order.forEach((p) => {
      const i = ps.indexOf(p), w = (0.36 + 0.56 * p.width) * (W - 92), h = Math.min(gap - 8, (14 + 40 * p.a) * k);
      const x = clamp(0.5 + p.pan * 0.2, 0.5 - (W - 92 - w) / 2 / W, 0.5 + (W - 92 - w) / 2 / W) * W, y = 26 + gap * (order.indexOf(p) + 0.5);
      html += `<button class="pool band" data-i="${i}" aria-label="${esc(p.label)}, ${p.where}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${w.toFixed(0)}px;height:${h.toFixed(0)}px;--a:${(p.a * 0.9).toFixed(2)};--soft:${(soft * 0.7).toFixed(1)}px;--light:color-mix(in oklab,var(--acc) ${p.voice ? 22 : 52}%,white)"><i></i>${glyph(p.key)}</button>`;
    });
    html += '<span class="sf-side l">слева</span><span class="sf-side r">справа</span>';
  }
  html += '<span class="sf-label lg on-art" id="sfLabel"></span>';
  el.sfViz.innerHTML = html;
  el.sfViz._parts = ps;
  el.sfScales.className = 'sf-scales';
  el.sfScales.innerHTML = ['tech', 'space', 'odd'].map((key) => `<button class="scale" data-k="${key}"><b>${shown(s.ratings, key)}</b><small>${SCALE[key]}</small><span class="bar"><i></i></span></button>`).join('');
  const bars = () => $$('.bar i', el.sfScales).forEach((b, i) => { b.style.transform = `scaleX(${shown(s.ratings, ['tech', 'space', 'odd'][i]) / 100})`; });
  if (animate && !still()) {
    $$('.pool', el.sfViz).forEach((n, i) => n.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.6)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 620, delay: 140 + i * 70, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'backwards' }));
    $$('.scale', el.sfScales).forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 260 + i * 60, easing: 'cubic-bezier(.22,.9,.3,1)', fill: 'backwards' }));
    setTimeout(bars, 320);
  } else bars();
}
onTap(el.sfViz, (e) => {
  const b = e.target.closest('.pool'); if (!b) return;
  const p = el.sfViz._parts[+b.dataset.i], lab = $('#sfLabel');
  $$('.pool.on', el.sfViz).forEach((n) => n.classList.remove('on'));
  b.classList.add('on'); hap('Tick');
  lab.textContent = p.label[0].toUpperCase() + p.label.slice(1) + ' · ' + p.where + (p.at != null ? ' · вступает в ' + fmt(p.at) : '');
  lab.style.left = clamp(b.offsetLeft, 96, M.cover - 96) + 'px'; lab.style.top = Math.max(34, b.offsetTop - b.offsetHeight / 2 - 6) + 'px';
  lab.classList.add('show');
  if (p.at != null) lightMoment(p.at);
  clearTimeout(sfTimer); sfTimer = setTimeout(() => { lab.classList.remove('show'); b.classList.remove('on'); }, 2600);
});
onTap(el.sfScales, (e) => {
  const b = e.target.closest('.scale'); if (!b) return;
  st.pick = st.pick === b.dataset.k ? null : b.dataset.k;
  el.sfScales.classList.toggle('pick', !!st.pick);
  $$('.scale', el.sfScales).forEach((n) => n.classList.toggle('on', n.dataset.k === st.pick));
  hap('Tick'); showSlot();
});

/* ================= the title block ================= */
function showSlot() {
  const t = cur(), s = snd();
  const more = `<button class="more" tabindex="-1">ещё${icon('ChevronRight')}</button>`;
  if (st.mode === 'sound' && s) {
    if (st.pick) {
      const f = Object.entries(s.ratings.facets[st.pick] || {}).filter(([, v]) => v >= 40).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => FACET[n] || n);
      return swap(el.slot, `<span class="k" style="color:var(--${st.pick})">${SCALE[st.pick]}</span> — ${MEAN[st.pick]}${f.length ? ' Здесь: ' + f.join(' и ') + '.' : ''}`, 'plain');
    }
    return swap(el.slot, character(s), 'plain');
  }
  const text = t.vibe || 'Истории об этой песне ещё собираются.';
  // a two-line title and the reason of «Поток» each take one line from the phrase: the block keeps its height
  const lines = Math.max(1, M.lines - (el.title.offsetHeight > 46 ? 1 : 0) - (st.scene === 'stream' ? 1 : 0));
  phone.style.setProperty('--lines', lines);
  const node = swap(el.slot, esc(text) + ' ' + more), max = lines * 22 + 2;
  if (node.offsetHeight > max) {                              // two lines, three where the screen has room; the rest waits in «О песне»
    const words = text.split(' '); let lo = 1, hi = words.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; node.innerHTML = esc(words.slice(0, mid).join(' ')) + '… ' + more; if (node.offsetHeight > max) hi = mid - 1; else lo = mid; }
    node.innerHTML = esc(words.slice(0, lo).join(' ').replace(/[,.;:—-]+$/, '')) + '… ' + more;
  }
}
onTap(el.slot, () => { if (st.mode !== 'sound') openSheet('about'); });
function showTrack(dir) {
  const t = cur();
  el.title.textContent = t.t; el.title.classList.toggle('long', t.t.length > 16);
  el.artist.innerHTML = `<span>${esc(t.a)}</span>${icon('ChevronRight')}`;
  el.album.innerHTML = `<span>${esc(t.album)} · ${t.year}</span>${icon('ChevronRight')}`;
  if (dir != null) [el.title, el.artist.parentElement, el.slot].forEach((n, i) => rise(n, 120 + i * 45));
  const layers = $$('i', el.backdrop), nextL = layers.find((l) => !l.classList.contains('on')) || layers[0];
  nextL.style.backgroundImage = `url(${t.bg})`;
  for (const l of layers) { l.style.transition = ''; l.style.opacity = ''; l.style.zIndex = ''; } bdPeek = null;   // from where the finger left it
  layers.forEach((l) => l.classList.toggle('on', l === nextL));
  phone.style.setProperty('--acc', t.accent[phone.dataset.theme]); phone.style.setProperty('--acc2', t.pal.muted);
  $$('[data-mode=sound]', el.modes)[0].disabled = !snd();
  if (st.mode === 'sound' && !snd()) setMode('cover');
  lensTo($(`[data-mode=${st.mode}]`, el.modes), true);
  buildSeek(); showSlot(); showTray();
  if (st.mode === 'text') { buildLyrics(); lyricAt(true); }
  if (st.mode === 'sound') buildSound(dir != null);
  el.fire.setAttribute('aria-pressed', st.fire.has(t.id)); el.water.setAttribute('aria-pressed', st.water.has(t.id));
  el.addBtn.classList.toggle('added', st.added.has(t.id));
  el.addBtn.setAttribute('aria-label', st.added.has(t.id) ? `В плейлисте «${st.added.get(t.id)}»` : 'В плейлист');
  $('img', el.miniArt).src = t.cover; el.miniTitle.textContent = t.t; el.miniArtist.textContent = t.a;
  if (typeof onTrackChange === 'function') onTrackChange();
  syncMotion();
}
function showTray() {
  const up = [1, 2, 3].map((d) => trackAt(st.qi + d)).filter(Boolean), left = st.q.length - st.qi - 1;
  el.stack.innerHTML = up.map((t) => `<img src="${t.cover}" alt="">`).join('');
  el.nextTitle.textContent = up[0] ? `${up[0].t} · ${up[0].a}` : 'Дальше — похожее, по Автоплейлисту';
  el.queueCount.textContent = left > 0 ? left : '';
}
for (const a of [el.artist, el.album]) a.addEventListener('click', () => toast(a === el.artist ? `Страница артиста: ${cur().a}` : `Разворот альбома: ${cur().album}`));

/* ================= огонёк, вода, вперемешку ================= */
function bounce(btn) { btn.classList.remove('bounce'); void btn.offsetWidth; btn.classList.add('bounce'); }
function react(kind) {
  const id = cur().id, mine = st[kind], other = st[kind === 'fire' ? 'water' : 'fire'], on = !mine.has(id);
  on ? mine.add(id) : mine.delete(id);
  if (on) other.delete(id);
  el.fire.setAttribute('aria-pressed', st.fire.has(id)); el.water.setAttribute('aria-pressed', st.water.has(id));
  hap(on ? 'ToggleOn' : 'ToggleOff');
  if (on) { bounce(el[kind]); burst(kind); }
}
el.fire.addEventListener('click', () => react('fire'));
el.water.addEventListener('click', () => react('water'));
el.shuffle.addEventListener('click', () => {
  if (st.scene === 'stream') { hap('Reject'); toast('В Потоке порядок выбирает волна'); return; }
  st.shuffle = !st.shuffle; el.shuffle.setAttribute('aria-pressed', st.shuffle);
  hap(st.shuffle ? 'ToggleOn' : 'ToggleOff');
  if (st.shuffle) { bounce(el.shuffle); const head = st.q.slice(0, st.qi + 1), tail = st.q.slice(st.qi + 1); for (let i = tail.length - 1; i > 0; i--) { const j = (i * 7 + 3) % (i + 1); [tail[i], tail[j]] = [tail[j], tail[i]]; } st.q = head.concat(tail); refill(); showTray(); }
});
el.ask.addEventListener('click', () => openSheet('ask'));

/* one shot of particles around the cover: fire climbs from below, water runs down from the top */
let burstRun = null;
/* soft round sprites drawn once: a particle is a scaled picture, not a gradient built every frame */
const sprites = {};
function sprite(name, stops) {
  if (sprites[name]) return sprites[name];
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [at, col] of stops) gr.addColorStop(at, col);
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  return (sprites[name] = c);
}
function burst(kind) {
  if (still() || st.mode === 'text') return;
  const cv = el.burst, dpr = Math.min(2, devicePixelRatio || 1), S = M.cover, pad = 64, ctx = cv.getContext('2d'), k = S / 372;
  cv.width = cv.height = Math.round((S + pad * 2) * dpr);
  const ps = [], rnd = (lo, hi) => lo + Math.random() * (hi - lo);
  const put = (img, x, y, r, alpha) => { if (alpha <= 0.004) return; ctx.globalAlpha = Math.min(1, alpha); ctx.drawImage(img, x - r, y - r, r * 2, r * 2); };
  if (kind === 'fire') {
    const hot = sprite('hot', [[0, 'rgba(255,250,214,1)'], [0.3, 'rgba(255,206,92,.9)'], [0.62, 'rgba(255,128,32,.42)'], [1, 'rgba(255,80,10,0)']]);
    const cool = sprite('cool', [[0, 'rgba(255,150,54,.95)'], [0.45, 'rgba(226,62,22,.55)'], [1, 'rgba(120,14,6,0)']]);
    const smoke = sprite('smoke', [[0, 'rgba(60,40,36,.5)'], [1, 'rgba(40,30,30,0)']]);
    // the body: big slow tongues from under the cover give the fire its weight
    for (let i = 0; i < 30; i++) ps.push({ t: 'tongue', x: rnd(pad + 8, pad + S - 8), y: pad + S + rnd(4, 26) * k, vx: rnd(-10, 10), vy: rnd(-170, -90) * k, r: rnd(30, 52) * k, life: rnd(0.9, 1.5), age: -rnd(0, 0.5), ph: rnd(0, 6) });
    // the flames: along the bottom and up both sides
    for (let i = 0; i < 96; i++) {
      const side = Math.random() < 0.34, x = side ? (Math.random() < 0.5 ? pad : pad + S) + rnd(-6, 6) : rnd(pad, pad + S);
      ps.push({ t: 'flame', x, y: side ? rnd(pad + S * 0.3, pad + S) : pad + S + rnd(-6, 12), vx: rnd(-20, 20), vy: rnd(-300, -130) * k, r: rnd(11, 26) * k, life: rnd(0.55, 1.25), age: -rnd(0, 0.55), ph: rnd(0, 6) });
    }
    for (let i = 0; i < 30; i++) ps.push({ t: 'ember', x: rnd(pad, pad + S), y: pad + S * rnd(0.5, 1), vx: rnd(-40, 40), vy: rnd(-380, -200) * k, r: rnd(1.6, 3), life: rnd(1.1, 1.9), age: -rnd(0.1, 0.7), ph: rnd(0, 6) });
    for (let i = 0; i < 8; i++) ps.push({ t: 'smoke', x: rnd(pad + 20, pad + S - 20), y: pad + rnd(-10, 30), vx: rnd(-12, 12), vy: rnd(-60, -30), r: rnd(34, 56) * k, life: rnd(1.2, 1.8), age: -rnd(0.5, 0.9), ph: 0 });
    if (burstRun) burstRun();
    burstRun = run((dt) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, S + pad * 2, S + pad * 2);
      let alive = 0;
      for (const p of ps) {
        p.age += dt; if (p.age < 0) { alive++; continue; }
        const q = p.age / p.life; if (q >= 1) continue;
        alive++;
        p.x += (p.vx + Math.sin(p.age * 6 + p.ph) * (p.t === 'ember' ? 46 : 22)) * dt; p.y += p.vy * dt; p.vy *= 1 - 0.7 * dt;
        if (p.t === 'smoke') { ctx.globalCompositeOperation = 'source-over'; put(smoke, p.x, p.y, p.r * (1 + q * 0.6), 0.5 * Math.sin(Math.PI * q)); continue; }
        ctx.globalCompositeOperation = 'lighter';
        const rise = Math.min(1, q * 6), fade = (1 - q) * rise;
        if (p.t === 'ember') { put(hot, p.x, p.y, p.r * (1.6 - q), fade * 1.2); continue; }
        const r = p.r * (p.t === 'tongue' ? 1 - q * 0.35 : 1 - q * 0.62), a = p.t === 'tongue' ? 0.34 : 0.62;
        put(cool, p.x, p.y, r * 1.15, fade * a * (0.4 + q * 0.6));
        put(hot, p.x, p.y, r * 0.78, fade * a * (1 - q * 0.9));
      }
      ctx.globalAlpha = 1;
      if (!alive) { ctx.clearRect(0, 0, S + pad * 2, S + pad * 2); burstRun = null; return false; }
    });
    return;
  }
  const drop = sprite('drop', [[0, 'rgba(236,250,255,1)'], [0.35, 'rgba(150,214,255,.95)'], [0.8, 'rgba(70,160,246,.6)'], [1, 'rgba(50,130,236,0)']]);
  const mist = sprite('mist', [[0, 'rgba(170,220,255,.5)'], [1, 'rgba(120,190,255,0)']]);
  // a crown of heavy drops thrown off the top edge, streams down the face, a cool mist behind
  for (let i = 0; i < 34; i++) ps.push({ t: 'crown', x: rnd(pad + 6, pad + S - 6), y: pad + rnd(-4, 6), vx: rnd(-150, 150) * k, vy: rnd(-330, -120) * k, r: rnd(4.5, 9.5) * k, life: rnd(0.9, 1.4), age: -rnd(0, 0.22) });
  for (let i = 0; i < 46; i++) ps.push({ t: 'run', x: rnd(pad + 4, pad + S - 4), y: pad + rnd(-2, 10), vx: rnd(-5, 5), vy: rnd(30, 120) * k, r: rnd(3.4, 7) * k, life: rnd(1, 1.7), age: -rnd(0, 0.5) });
  for (let i = 0; i < 12; i++) ps.push({ t: 'mist', x: rnd(pad, pad + S), y: pad + rnd(-16, 40), vx: rnd(-14, 14), vy: rnd(20, 60), r: rnd(40, 70) * k, life: rnd(1, 1.6), age: -rnd(0, 0.3) });
  if (burstRun) burstRun();
  burstRun = run((dt) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, S + pad * 2, S + pad * 2);
    let alive = 0;
    for (const p of ps) {
      p.age += dt; if (p.age < 0) { alive++; continue; }
      const q = p.age / p.life; if (q >= 1 || p.y > S + pad * 2 + 20) continue;
      alive++;
      if (p.t === 'mist') { p.x += p.vx * dt; p.y += p.vy * dt; put(mist, p.x, p.y, p.r, 0.42 * Math.sin(Math.PI * q)); continue; }
      p.vy += (p.t === 'crown' ? 1050 : 760) * k * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.t === 'crown') p.vx *= 1 - 1.4 * dt;
      const a = (1 - q * q) * 0.95, len = clamp(Math.abs(p.vy) / 26, 0, 30) * k;
      if (p.t === 'run' && len > 3) {                         // the stream leaves a tapering trail
        ctx.globalAlpha = a * 0.5; ctx.strokeStyle = 'rgb(150,212,255)'; ctx.lineCap = 'round'; ctx.lineWidth = p.r * 0.9;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - len); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1, 1 + clamp(Math.abs(p.vy) / 420, 0, 1.2));
      put(drop, 0, 0, p.r, a); ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (!alive) { ctx.clearRect(0, 0, S + pad * 2, S + pad * 2); burstRun = null; return false; }
  });
}

/* ================= the hint of the first visit ================= */
let hintTimer = 0;
function showHint() {
  let seen = false; try { seen = localStorage.getItem('mx-player-hint') === '1'; } catch (e) { /* private mode */ }
  if (seen) return;
  hintTimer = setTimeout(() => {
    el.hint.textContent = 'Коснись — пауза · смахни — другая песня';
    el.hint.classList.add('show');
    if (st.mode === 'cover' && trackAt(st.qi + 1) && !g) sx.set(0, -1500);          // a nudge: the neighbour shows its edge and goes back
    hintTimer = setTimeout(() => hideHint(false), 5200);
  }, 900);
}
/** A one-time line on the stage for something that has no button. */
function tip(key, text) {
  let seen = false; try { seen = localStorage.getItem(key) === '1'; } catch (e) { /* private mode */ }
  if (seen) return;
  try { localStorage.setItem(key, '1'); } catch (e) { /* private mode */ }
  clearTimeout(hintTimer); el.hint.textContent = text;
  hintTimer = setTimeout(() => { el.hint.classList.add('show'); hintTimer = setTimeout(() => el.hint.classList.remove('show'), 4200); }, 700);
}
function hideHint(forGood) {
  clearTimeout(hintTimer); el.hint.classList.remove('show');
  if (forGood) try { localStorage.setItem('mx-player-hint', '1'); } catch (e) { /* private mode */ }
}

/* ================= folding into the mini player: the cover travels, the rest goes out of focus ================= */
const fold = {
  p: new Spring(0, { k: 190, c: 25, m: 1, eps: 0.0008 }, (v) => fold.draw(v)),
  base: 0, over: false, a: null, b: null,
  parts: () => [el.top, el.modes, $('#meta'), $('#seekbox'), $('#actions'), el.tray],
  measure() {
    const keep = el.stage.style.transform; el.stage.style.transform = '';
    const was = el.player.classList.contains('closed'); el.player.classList.remove('closed');
    const mk = el.mini.style.transform, pk = el.pl.style.transform; el.mini.style.transform = ''; el.pl.style.transform = '';
    this.a = box(el.stage); this.b = box(el.miniArt);
    el.mini.style.transform = mk; el.pl.style.transform = pk;
    el.stage.style.transform = keep; el.player.classList.toggle('closed', was);
  },
  draw(v) {
    const p = clamp(v, -0.08, 1), e = clamp(p), a = this.a, b = this.b; if (!a) return;
    const s = lerp(1, b.w / a.w, e);
    el.stage.style.transformOrigin = '0 0';
    el.stage.style.transform = e || p < 0 ? `translate(${((b.x - a.x) * e).toFixed(1)}px,${((b.y - a.y) * e + (p < 0 ? p * 160 : 0)).toFixed(1)}px) scale(${s.toFixed(4)})` : '';
    el.stage.style.opacity = e > 0.9 ? (1 - (e - 0.9) / 0.1).toFixed(3) : '';        // the last steps: the small picture takes over
    el.miniArt.style.opacity = clamp((e - 0.84) / 0.12).toFixed(3);
    el.backdrop.style.opacity = (1 - e * e).toFixed(3);
    for (const n of this.parts()) { n.style.opacity = clamp(1 - e * 2.4).toFixed(3); n.style.transform = e ? `translateY(${(e * 36).toFixed(1)}px)` : ''; }
    el.stubPage.style.transform = `scale(${lerp(0.94, 1, e).toFixed(4)})`; el.stubPage.style.opacity = lerp(0.35, 1, e).toFixed(3);
    el.mini.style.opacity = clamp((e - 0.45) / 0.5).toFixed(3); el.mini.style.transform = `translateY(${((1 - e) * 22).toFixed(1)}px)`;
    const shut = e > 0.995;
    phone.classList.toggle('folding', e > 0.02);
    el.player.classList.toggle('closed', shut);
    el.player.style.pointerEvents = e > 0.5 ? 'none' : '';
  },
  grab() { this.measure(); this.base = this.p.v; this.p.alive = false; this.over = this.base > 0.5; },
  drag(dy) {
    let p = this.base + dy / (M.H * 0.52);
    if (p < 0) p = -rubber(-p * 100, 100) / 100 * 0.5; if (p > 1) p = 1;
    this.p.v = p; this.draw(p);
    const over = p > 0.5; if (over !== this.over) { this.over = over; hap(over ? 'Threshold' : 'ThresholdOff'); }
  },
  release(vy, cancel) {
    const v = vy / (M.H * 0.52), land = this.p.v + project(vy, 0.99) / (M.H * 0.52);
    const shut = cancel ? this.base > 0.5 : land > 0.5;
    this.to(shut, v);
  },
  to(shut, v = 0) {
    if (!this.a) this.measure();
    hideHint(false);
    this.p.done = () => syncMotion();
    this.p.set(shut ? 1 : 0, v);
    el.mini.tabIndex = shut ? 0 : -1;
    setTimeout(syncMotion, 60);
  },
};
el.collapse.addEventListener('click', () => { fold.measure(); fold.to(true); });
/* the top bar is a handle too */
let tg = null;
el.top.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; const p = pt(e); tg = { id: e.pointerId, y0: p.y, on: false }; cap(el.top, e.pointerId); tr.reset(); tr.add(p.x, p.y); });
el.top.addEventListener('pointermove', (e) => { if (!tg || tg.id !== e.pointerId) return; const p = pt(e), dy = p.y - tg.y0; tr.add(p.x, p.y); if (!tg.on) { if (Math.abs(dy) < 10) return; tg.on = true; tg.s = dy; fold.grab(); } fold.drag(dy - tg.s); });
const topUp = (e) => { if (!tg || tg.id !== e.pointerId) return; if (tg.on) fold.release(tr.vel().y, e.type === 'pointercancel'); tg = null; };
el.top.addEventListener('pointerup', topUp); el.top.addEventListener('pointercancel', topUp);
/* the mini player: a tap opens, a pull up opens after the finger */
let mg = null;
el.mini.addEventListener('pointerdown', (e) => { if (e.target.closest('#miniPlay')) return; const p = pt(e); mg = { id: e.pointerId, y0: p.y, on: false }; cap(el.mini, e.pointerId); tr.reset(); tr.add(p.x, p.y); });
el.mini.addEventListener('pointermove', (e) => { if (!mg || mg.id !== e.pointerId) return; const p = pt(e), dy = p.y - mg.y0; tr.add(p.x, p.y); if (!mg.on) { if (Math.abs(dy) < 10) return; mg.on = true; mg.s = dy; fold.grab(); } fold.drag(dy - mg.s); });
const miniUp = (e) => { if (!mg || mg.id !== e.pointerId) return; if (mg.on) fold.release(tr.vel().y, e.type === 'pointercancel'); else if (e.type === 'pointerup') { fold.measure(); fold.to(false); } mg = null; };
el.mini.addEventListener('pointerup', miniUp); el.mini.addEventListener('pointercancel', miniUp);
el.mini.addEventListener('keydown', (e) => { if (e.key === 'Enter') { fold.measure(); fold.to(false); } });
el.miniPlay.addEventListener('click', () => togglePlay(true));
