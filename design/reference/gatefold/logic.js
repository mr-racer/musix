(() => {
const D = window.DATA, IC = window.ICONS, AL = D.albums, SM = D.small || {};
const byId = Object.fromEntries(AL.map(a => [a.id, a]));
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPRING = 'cubic-bezier(.34,1.56,.64,1)', EASE = 'cubic-bezier(.22,.9,.3,1)';

function icon(name, size) { const d = IC[name]; if (!d) return '';
  return '<svg class="i" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true">' + d.d.map((p, i) => d.fill.includes(i) ? '<path d="' + p + '" fill="currentColor"/>' : '<path d="' + p + '" fill="none" stroke="currentColor" stroke-width="' + d.w + '" stroke-linecap="round" stroke-linejoin="round"/>').join('') + '</svg>'; }
function icons(root) { $$('[data-i]', root).forEach(el => { const [n, s] = el.dataset.i.split(':'); el.innerHTML = icon(n, +s); el.removeAttribute('data-i'); }); }
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = ms => { if (!ms) return '—'; const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const span = ms => { const m = Math.round(ms / 60000); return m < 60 ? m + ' мин' : Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин'; };
const plural = (n, a, b, c) => { const x = n % 10, y = n % 100; return x === 1 && y !== 11 ? a : x >= 2 && x <= 4 && (y < 10 || y >= 20) ? b : c; };
const MON = ['янв.', 'февр.', 'марта', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const day = iso => { const d = new Date(iso); return d.getDate() + ' ' + MON[d.getMonth()]; };
const total = a => a.tracks.reduce((s, t) => s + (t.ms || 0), 0);
const artistOf = a => a.artist?.name || '';

/* WAAPI with the end state kept: commit, then drop the animation, so the next one starts
   from what is on screen (interruptible, no stacked fills) */
function run(el, kf, o) {
  if (!el) return Promise.resolve();
  if (reduce) o = { ...o, duration: 1, delay: 0 };
  const an = el.animate(kf, { fill: 'forwards', ...o });
  return an.finished.then(() => { try { an.commitStyles(); } catch (e) {} an.cancel(); }, () => {});
}
const wait = ms => new Promise(r => setTimeout(r, reduce ? 0 : ms));

/* the accent and the colour on it: palette.accent.dark; white on it unless that is too faint */
function hslRgb(h) { const m = /hsl\(\s*([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%/.exec(h || ''); if (!m) return [224, 112, 58];
  const H = +m[1] / 360, S = +m[2] / 100, L = +m[3] / 100, q = L < .5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(H + 1 / 3), f(H), f(H - 1 / 3)].map(x => Math.round(x * 255)); }
const lum = ([r, g, b]) => { const c = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * c(r) + .7152 * c(g) + .0722 * c(b); };
function accent(a) { const rgb = hslRgb(a.acc); const onWhite = 1.05 / (lum(rgb) + .05); return { acc: a.acc || 'rgb(' + rgb + ')', on: onWhite >= 3 ? '#fff' : '#141418' }; }
const labelBg = a => 'radial-gradient(circle at 38% 32%, ' + (a.vib || '#888') + ', ' + (a.acc || '#444') + ' 72%)';

/* ── the stage and its size ─────────────────────────────────────────────── */
const stage = $('#stage'), viewport = $('#viewport');
let size = { w: 1728, h: 1117 }, S = 1, V = 'A';
function fit() {
  const vw = viewport.clientWidth, { w, h } = size;
  S = Math.min(1, vw / w);
  stage.style.width = w + 'px'; stage.style.height = h + 'px';
  stage.style.transform = S < 1 ? 'scale(' + S + ')' : 'none';
  viewport.style.height = Math.round(h * S) + 'px';
  stage.style.setProperty('--card', Math.round(Math.min(250, Math.max(160, (w - 160 - 5 * 24) / 6))) + 'px');
  $('#sizeTag').textContent = w + ' × ' + h + (S < 1 ? ' · показано в ' + Math.round(S * 100) + ' %' : '');
}
const local = r => { const s = stage.getBoundingClientRect(); return { x: (r.left - s.left) / S, y: (r.top - s.top) / S, w: r.width / S, h: r.height / S }; };

/* ── the library grid ───────────────────────────────────────────────────── */
const grid = $('#grid');
grid.innerHTML = AL.map(a => '<button type="button" class="card" data-id="' + a.id + '"><span class="deck"><span class="disc"><span class="vinyl"><span class="lbl" style="background:' + labelBg(a) + '"></span></span></span><img class="sleeveImg" src="' + a.cover + '" alt=""></span><span class="ct">' + esc(a.title) + '</span><span class="cs">' + esc(artistOf(a)) + ' · ' + (a.year || '') + '</span></button>').join('');
grid.addEventListener('click', e => { const c = e.target.closest('.card'); if (c && !G) open(byId[c.dataset.id], $('.sleeveImg', c)); });
const cardOf = id => $('.card[data-id="' + id + '"]', grid);

/* ── the player: one track playing, a manual «up next» list ─────────────── */
const P = { a: byId[AL.find(a => a.title === 'Graduation')?.id] || AL[0], i: 0, t: 0, playing: true };
P.i = Math.max(0, P.a.tracks.findIndex(t => /^Stronger/.test(t.t))); P.t = (P.a.tracks[P.i].ms || 200000) * .38;
const Q = [];   // [{a, i}] in the order chosen; they play right after the current track
function setNow() {
  const t = P.a.tracks[P.i];
  $('#miniCover').src = P.a.cover; $('#miniTitle').textContent = t.t; $('#miniArtist').textContent = artistOf(P.a) + (t.feat.length ? ', ' + t.feat.join(', ') : '');
  stage.style.setProperty('--mini-acc', accent(P.a).acc);
  $('#miniPlay').innerHTML = icon(P.playing ? 'Pause' : 'Play', 22);
  tick(true); if (G) G.sync();
}
function tick(still) {
  if (!still && P.playing) { P.t += 250; const ms = P.a.tracks[P.i].ms || 200000; if (P.t >= ms) return advance(); }
  const ms = P.a.tracks[P.i].ms || 200000;
  $('#miniLine').style.setProperty('--p', Math.min(1, P.t / ms));
  $('#miniTime').textContent = clock(P.t) + ' / ' + clock(ms);
  if (G && G.progress) G.progress();
}
function advance() {
  const n = Q.shift();
  if (n) { P.a = n.a; P.i = n.i; } else { P.i = (P.i + 1) % P.a.tracks.length; }
  P.t = 0; setNow(); if (G) G.marks();
}
function play(a, i) { if (P.a === a && P.i === i) { P.playing = !P.playing; } else { P.a = a; P.i = i; P.t = 0; P.playing = true; } setNow(); }
setInterval(() => tick(false), 250);
$('#miniPlay').addEventListener('click', () => { P.playing = !P.playing; setNow(); });
$('#miniNext').addEventListener('click', advance);

/* a queued track flies in an arc into the mini player's next button; «Далее» pops above it */
function flyToQueue(fromEl, a, i) {
  const t = a.tracks[i], from = local(fromEl.getBoundingClientRect()), to = local($('#miniNext').getBoundingClientRect());
  const fly = document.createElement('div'); fly.className = 'fly';
  fly.innerHTML = '<div class="pill"><img src="' + a.cover + '" alt=""><b>' + esc(t.t) + '</b></div>';
  stage.appendChild(fly);
  const pill = fly.firstChild, pw = pill.offsetWidth, ph = pill.offsetHeight;
  const x0 = from.x - 6, y0 = from.y + from.h / 2 - ph / 2, x1 = to.x + to.w / 2 - pw / 2, y1 = to.y + to.h / 2 - ph / 2;
  fly.style.transform = 'translate(' + x0 + 'px,' + y0 + 'px)';
  if (reduce) { fly.remove(); landed(a, i); return; }
  // across: eased in-out; down: lifted first, then falling (two springs on two axes, never one ramp)
  fly.animate([{ transform: 'translate(' + x0 + 'px,' + y0 + 'px)' }, { transform: 'translate(' + x1 + 'px,' + y0 + 'px)' }], { duration: 640, easing: 'cubic-bezier(.45,0,.4,1)', fill: 'forwards', composite: 'replace' });
  pill.animate([
    { transform: 'translateY(0) scale(1)', opacity: 1, easing: 'cubic-bezier(.2,.7,.3,1)' },
    { transform: 'translateY(-26px) scale(1.04)', opacity: 1, offset: .26, easing: 'cubic-bezier(.55,0,.85,.35)' },
    { transform: 'translateY(' + (y1 - y0) + 'px) scale(.42)', opacity: .2 }], { duration: 640, fill: 'forwards' })
    .finished.then(() => { fly.remove(); landed(a, i); });
}
let peekEl = null, peekTimer = 0;
function landed(a, i) {
  const nx = $('#miniNext');
  nx.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(1)' }], { duration: 480, easing: SPRING });
  const t = a.tracks[i], more = Q.length - 1;
  if (peekEl) { peekEl.remove(); clearTimeout(peekTimer); }
  peekEl = document.createElement('div'); peekEl.className = 'peek pill';
  peekEl.innerHTML = '<img src="' + a.cover + '" alt=""><span>Далее</span><b>' + esc(Q[0] ? Q[0].a.tracks[Q[0].i].t : t.t) + '</b>' + (more > 0 ? '<span>и ещё ' + more + '</span>' : '');
  stage.appendChild(peekEl);
  const r = local(nx.getBoundingClientRect()), w = peekEl.offsetWidth;
  peekEl.style.left = Math.min(size.w - 24 - w, r.x + r.w / 2 - w / 2) + 'px';
  peekEl.animate([{ transform: 'translateY(10px) scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: SPRING });
  const el = peekEl;
  peekTimer = setTimeout(() => el.animate([{ opacity: 1 }, { transform: 'scale(.9)', opacity: 0 }], { duration: 190, easing: 'ease-in', fill: 'forwards' }).finished.then(() => el.remove()), 2600);
}
function toggleQueue(a, i, btn) {
  const k = Q.findIndex(x => x.a === a && x.i === i);
  if (k >= 0) { Q.splice(k, 1); G && G.marks(); return; }
  Q.push({ a, i }); G && G.marks();
  const nm = btn.closest('.row').querySelector('.nm');
  flyToQueue(nm, a, i);
}

function toast(msg) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg; stage.appendChild(el);
  el.animate([{ transform: 'translateY(10px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: EASE });
  setTimeout(() => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' }).finished.then(() => el.remove()), 1800);
}

/* ── the back of the sleeve: the shared pieces ──────────────────────────── */
function headHTML(a) {
  const n = a.tracks.length, g = a.tracks.map(t => t.genre).filter(Boolean);
  const genre = g.sort((x, y) => g.filter(v => v === y).length - g.filter(v => v === x).length)[0];
  return '<h3 class="ttl' + (a.title.length > 26 ? ' long' : '') + '">' + esc(a.title) + '</h3>' +
    '<div><button type="button" class="who" data-act="artist">' + esc(artistOf(a)) + '<span data-i="ChevronRight:16"></span></button></div>' +
    '<div class="facts">' + [a.year, genre, n + ' ' + plural(n, 'трек', 'трека', 'треков'), span(total(a))].filter(Boolean).map(x => '<span>' + esc(x) + '</span>').join('') +
    (a.lossless ? '<span class="badge">Lossless</span>' : '') + '</div>';
}
function actsHTML(a) {
  const plays = a.tracks.reduce((s, t) => s + t.plays, 0), last = a.tracks.map(t => t.last).filter(Boolean).sort().pop();
  return '<div class="acts"><button type="button" class="play" data-act="play"><span class="gl"><span data-i="Play:18"></span><span data-i="Pause:18"></span></span><span class="pl">Слушать</span></button>' +
    (plays ? '<div class="stat"><b>' + plays + '</b> ' + plural(plays, 'прослушивание', 'прослушивания', 'прослушиваний') + (last ? '<br>последний раз ' + day(last) : '') + '</div>' : '<div class="stat">Ещё не слушал</div>') + '</div>';
}
function listHTML(a) {
  const discs = new Set(a.tracks.map(t => t.disc || 1)).size > 1;
  const top = a.tracks.reduce((b, t, i) => t.plays > (a.tracks[b]?.plays || 0) ? i : b, -1);
  const second = Math.max(0, ...a.tracks.filter((_, i) => i !== top).map(t => t.plays));
  let html = '', disc = null;
  a.tracks.forEach((t, i) => {
    if (discs && (t.disc || 1) !== disc) { disc = t.disc || 1; html += '<div class="disc-h">Диск ' + disc + '</div>'; }
    const fav = i === top && t.plays >= 5 && t.plays >= second + 2;
    html += '<div class="row" role="button" tabindex="0" data-k="' + i + '"><span class="no"><span class="n">' + (t.no || i + 1) + '</span><span class="pg">' + icon('Play', 14) + '</span><span class="eq"><i></i><i></i><i></i></span></span>' +
      '<span class="nm">' + esc(t.t) + (t.feat.length ? ' <small>feat. ' + esc(t.feat.join(', ')) + '</small>' : '') + '</span>' +
      (fav ? '<span class="fav" title="' + t.plays + ' ' + plural(t.plays, 'раз', 'раза', 'раз') + '">любимая</span>' : '<span></span>') +
      '<span class="dur">' + clock(t.ms) + '</span>' +
      '<button type="button" class="q" data-act="queue" aria-label="Играть следующим">' + icon('QueueNext', 16) + '<span class="k"></span><span class="tip">Играть следующим</span></button></div>';
  });
  return html;
}
function credsHTML(a) {
  const g = [];
  if (a.producers.length) g.push('<div class="cg"><span>Продюсеры</span><p>' + a.producers.slice(0, 3).map(p => '<button type="button" class="lnk" data-act="producer" data-n="' + esc(p.n) + '">' + esc(p.n) + '</button>').join(', ') + '</p></div>');
  if (a.label) g.push('<div class="cg"><span>Лейбл</span><p>' + esc(a.label) + '</p></div>');
  const more = (a.more || []).filter(m => m.c && SM[m.c]).sort((x, y) => (byId[y.id] ? 1 : 0) - (byId[x.id] ? 1 : 0)).slice(0, 6);   // the mock has nine albums: those first
  if (more.length) g.push('<div class="cg"><span>Ещё у артиста</span><div class="stack">' + more.map(m => '<button type="button" data-act="more" data-id="' + m.id + '" title="' + esc(m.title) + (m.year ? ' · ' + m.year : '') + '"><img src="' + SM[m.c] + '" alt=""></button>').join('') + '</div></div>');
  return g.length ? '<div class="creds">' + g.join('') + '</div>' : '';
}
const paper = a => '<div class="paper" style="background-image:url(' + a.bg + ')"></div><div class="shade"></div>';
const X = '<button type="button" class="x" data-act="close" aria-label="Закрыть">' + icon('Close', 16) + '</button>';

/* the three layouts of the back */
function backHTML(v, a) {
  if (v === 'A') return paper(a) + '<div class="body">' +
    '<div class="hero rise"><div class="mini-sl"><span class="rec"><span class="vinyl"><span class="lbl" style="background:' + labelBg(a) + '"></span></span></span><img src="' + a.cover + '" alt=""></div><div>' + headHTML(a) + '</div></div>' +
    '<div class="rise">' + actsHTML(a) + '</div><div class="list">' + listHTML(a) + credsHTML(a) + '</div></div>' + X;
  if (v === 'B') return paper(a) + '<div class="body"><div class="liner rise">' + credsHTML(a).replace('class="creds"', 'class="creds" style="padding:0"') + '</div>' +
    '<div class="poster rise">' + headHTML(a) + actsHTML(a) + '</div></div><div class="under"></div>';
  return paper(a) + '<div class="body"><div class="hero rise">' + headHTML(a) + '</div><div class="rise">' + actsHTML(a) + '</div><div class="list">' + listHTML(a) + credsHTML(a) + '</div></div>' + X;
}
const leafHTML = a => '<div class="face inn">' + paper(a) + '<div class="body lb"><div class="lh"><b>Треки</b><span>' + a.tracks.length + ' · ' + span(total(a)) + '</span></div><div class="list">' + listHTML(a) + '</div></div>' + X + '<div class="crease"></div><div class="lit"></div></div>' +
  '<div class="face out">' + paper(a) + '</div>';

/* the record of «Пластинка»: the album's tracks as bands, outer edge first */
const R_OUT = 47.5, R_IN = 21;
function bandsOf(a) { const T = total(a) || 1; let c = 0; return a.tracks.map(t => { const r0 = R_OUT - (R_OUT - R_IN) * c / T; c += t.ms || 0; const r1 = R_OUT - (R_OUT - R_IN) * c / T; return { r0, r1 }; }); }
function recordHTML(a) {
  const b = bandsOf(a);
  const svg = '<svg class="bands" viewBox="0 0 100 100" aria-hidden="true">' +
    b.map((x, i) => '<circle class="hl" data-k="' + i + '" cx="50" cy="50" r="' + ((x.r0 + x.r1) / 2).toFixed(2) + '" stroke-width="' + Math.max(.4, x.r0 - x.r1 - .5).toFixed(2) + '"/>').join('') +
    b.slice(1).map(x => '<circle class="gap" cx="50" cy="50" r="' + x.r0.toFixed(2) + '" stroke-width=".9"/>').join('') +
    '<circle class="gap" cx="50" cy="50" r="' + R_OUT + '" stroke-width=".5"/>' +
    b.map((x, i) => '<circle class="hit" data-k="' + i + '" cx="50" cy="50" r="' + ((x.r0 + x.r1) / 2).toFixed(2) + '" stroke-width="' + Math.max(.6, x.r0 - x.r1).toFixed(2) + '"><title>' + esc(a.tracks[i].t) + '</title></circle>').join('') + '</svg>';
  const label = '<svg viewBox="0 0 100 100" aria-hidden="true"><defs><path id="lt" d="M 16 50 A 34 34 0 0 1 84 50"/><path id="lb" d="M 12 50 A 38 38 0 0 0 88 50"/></defs>' +
    '<text text-anchor="middle"><textPath href="#lt" startOffset="50%">' + esc(a.title.slice(0, 34)) + '</textPath></text>' +
    '<text text-anchor="middle"><textPath href="#lb" startOffset="50%">' + esc(artistOf(a)) + (a.year ? ' · ' + a.year : '') + '</textPath></text></svg>';
  return '<div class="bigrec"><div class="spin"><div class="vinyl">' + svg + '<div class="lbl" data-act="play" style="background:' + labelBg(a) + '">' + label + '<span class="pp">' + icon('Play', 22) + '</span></div></div></div><div class="glare"></div>' +
    '<svg class="arm" aria-hidden="true"></svg></div>';
}

/* ── the gatefold ───────────────────────────────────────────────────────── */
let G = null;
function dims(v) {
  const { w, h } = size, room = h - 86 - 44, cap = h >= 1300 ? 1 : 0;
  if (v === 'A') return Math.round(Math.min(room, cap ? 960 : 800, w * .6));
  if (v === 'B') return Math.round(Math.min(room * .92, (w - 260) / 2, cap ? 900 : 720));
  return Math.round(Math.min(room * .92, (w - 260) / 1.62, cap ? 900 : 720));
}

function open(a, fromEl) {
  const v = V, L = dims(v), ac = accent(a);
  const root = document.createElement('div');
  root.innerHTML = '<div class="scrim"></div><div class="gf ' + v + '" role="dialog" aria-modal="true" aria-label="' + esc(a.title) + '" style="--L:' + L + 'px;--gy:' + Math.round((size.h - 86) / 2) + 'px;--acc:' + ac.acc + ';--on-acc:' + ac.on + '">' +
    (v === 'C' ? recordHTML(a) : '') +
    '<div class="sleeve"><div class="flip"><div class="face front"><img src="' + a.cover + '" alt=""></div><div class="face back">' + backHTML(v, a) + '</div></div></div>' +
    (v === 'B' ? '<div class="leaf">' + leafHTML(a) + '</div>' : '') + '</div>';
  stage.appendChild(root); icons(root);
  const gf = $('.gf', root), sleeve = $('.sleeve', root), flip = $('.flip', root), scrim = $('.scrim', root);
  G = { a, v, L, root, gf, sleeve, flip, scrim, rot: 180, busy: true, spin: null, spinRec: null };
  G.sync = () => sync(); G.marks = () => marks(); G.progress = () => progress();
  if (v === 'C') drawArm();
  sync(); marks();

  const card = cardOf(a.id);
  const homeT = () => { const c = cardOf(G.a.id); if (!c) return 'translate(0px,' + (size.h * .6) + 'px) scale(.2)';
    const f = $('.sleeveImg', c).getBoundingClientRect(), e = sleeve.getBoundingClientRect();
    return 'translate(' + ((f.left + f.width / 2) - (e.left + e.width / 2)) / S + 'px,' + ((f.top + f.height / 2) - (e.top + e.height / 2)) / S + 'px) scale(' + (f.width / e.width) + ')'; };
  G.homeT = homeT;
  const from = homeT();
  if (card) card.dataset.open = 'true';
  // v1's fly-in and flip, unchanged: the sleeve leaves the grid and turns over on its way
  scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease' });
  sleeve.style.transform = from;
  run(sleeve, [{ transform: from }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.3,.75,.25,1)' });
  run(flip, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }], { duration: 850, delay: 60, easing: 'cubic-bezier(.35,.72,.22,1)' });
  after(v);
}

/* what each variant does once the sleeve has turned over */
async function after(v) {
  const g = G;
  if (v === 'A') {
    rise(g, 450);
    await wait(620); if (G !== g) return;
    const rec = $('.mini-sl .rec', g.root);
    run(rec, [{ transform: 'translateX(0) rotate(-120deg)' }, { transform: 'translateX(46%) rotate(0deg)' }], { duration: 760, easing: 'cubic-bezier(.2,.85,.25,1)' });
    await wait(760); g.busy = false; sync(); return;
  }
  if (v === 'B') {
    rise(g, 860 + 160);
    await wait(860); if (G !== g) return;
    await unfold(g);
    g.busy = false; sync(); return;
  }
  rise(g, 820 + 120);
  await wait(820); if (G !== g) return;
  await slideOut(g);
  g.busy = false; sync();
}
function rise(g, at) {
  const els = $$('.rise', g.root).filter(e => !e.closest('.leaf'));
  els.forEach((el, k) => run(el, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 550, delay: at + k * 100, easing: 'cubic-bezier(.22,.9,.3,1)' }));
  const rows = $$('.list .row, .list .disc-h', g.root).slice(0, 18);
  rows.forEach((el, k) => el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: reduce ? 0 : at + 170 + k * 28, easing: 'cubic-bezier(.22,.9,.3,1)', fill: 'backwards' }));
}
async function unfold(g) {
  const leaf = $('.leaf', g.root), inn = $('.lit', leaf), under = $('.under', g.root);
  g.gf.classList.add('open'); leaf.style.visibility = 'visible';
  const d = 780, e = 'cubic-bezier(.3,1.12,.4,1)';
  run(g.gf, [{ transform: 'translateX(0)' }, { transform: 'translateX(' + (-g.L / 2) + 'px)' }], { duration: d, easing: 'cubic-bezier(.25,.9,.3,1)' });
  run(inn, [{ opacity: .6 }, { opacity: 0 }], { duration: d, easing: 'ease-out' });
  run(under, [{ opacity: .9 }, { opacity: 0 }], { duration: d * .8, easing: 'ease-out' });
  await run(leaf, [{ transform: 'rotateY(-180deg)' }, { transform: 'rotateY(0deg)' }], { duration: d, easing: e });
}
async function fold(g) {
  const leaf = $('.leaf', g.root), inn = $('.lit', leaf), under = $('.under', g.root);
  const d = 420, e = 'cubic-bezier(.55,.06,.6,.9)';
  run(g.gf, [{ transform: 'translateX(' + (-g.L / 2) + 'px)' }, { transform: 'translateX(0)' }], { duration: d, easing: e });
  run(inn, [{ opacity: 0 }, { opacity: .6 }], { duration: d, easing: 'ease-in' });
  run(under, [{ opacity: 0 }, { opacity: .9 }], { duration: d, easing: 'ease-in' });
  await run(leaf, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-180deg)' }], { duration: d, easing: e });
  leaf.style.visibility = 'hidden'; g.gf.classList.remove('open');
}
async function slideOut(g) {
  const rec = $('.bigrec', g.root), sp = $('.spin', rec);
  rec.style.opacity = 1;
  const d = 900, e = 'cubic-bezier(.2,.85,.25,1)', dx = g.L * .6;
  run(g.gf, [{ transform: 'translateX(0)' }, { transform: 'translateX(' + (-dx / 2) + 'px)' }], { duration: d, easing: e });
  run(sp, [{ transform: 'rotate(-150deg)' }, { transform: 'rotate(0deg)' }], { duration: d, easing: e });
  await run(rec, [{ transform: 'translateX(0)' }, { transform: 'translateX(' + dx + 'px)' }], { duration: d, easing: e });
}
async function slideIn(g) {
  const rec = $('.bigrec', g.root), d = 420, e = 'cubic-bezier(.55,.06,.6,.9)', dx = g.L * .6;
  armTo(g, null);
  run(g.gf, [{ transform: 'translateX(' + (-dx / 2) + 'px)' }, { transform: 'translateX(0)' }], { duration: d, easing: e });
  await run(rec, [{ transform: 'translateX(' + dx + 'px)' }, { transform: 'translateX(0)' }], { duration: d, easing: e });
  rec.style.opacity = 0;
}

async function close() {
  const g = G; if (!g || g.closing) return; g.closing = true; g.busy = true;
  stopSpin(g);
  if (g.v === 'B' && g.gf.classList.contains('open')) await fold(g);
  if (g.v === 'C') await slideIn(g);
  const to = g.homeT();
  run(g.flip, [{ transform: 'rotateY(' + g.rot + 'deg)' }, { transform: 'rotateY(' + (g.rot + 180) + 'deg)' }], { duration: 500, easing: 'cubic-bezier(.5,.08,.4,1)' });
  run(g.sleeve, [{ transform: 'none' }, { transform: to }], { duration: 450, easing: 'cubic-bezier(.55,.06,.5,.9)' });
  g.scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, delay: 150, easing: 'ease', fill: 'forwards' });
  await wait(470);
  const card = cardOf(g.a.id); if (card) card.dataset.open = 'false';
  g.root.remove(); if (G === g) G = null;
}

/* «Ещё у артиста»: the sleeve turns over to the other album */
async function swap(id) {
  const g = G, b = byId[id];
  if (!g || g.busy) return;
  if (!b) { toast('В макете только девять альбомов: этот откроется в приложении'); return; }
  g.busy = true; stopSpin(g);
  if (g.v === 'B') await fold(g);
  if (g.v === 'C') await slideIn(g);
  $('.front img', g.root).src = b.cover;
  const old = cardOf(g.a.id); if (old) old.dataset.open = 'false';
  await run(g.flip, [{ transform: 'rotateY(' + g.rot + 'deg)' }, { transform: 'rotateY(' + (g.rot + 180) + 'deg)' }], { duration: 520, easing: 'cubic-bezier(.45,0,.55,1)' });
  g.rot += 180; g.a = b;
  const ac = accent(b); g.gf.style.setProperty('--acc', ac.acc); g.gf.style.setProperty('--on-acc', ac.on); g.gf.setAttribute('aria-label', b.title);
  $('.face.back', g.root).innerHTML = backHTML(g.v, b);
  if (g.v === 'B') $('.leaf', g.root).innerHTML = leafHTML(b);
  if (g.v === 'C') { const old2 = $('.bigrec', g.root); old2.outerHTML = recordHTML(b); drawArm(); }
  icons(g.root);
  const nc = cardOf(b.id); if (nc) nc.dataset.open = 'true';
  $$('.rise', g.root).forEach(el => el.style.opacity = 0);
  sync(); marks();
  rise(g, g.v === 'A' ? 260 : g.v === 'B' ? 640 + 160 : 640 + 120);
  await run(g.flip, [{ transform: 'rotateY(' + g.rot + 'deg)' }, { transform: 'rotateY(' + (g.rot + 180) + 'deg)' }], { duration: 640, easing: 'cubic-bezier(.3,.75,.25,1)' });
  g.rot += 180;
  if (g.v === 'A') { const rec = $('.mini-sl .rec', g.root); await run(rec, [{ transform: 'translateX(0) rotate(-120deg)' }, { transform: 'translateX(46%) rotate(0deg)' }], { duration: 700, easing: 'cubic-bezier(.2,.85,.25,1)' }); }
  if (g.v === 'B') await unfold(g);
  if (g.v === 'C') await slideOut(g);
  g.busy = false; sync();
}

/* what plays, shown by the things themselves: the button, the row, the record, the arm */
function sync() {
  const g = G; if (!g) return;
  const mine = P.a === g.a, on = mine && P.playing;
  $$('.play', g.root).forEach(b => { b.dataset.on = on; $('.pl', b).textContent = on ? 'Пауза' : mine ? 'Продолжить' : 'Слушать'; });
  $$('.row', g.root).forEach(r => { const cur = mine && +r.dataset.k === P.i; r.classList.toggle('on', cur); r.classList.toggle('playing', cur && P.playing); });
  $$('.bigrec .hl', g.root).forEach(c => c.classList.toggle('cur', mine && +c.dataset.k === P.i));
  const pp = $('.bigrec .pp', g.root); if (pp) pp.innerHTML = icon(on ? 'Pause' : 'Play', 22);
  if (g.busy) return;
  const spinner = g.v === 'A' ? $('.mini-sl .rec .vinyl', g.root) : g.v === 'C' ? $('.bigrec .spin', g.root) : null;
  if (spinner) on ? startSpin(g, spinner) : stopSpin(g);
  if (g.v === 'C') armTo(g, on || (mine && P.t > 0) ? albumPos() : null);
}
function marks() {
  const g = G; if (!g) return;
  $$('.row', g.root).forEach(r => { const q = $('.q', r), k = Q.findIndex(x => x.a === g.a && x.i === +r.dataset.k);
    if (k >= 0) { q.dataset.n = k + 1; $('.k', q).textContent = k + 1; $('.tip', q).textContent = 'Убрать из очереди'; } else { delete q.dataset.n; $('.tip', q).textContent = 'Играть следующим'; } });
}
/* the record turns up to speed and runs down, never starts or stops dead */
function startSpin(g, el) {
  if (reduce) return;
  if (g.spin && g.spinEl === el) { ramp(g.spin, g.spin.playbackRate, 1, 500); return; }
  g.spin?.cancel(); g.spinEl = el;
  g.spin = el.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: g.v === 'C' ? 1800 : 2400, iterations: Infinity, composite: 'add' });
  g.spin.playbackRate = 0; ramp(g.spin, 0, 1, 600);
}
function stopSpin(g) { if (g.spin) ramp(g.spin, g.spin.playbackRate, 0, 700); }
function ramp(an, a, b, ms) { const t0 = performance.now(); an._ramp = t0;
  const step = now => { if (an._ramp !== t0) return; const k = Math.min(1, (now - t0) / ms), e = 1 - (1 - k) ** 2; an.updatePlaybackRate(a + (b - a) * e); if (k < 1) requestAnimationFrame(step); else if (b === 0) an.pause(); else if (an.playState === 'paused') an.play(); };
  if (an.playState === 'paused' && b > 0) an.play(); requestAnimationFrame(step); }

/* the tone arm: a pivot off the record's top right; the needle sits on the playing band */
function albumPos() { const T = total(G.a) || 1; let c = 0; for (let k = 0; k < P.i; k++) c += G.a.tracks[k].ms || 0; return Math.min(1, (c + P.t) / T); }
const ARM = { px: 101, py: 6, len: 74 };   // in the record's own units (0..100 = its box)
function drawArm() {
  const svg = $('.bigrec .arm', G.root); if (!svg) return;
  svg.setAttribute('viewBox', '0 0 100 100'); svg.style.left = 0; svg.style.top = 0; svg.style.width = '100%'; svg.style.height = '100%';
  const { px, py, len } = ARM;
  svg.innerHTML = '<defs><linearGradient id="metal" x1="0" x2="1"><stop offset="0" stop-color="#9a9aa3"/><stop offset=".5" stop-color="#e8e8ee"/><stop offset="1" stop-color="#7d7d86"/></linearGradient></defs>' +
    '<circle cx="' + px + '" cy="' + py + '" r="5.2" fill="#1b1b20" stroke="rgba(255,255,255,.12)" stroke-width=".4"/>' +
    '<g class="rot" style="transform-origin:' + px + 'px ' + py + 'px;transform:rotate(-6deg)">' +
    '<rect x="' + (px - 2.6) + '" y="' + (py - 9) + '" width="5.2" height="6" rx="1.2" fill="#2a2a31"/>' +
    '<rect x="' + (px - .7) + '" y="' + py + '" width="1.4" height="' + (len - 6) + '" rx=".7" fill="url(#metal)"/>' +
    '<rect x="' + (px - 2.4) + '" y="' + (py + len - 7) + '" width="4.8" height="8" rx="1" fill="#2c2c33" stroke="rgba(255,255,255,.18)" stroke-width=".3"/>' +
    '<circle cx="' + px + '" cy="' + py + '" r="2.4" fill="url(#metal)"/></g>';
}
function angleFor(r) {   // the first angle (from straight down, towards the record) where the needle is r from the centre
  const { px, py, len } = ARM; let best = 0;
  for (let d = 0; d <= 60; d += .1) { const th = d * Math.PI / 180, nx = px - len * Math.sin(th), ny = py + len * Math.cos(th);
    if (Math.hypot(nx - 50, ny - 50) <= r) { best = d; break; } best = d; }
  return best;
}
function armTo(g, pos) {
  const rot = $('.bigrec .arm .rot', g.root); if (!rot) return;
  const deg = pos == null ? -6 : angleFor(R_OUT - .8 - (R_OUT - R_IN - 1.5) * pos);
  const was = rot._deg ?? -6; rot._deg = deg;
  const jump = Math.abs(deg - was) > 1.5;
  rot.style.transition = reduce ? 'none' : jump ? 'transform .9s cubic-bezier(.3,1.25,.45,1)' : 'transform .25s linear';
  rot.style.transform = 'rotate(' + deg.toFixed(2) + 'deg)';
}
function progress() { const g = G; if (g && g.v === 'C' && !g.busy && P.a === g.a && P.playing) armTo(g, albumPos()); }

/* one listener for everything inside the gatefold */
stage.addEventListener('click', e => {
  const g = G; if (!g) return;
  if (e.target.classList.contains('scrim')) return close();
  const act = e.target.closest('[data-act]'), row = e.target.closest('.row'), hit = e.target.closest('.hit');
  if (hit && g.root.contains(hit)) { play(g.a, +hit.dataset.k); return; }
  if (act && g.root.contains(act)) {
    const k = act.dataset.act;
    if (k === 'close') return close();
    if (k === 'play') { if (P.a === g.a) { P.playing = !P.playing; setNow(); } else play(g.a, 0); return; }
    if (k === 'artist') { toast('Откроется страница: ' + artistOf(g.a)); return close(); }
    if (k === 'producer') { toast('Поиск по продюсеру: ' + act.dataset.n); return; }
    if (k === 'more') return swap(act.dataset.id);
    if (k === 'queue') { e.stopPropagation(); toggleQueue(g.a, +row.dataset.k, act); return; }
  }
  if (row && g.root.contains(row)) play(g.a, +row.dataset.k);
});
stage.addEventListener('keydown', e => { const row = e.target.closest?.('.row'); if (row && G && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); play(G.a, +row.dataset.k); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && G) close(); });
/* the record and the list answer each other */
stage.addEventListener('pointerover', e => {
  const g = G; if (!g || g.v !== 'C') return;
  const row = e.target.closest('.row'), hit = e.target.closest('.hit');
  const i = row ? +row.dataset.k : hit ? +hit.dataset.k : -1;
  $$('.bigrec .hl', g.root).forEach(c => c.classList.toggle('on', +c.dataset.k === i));
  $$('.row', g.root).forEach(r => r.classList.toggle('hov', !!hit && +r.dataset.k === i));
  if (hit) { const r = $('.row[data-k="' + i + '"]', g.root); r && r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
});

/* ── the page's switches ────────────────────────────────────────────────── */
function reopen() { if (!G) return; const a = G.a, card = cardOf(a.id); G.root.remove(); if (card) card.dataset.open = 'false'; G = null; open(a, card); }
$('#vars').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$('#vars button').forEach(x => x.setAttribute('aria-pressed', x === b)); V = b.dataset.v;
  $$('#notes section[data-for]').forEach(s => s.dataset.on = s.dataset.for === V); if (G) reopen(); else open(AL[0], cardOf(AL[0].id)); });
$('#sizes').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$('#sizes button').forEach(x => x.setAttribute('aria-pressed', x === b)); size = { w: +b.dataset.w, h: +b.dataset.h }; fit(); if (G) reopen(); });
window.addEventListener('resize', fit);

icons(document); fit(); setNow();
$$('#notes section[data-for]').forEach(s => s.dataset.on = s.dataset.for === V);
setTimeout(() => { if (!G) open(AL[0], cardOf(AL[0].id)); }, 700);
})();
