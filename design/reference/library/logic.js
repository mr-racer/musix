(() => {
const D = window.DATA, IC = window.ICONS;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPRING = 'cubic-bezier(.34,1.56,.64,1)', EASE = 'cubic-bezier(.22,.9,.3,1)', SETTLE = 'cubic-bezier(.25,1.12,.35,1)';

function icon(name, size) { const d = IC[name]; if (!d) return '';
  return '<svg class="i" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true">' + d.d.map((p, i) => d.fill.includes(i) ? '<path d="' + p + '" fill="currentColor"/>' : '<path d="' + p + '" fill="none" stroke="currentColor" stroke-width="' + d.w + '" stroke-linecap="round" stroke-linejoin="round"/>').join('') + '</svg>'; }
function icons(root) { $$('[data-ic]', root).forEach(el => { const [n, s] = el.dataset.ic.split(':'); el.outerHTML = icon(n, +s).replace('class="i"', 'class="i' + (n === 'ChevronDown' ? ' chev' : '') + '"'); }); }
const NOTE = '<svg class="i" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" fill="currentColor"/><circle cx="17" cy="16" r="3" fill="currentColor"/></svg>';
const PLAY = icon('Play', 18), PLAY_S = icon('Play', 14), CHEV = icon('ChevronRight', 16);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plural = (n, a, b, c) => { const x = n % 10, y = n % 100; return x === 1 && y !== 11 ? a : x >= 2 && x <= 4 && (y < 10 || y >= 20) ? b : c; };
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTH = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MSHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const day = iso => { const d = new Date(iso); return d.getDate() + ' ' + MON[d.getMonth()]; };
const norm = s => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const nAlb = n => n + ' ' + plural(n, 'альбом', 'альбома', 'альбомов');
const nArt = n => n + ' ' + plural(n, 'артист', 'артиста', 'артистов');
const nSong = n => n + ' ' + plural(n, 'песня', 'песни', 'песен');

/* ── data ──────────────────────────────────────────────────────────────── */
const AL = D.albums, byId = Object.fromEntries(AL.map(a => [a.id, a]));
const AR = D.artists, arById = Object.fromEntries(AR.map(a => [a.id, a]));
const TR = D.tracks.map(t => ({ id: t[0], t: t[1], ar: t[2], al: t[3], arId: t[4], p: t[5] }));
const CL = Object.fromEntries(D.clusters.map(c => [c.id, c]));
AL.forEach(a => { a.nt = norm(a.t); a.na = norm(a.ar); });
AR.forEach(a => { a.nn = norm(a.name); });
TR.forEach(t => { t.nt = norm(t.t); t.na = norm(t.ar); });
const today = new Date(2026, 9, 11);
const doy = Math.round((today - new Date(today.getFullYear(), 0, 0)) / 864e5);
const PICK = D.picks[doy % D.picks.length], DAY = byId[PICK.id];
const sealed = a => !a.p;
const sealedCount = () => AL.filter(sealed).length;
const topTrack = pred => TR.filter(pred).sort((x, y) => y.p - x.p)[0];
const hueOf = s => [...s].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
const RN = (() => { try { return new Intl.DisplayNames(['ru'], { type: 'region' }); } catch (e) { return null; } })();
const FLAGS = D.flags || {};
const flagHtml = cc => cc && FLAGS[cc] ? '<span class="flag" style="background-image:url(' + FLAGS[cc] + ')"></span>' : '';
const SHORT_RU = { US: 'США', GB: 'Великобритания', AE: 'ОАЭ' };
const countryName = c => { if (!c) return null; if (SHORT_RU[c]) return SHORT_RU[c]; try { const n = RN?.of(c); return n && n !== c ? n : null; } catch (e) { return null; } };
const labelBg = a => 'radial-gradient(circle at 38% 32%, color-mix(in srgb,' + (a.acc || '#888') + ' 70%, white), ' + (a.acc || '#444') + ' 72%)';
const phOf = x => x.pal && x.pal[0] ? 'linear-gradient(145deg,' + x.pal[0] + ',' + (x.pal[1] || x.pal[0]) + ')' : '#202026';

/* ── pictures: atlases of 8 × 8 covers, loaded per sheet; a cover develops when its sheet is
   there (the app does the same per picture: colour → 20 px sketch → the cover) ──────── */
const SHEETS = {}, G = D.sheets.g || 8;
const pos = s => ((s[1] % G) / (G - 1) * 100) + '% ' + (Math.floor(s[1] / G) / (G - 1) * 100) + '%';
const url = key => 'img/' + key + '.jpg';
const ready = key => SHEETS[key]?.ready;
/* the inline style of a cover: its place in the sheet, the picture itself once the sheet is in */
const cvStyle = (s, k, force) => 'background-position:' + pos(s) + ';' + (force || ready(k + s[0]) ? 'background-image:url(' + url(k + s[0]) + ')' : '');
const bgFull = (s, k) => s ? 'background-image:url(' + url(k + s[0]) + ');background-position:' + pos(s) : '';
function want(key) {
  const sh = SHEETS[key] || (SHEETS[key] = { ready: false, asked: false, img: null });
  if (sh.ready || sh.asked) return;
  sh.asked = true;
  const go = () => { const im = new Image(); im.src = url(key); sh.img = im; (im.decode ? im.decode() : Promise.reject()).then(() => reveal(key), () => { im.onload = () => reveal(key); }); };
  if (S.slow) setTimeout(go, 600 + Math.random() * 2800); else go();
}
function reveal(key) {
  const sh = SHEETS[key]; if (!sh || sh.ready) return; sh.ready = true;
  const r = scroll.getBoundingClientRect(), u = 'url(' + url(key) + ')';
  $$('[data-sh="' + key + '"]').forEach(el => {
    el.style.backgroundImage = u;
    const ph = el.previousElementSibling?.classList.contains('ph') ? el.previousElementSibling : null;
    const b = el.getBoundingClientRect();
    if (reduce || b.bottom < r.top || b.top > r.bottom || b.right < r.left) { ph?.remove(); return; }
    const d = ((b.left - r.left) + (b.top - r.top)) / (r.width + r.height) * 520 + Math.random() * 70;
    el.animate([{ opacity: 0, filter: 'blur(12px) saturate(.7)', transform: 'scale(1.06)' }, { opacity: 1, filter: 'blur(0px) saturate(1)', transform: 'scale(1)' }],
      { duration: 680, delay: d, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'backwards' });
    if (ph) setTimeout(() => ph.remove(), d + 720);
  });
}
let io = null;
function wantShown() {
  io = io || new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { want(e.target.dataset.sh); io.unobserve(e.target); } }), { root: scroll, rootMargin: '900px 0px' });
  io.disconnect(); $$('#shelf [data-sh]').forEach(el => { if (!ready(el.dataset.sh)) io.observe(el); });
}
function sheetCanvas(spec) { // 'a:3:17' → the sheet image and the source square
  const [k, n, j] = spec.split(':'); const im = SHEETS[k + n]?.img;
  if (!im || !im.naturalWidth) return null; const T = im.naturalWidth / G;
  return [im, (j % G) * T, Math.floor(j / G) * T, T, T];
}

/* ── state ─────────────────────────────────────────────────────────────── */
const S = { size: -1, tab: window.START_TAB || 'albums', sort: 'plays', lens: 'tags', sealed: false, view: 'grid', asort: 'plays', slow: false };
try { const v = localStorage.getItem('mx-lib2-size'); if (v != null) S.size = +v; } catch (e) {}
const SIZES = [[1280, 720], [1512, 982], [1728, 1117], [1920, 1080], [2560, 1440]];
const stage = $('#stage'), viewport = $('#viewport'), scroll = $('#scroll'), lib = $('#lib');
const plate = $('#plate'), rail = $('#rail'), rlabel = $('#rlabel');
let SC = 1, BAR = 72;
function fit() {
  let W, H;
  if (S.size < 0) { W = viewport.clientWidth; H = Math.max(600, Math.round(innerHeight - (viewport.getBoundingClientRect().top + window.scrollY) - 14)); }
  else [W, H] = SIZES[S.size];
  stage.style.width = W + 'px'; stage.style.height = H + 'px';
  stage.style.setProperty('--tile', (W < 1400 ? 190 : W < 1800 ? 208 : W < 2200 ? 224 : 244) + 'px');
  SC = S.size < 0 ? 1 : Math.min(1, viewport.clientWidth / W);
  stage.style.transform = SC < 1 ? 'scale(' + SC + ')' : 'none';
  stage.style.marginInline = SC < 1 ? '0' : 'auto';
  viewport.style.height = Math.round(H * SC) + 'px';
  $('#sizeTag').textContent = W + ' × ' + H + (S.size < 0 ? ' · окно' : SC < 1 ? ' · показано в ' + Math.round(SC * 100) + ' %' : '');
  placeMarks(); fitLists(); measure(); drawRail(); onScroll();
}
function at(el) { const s = stage.getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x: (r.left - s.left) / SC, y: (r.top - s.top) / SC, w: r.width / SC, h: r.height / SC }; }

/* ── groups: every sort splits the wall ────────────────────────────────── */
const SORTS = { albums: [['plays', 'Слушаю чаще', 'группами по прослушиваниям'], ['new', 'Новые', 'по месяцу добавления'], ['az', 'А–Я', 'по буквам'], ['year', 'Год', 'по десятилетиям'], null, ['genre:tags', 'Жанр по тегам', 'из файлов'], ['genre:sound', 'Жанр по звучанию', 'по сонару вкуса']],
  artists: [['plays', 'Слушаю чаще', 'группами по прослушиваниям'], ['az', 'А–Я', 'по буквам'], ['country', 'По стране', 'откуда артист'], ['tracks', 'Больше песен', 'по числу песен']] };
const sortName = () => S.tab === 'albums' ? (S.sort === 'genre' ? (S.lens === 'sound' ? 'Жанр по звучанию' : 'Жанр по тегам') : SORTS.albums.find(o => o && o[0] === S.sort)[1]) : SORTS.artists.find(o => o[0] === S.asort)[1];
const BANDS_AL = ['Заслушаны до дыр', 'Часто', 'Иногда', 'Изредка', 'Пару раз', 'Ни разу'];
const BANDS_AR = ['Слушаю постоянно', 'Часто', 'Иногда', 'Изредка', 'Пару раз', 'Ни разу'];
function byBands(list, names, count) {
  const played = list.map(x => x.p).filter(v => v > 0).sort((a, b) => a - b);
  const q = f => played.length ? played[Math.min(played.length - 1, Math.floor(f * played.length))] : 1;
  const th = [q(.8), q(.6), q(.4), q(.2), 1];
  const band = v => v <= 0 ? 5 : v >= th[0] ? 0 : v >= th[1] ? 1 : v >= th[2] ? 2 : v >= th[3] ? 3 : 4;
  const range = b => { if (b === 5) return 'ещё не слушал'; const lo = b === 4 ? 1 : th[b], hi = b === 0 ? null : th[b - 1] - 1;
    return hi == null ? lo + '+ ' + plural(lo, 'раз', 'раза', 'раз') : lo === hi ? lo + ' ' + plural(lo, 'раз', 'раза', 'раз') : lo + '–' + hi + ' ' + plural(hi, 'раз', 'раза', 'раз'); };
  const g = new Map(); for (const x of list) { const b = band(x.p); if (!g.has(b)) g.set(b, []); g.get(b).push(x); }
  return [...g.entries()].sort((a, b) => a[0] - b[0]).map(([b, items]) => ({ key: 'b' + b, name: names[b], short: '', items: items.sort((x, y) => y.p - x.p || (y.last || '').localeCompare(x.last || '')),
    sub: count(items.length) + ' · ' + range(b) }));
}
const letterOf = s => { const c = (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().charAt(0).toUpperCase().replace('Ё', 'Е');
  return /[A-Z]/.test(c) ? c : /[А-Я]/.test(c) ? c : /[0-9]/.test(c) ? '0–9' : '#'; };
const letterRank = k => (/^[A-Z]$/.test(k) ? 0 : /^[А-Я]$/.test(k) ? 1 : k === '0–9' ? 2 : 3);
function byLetters(list, nameOf, count) {
  const g = new Map(); for (const x of list) { const k = letterOf(nameOf(x)); if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
  return [...g.entries()].sort((a, b) => letterRank(a[0]) - letterRank(b[0]) || a[0].localeCompare(b[0], 'ru'))
    .map(([k, items]) => ({ key: 'l' + k, name: k, short: k === '0–9' ? '0' : k, items: items.sort((x, y) => norm(nameOf(x)).localeCompare(norm(nameOf(y)), 'ru')), sub: count(items.length) }));
}
function group(list, keyOf, nameOf, shortOf, order, count) {
  const g = new Map(); for (const x of list) { const k = keyOf(x); if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
  return [...g.entries()].map(([k, items]) => ({ key: String(k), k, name: nameOf(k), short: shortOf(k), items: items.sort((x, y) => y.p - x.p), sub: count(items.length) })).sort(order);
}
function sections() {
  if (S.tab === 'artists') {
    if (S.asort === 'az') return byLetters(AR, a => a.name, nArt);
    if (S.asort === 'country') return group(AR, a => countryName(a.cc) ? a.cc : '—', k => k === '—' ? 'Страна не указана' : countryName(k), k => k === '—' ? '?' : k,
      (x, y) => (x.key === '—') - (y.key === '—') || y.items.length - x.items.length, nArt);
    if (S.asort === 'tracks') { const b = a => a.n >= 50 ? 0 : a.n >= 20 ? 1 : a.n >= 10 ? 2 : 3;
      return group(AR, b, k => ['50 песен и больше', '20–49 песен', '10–19 песен', 'До 10 песен'][k], () => '', (x, y) => x.k - y.k, nArt).map(s => (s.items.sort((x, y) => y.n - x.n), s)); }
    return byBands(AR, BANDS_AR, nArt);
  }
  const list = S.sealed ? AL.filter(sealed) : AL;
  if (S.sort === 'plays') return byBands(list, BANDS_AL, nAlb);
  if (S.sort === 'az') return byLetters(list, a => a.t, nAlb);
  if (S.sort === 'new') return group(list, a => a.add.slice(0, 7), k => { const [y, m] = k.split('-'); return MONTH[+m - 1] + (+y !== 2026 ? ' ' + y : ''); }, k => MSHORT[+k.split('-')[1] - 1],
    (x, y) => y.key.localeCompare(x.key), nAlb).map(s => (s.items.sort((a, b) => b.add.localeCompare(a.add) || (b.y || 0) - (a.y || 0)), s));
  if (S.sort === 'year') return group(list, a => a.y ? Math.floor(a.y / 10) * 10 : 0, k => k ? k + '-е' : 'Без года', k => k ? '’' + String(k % 100).padStart(2, '0') : '?', (x, y) => (y.k || -1) - (x.k || -1), nAlb);
  if (S.lens === 'sound') return group(list, a => a.cl ?? -1, k => CL[k]?.name || 'Без кластера', () => '', (x, y) => y.items.length - x.items.length, nAlb);
  return group(list, a => a.g, k => k, () => '', (x, y) => (x.key === 'Другое') - (y.key === 'Другое') || y.items.length - x.items.length, nAlb);
}

/* ── the bar ───────────────────────────────────────────────────────────── */
const TABS = [['albums', 'Альбомы', AL.length], ['artists', 'Артисты', AR.length], ['lists', 'Плейлисты', D.playlists.length], ['stats', 'Статистика', null]];
function toolsHtml() {
  const t = S.tab; let h = '';
  if (t === 'albums' || t === 'artists') {
    h += '<button type="button" class="sortpill" data-sortmenu aria-haspopup="menu" aria-expanded="false">' + icon('Bars', 15) + '<span>' + sortName() + '</span>' + icon('ChevronDown', 16).replace('class="i"', 'class="i chev"') + '</button>';
    if (t === 'albums') h += '<button type="button" class="chip" data-sealfilter aria-pressed="' + S.sealed + '" title="Не распечатаны: альбомы, которые ты ещё не слушал"><span class="wrap"></span><span class="lbl">Не распечатаны</span><small>' + sealedCount() + '</small></button>';
    h += '<div class="views" role="group" aria-label="Вид"><span class="thumb"></span><button type="button" data-view="grid" aria-pressed="' + (S.view === 'grid') + '" aria-label="Плиткой">' + icon('Grid', 16) + '</button><button type="button" data-view="rows" aria-pressed="' + (S.view === 'rows') + '" aria-label="Строками">' + icon('List', 16) + '</button></div>';
  }
  return h + '<button type="button" class="sbtn lg" data-search aria-label="Поиск по библиотеке">' + icon('Search', 18) + '<kbd>/</kbd></button>';
}
function barHtml() {
  return '<span class="ttl">Библиотека</span><div class="tabs" role="group" aria-label="Раздел">' + TABS.map(([k, n, c]) =>
    '<button type="button" data-tab="' + k + '" aria-pressed="' + (S.tab === k) + '">' + n + (c != null ? '<small>' + c + '</small>' : '') + '</button>').join('') +
    '<span class="ul"></span></div><span class="grow"></span><div class="tools">' + toolsHtml() + '</div>';
}
function renderBar() { const t = $('#bar .tools'); if (t) t.innerHTML = toolsHtml(); else $('#bar').innerHTML = barHtml(); placeMarks(); }
/* a mark placed for the first time appears where it belongs; after that it glides */
function place(el, props) {
  const first = !el.dataset.placed; if (first) el.style.transition = 'none';
  for (const k in props) el.style.setProperty(k, props[k]);
  if (first) { void el.offsetWidth; el.style.transition = ''; el.dataset.placed = '1'; }
}
function placeMarks() {
  const tb = $('.tabs [aria-pressed="true"]'), ul = $('.tabs .ul');
  if (tb && ul) place(ul, { '--x': tb.offsetLeft + 'px', '--w': tb.offsetWidth + 'px' });
  const vb = $('.views [aria-pressed="true"]'), th = $('.views .thumb');
  if (vb && th) place(th, { '--x': vb.offsetLeft + 'px' });
}

/* ── the shelf ─────────────────────────────────────────────────────────── */
const why = a => 'Ты слушал его <b>' + a.p + ' ' + plural(a.p, 'раз', 'раза', 'раз') + '</b>, но не ставил с ' + day(a.last) + '.';
const FILM = '<span class="film"><span class="sticker">не слушал</span></span>';
function albumTile(a) {
  const s = a.s, k = s ? 'a' + s[0] : '';
  return '<article class="card" data-id="' + a.id + '"' + (sealed(a) ? ' data-sealed' : '') + '>' +
    (s && ready(k) ? '' : '<div class="ph" style="--ph:' + phOf(a) + '">' + (a.lq ? '<img src="' + a.lq + '" alt="">' : '') + '</div>') +
    (s ? '<div class="cv" data-sh="' + k + '" data-s="a:' + s[0] + ':' + s[1] + '" style="' + cvStyle(s, 'a') + '"></div>' : '') + (sealed(a) ? FILM : '') +
    '<div class="cap"><b>' + esc(a.t) + '</b><small>' + esc(a.ar) + (a.y ? ' · ' + a.y : '') + '</small></div>' +
    '<button type="button" class="play" data-play aria-label="Слушать «' + esc(a.t) + '»">' + PLAY + '</button></article>';
}
function dayBand() {
  const a = DAY, min = Math.round((a.ms || 0) / 60000);
  return '<section class="dayband" data-dayband style="--day-acc:' + a.acc + '"><div class="lit" style="background-image:url(' + PICK.bg + ')"></div>' +
    '<div class="sl" data-open-day><span class="vinyl"><span class="lbl" style="background:' + labelBg(a) + '"></span></span><img src="' + PICK.big + '" alt=""></div>' +
    '<div class="tx"><span class="dl">Пластинка дня<small>' + day(today) + '</small></span><h2>' + esc(a.t) + '</h2>' +
    '<span class="ar"><span class="alink">' + esc(a.ar) + '</span>' + (a.y ? ' · ' + a.y : '') + '</span><p class="why">' + why(a) + '</p>' +
    '<span class="facts">' + nSong(a.n) + ' · ' + min + ' мин · ' + esc(a.g) + '</span>' +
    '<div class="acts"><button type="button" class="btnPlay" data-play-day>' + PLAY_S + 'Слушать</button><button type="button" class="btnSoft" data-open-day>Открыть разворот</button></div></div></section>';
}
function artistTile(a) {
  const s = a.s;
  return '<article class="card ar" data-artist="' + a.id + '">' + (s ? (ready('r' + s[0]) ? '' : '<div class="ph" style="--ph:' + phOf(a) + '">' + (a.lq ? '<img src="' + a.lq + '" alt="">' : '') + '</div>') + '<div class="cv" data-sh="r' + s[0] + '" data-s="r:' + s[0] + ':' + s[1] + '" style="' + cvStyle(s, 'r') + '"></div>'
    : '<div class="monoT" style="--h:' + hueOf(a.name) + '">' + esc([...a.name][0]) + '</div>') +
    '<div class="cap on"><b>' + esc(a.name) + '</b><small>' + (a.al ? nAlb(a.al) + ' · ' : '') + nSong(a.n) + '</small></div>' +
    '<button type="button" class="play" data-play-artist aria-label="Слушать ' + esc(a.name) + '">' + PLAY + '</button></article>';
}
const thumb = (s, k, x) => '<div class="rc">' + (s ? (ready(k + s[0]) ? '' : '<div class="ph" style="--ph:' + phOf(x) + '">' + (x.lq ? '<img src="' + x.lq + '" alt="">' : '') + '</div>') + '<div class="cv" data-sh="' + k + s[0] + '" data-s="' + k + ':' + s[0] + ':' + s[1] + '" style="' + cvStyle(s, k) + '"></div>'
  : '<div class="monoT" style="--h:' + hueOf(x.name || x.t) + ';font-size:22px;padding:0">' + esc([...(x.name || x.t)][0]) + '</div>');
const maxAP = Math.max(1, ...AL.map(a => a.p)), maxRP = Math.max(1, ...AR.map(a => a.p));
const listened = (p, mx) => p ? '<span class="pl"><i style="--f:' + Math.sqrt(p / mx).toFixed(3) + '"></i>' + p + '</span>' : '<span><span class="new">не слушал</span></span>';
function albumRow(a) {
  const other = S.sort === 'genre' && S.lens === 'tags' ? (CL[a.cl]?.name || '—') : a.g;
  return '<div class="row" data-id="' + a.id + '"' + (sealed(a) ? ' data-sealed' : '') + '>' + thumb(a.s, 'a', a) + (sealed(a) ? FILM : '') + '</div>' +
    '<b>' + esc(a.t) + '</b><span class="m">' + esc(a.ar) + '</span><span class="n">' + (a.y || '—') + '</span><span class="m">' + esc(other) + '</span>' + listened(a.p, maxAP) +
    '<button type="button" class="rp" data-play aria-label="Слушать">' + PLAY_S + '</button></div>';
}
function artistRow(a) {
  return '<div class="row" data-artist="' + a.id + '">' + thumb(a.s, 'r', a) + '</div><b>' + esc(a.name) + '</b><span class="n">' + (a.al || '—') + '</span><span class="n">' + a.n + '</span>' + listened(a.p, maxRP) +
    '<button type="button" class="rp" data-play-artist aria-label="Слушать">' + PLAY_S + '</button></div>';
}
let SECS = [];
function renderShelf(flipIt) {
  const shelf = $('#shelf'), old = flipIt ? snapshot() : null;
  let h = '';
  SECS = [];
  if (S.tab === 'albums' || S.tab === 'artists') {
    const art = S.tab === 'artists';
    SECS = sections();
    if (!art && !S.sealed) h += dayBand();
    if (!SECS.length) h = '<p class="empty">Всё распечатано: каждый альбом ты открывал или слушал.</p>';
    if (S.view === 'rows' && SECS.length) h += '<div class="rows' + (art ? ' ar' : '') + '" style="padding-top:12px"><div class="rhead"><span></span>' +
      (art ? '<span>Артист</span><span>Альбомы</span><span>Песни</span>' : '<span>Альбом</span><span>Артист</span><span>Год</span><span>' + (S.sort === 'genre' && S.lens === 'tags' ? 'Звучание' : 'Жанр') + '</span>') + '<span>Прослушано</span><span></span></div></div>';
    SECS.forEach((s, i) => {
      h += '<section class="sec" data-sec="' + i + '"><header class="sh">' + (isCountry() ? flagHtml(s.key) : '') + '<h2 data-jump>' + esc(s.name) + '</h2><span class="sub">' + esc(s.sub) + '</span>' +
        '<button type="button" class="dp" data-play-sec="' + i + '">' + PLAY_S + 'Слушать группу</button></header>';
      if (S.view === 'grid') h += '<div class="wall">' + s.items.map(art ? artistTile : albumTile).join('') + '</div>';
      else h += '<div class="rows' + (art ? ' ar' : '') + '">' + s.items.map(art ? artistRow : albumRow).join('') + '</div>';
      h += '</section>';
    });
  } else if (S.tab === 'lists') {
    h = '<div class="pwall">' + D.playlists.slice().sort((a, b) => b.upd.localeCompare(a.upd)).map(p => {
      const c = p.c.filter(Boolean);
      return '<article class="pcard" data-list="' + p.id + '" style="--tint:' + p.tint + '"><div class="mosaic" data-n="' + c.length + '">' + c.map(u => '<img src="' + u + '" alt="">').join('') + '</div>' +
        '<div class="pmeta"><b>' + esc(p.name) + '</b><small>' + nSong(p.n) + ' · обновлён ' + day(p.upd) + '</small></div>' +
        '<button type="button" class="play" data-play-list aria-label="Слушать «' + esc(p.name) + '»">' + PLAY + '</button></article>';
    }).join('') + '<article class="pcard" data-newlist><div class="pnew"><span class="plus">' + icon('Plus', 26) + '</span>Новый плейлист</div></article></div>';
  } else {
    h = '<div id="stats"></div>';
  }
  shelf.innerHTML = h;
  if (S.tab === 'stats') window.renderStats?.($('#stats'));
  fitLists(); measure(); cur = -1; drawRail(); onScroll(true); wantShown();
  if (old) flip(old);
}
function fitLists() {
  const w = $('.pwall'); if (!w) return;
  const n = D.playlists.length + 1, gap = 12, W = lib.clientWidth - 120 - 48, H = stage.offsetHeight - BAR - 14 - 86 - 44 - 40;
  let best = null;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c), cw = (W - gap * (c - 1)) / c; let ch = Math.min(cw + 60, (H - gap * (r - 1)) / r);
    if (ch < 220) ch = Math.min(cw + 60, 340);          // too many to fit: square cards, the page scrolls
    if (cw / ch > 1.45) continue;                  // never a stretched strip
    const score = (n - (c * r - n) * 1.2) * cw * ch;  // filled area, an empty slot in the last row counts against
    if (!best || score > best.score) best = { c, ch, score };
  }
  best = best || { c: Math.min(n, 4), ch: 300 };
  w.style.setProperty('--pc', best.c); w.style.setProperty('--ph', Math.floor(best.ch) + 'px');
}
function snapshot() { const r = scroll.getBoundingClientRect(), m = new Map();
  $$('#shelf [data-id], #shelf [data-artist]').forEach(el => { const b = el.getBoundingClientRect(); if (b.bottom > r.top && b.top < r.bottom) m.set(el.dataset.id || el.dataset.artist, b); }); return m; }
function flip(old) {
  if (reduce) return;
  const r = scroll.getBoundingClientRect(); let k = 0;
  $$('#shelf [data-id], #shelf [data-artist], #shelf .sh').forEach(el => {
    const b = el.getBoundingClientRect(); if (b.bottom < r.top || b.top > r.bottom) return;
    const o = old.get(el.dataset.id || el.dataset.artist);
    if (o) { const dx = (o.left - b.left) / SC, dy = (o.top - b.top) / SC; if (Math.abs(dx) + Math.abs(dy) < 1) return;
      el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: 640, easing: SETTLE }); }
    else el.animate([{ opacity: 0, transform: 'translateY(16px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: Math.min(k++, 30) * 12, easing: 'cubic-bezier(.2,.9,.3,1.08)', fill: 'backwards' });
  });
}

/* ── the floating plate and the rail ───────────────────────────────────── */
let TOPS = [], cur = -1, plateOn = false;
function measure() { TOPS = $$('#shelf .sec').map(s => ({ top: s.offsetTop, hb: s.offsetTop + ($('.sh', s)?.offsetHeight || 0) })); }
const isCountry = () => S.tab === 'artists' && S.asort === 'country';
const stackOf = (s, n = 3) => isCountry() && FLAGS[s.key] ? '<span class="mstack">' + flagHtml(s.key) + '</span>' : '<span class="mstack">' + s.items.filter(x => x.s).slice(0, n).map(x => '<i style="' + bgFull(x.s, S.tab === 'artists' ? 'r' : 'a') + '"></i>').join('') + '</span>';
function onScroll(force) {
  const line = scroll.scrollTop + BAR;
  let i = -1; for (let k = 0; k < TOPS.length; k++) { if (TOPS[k].top <= line + 12) i = k; else break; }
  const show = i >= 0 && TOPS[i].hb <= line + 4;
  if (i !== cur || force) {
    const was = cur; cur = i;
    $$('.rseg', rail).forEach((el, k) => el.toggleAttribute('data-on', k === i));
    if (i >= 0) setPlate(SECS[i], plateOn && was >= 0 && !force ? (i > was ? 1 : -1) : 0);
  }
  if (force) { plateOn = show; plate.hidden = !show; plate.getAnimations().forEach(x => x.cancel()); }
  else if (show !== plateOn) {
    plateOn = show;
    if (show) { plate.hidden = false; if (!reduce) plate.animate([{ opacity: 0, transform: 'translateY(-10px) scale(.92)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 460, easing: SPRING }); }
    else { if (menu && menu.owner === plate) closeMenu(); plate.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-6px) scale(.96)' }], { duration: 160, easing: 'ease-in' }).finished.then(() => { if (!plateOn) plate.hidden = true; }); }
  }
  if (menu && menu.dataset.kind === 'sort') closeMenu();
}
function setPlate(s, dir) {
  const nm = $('.nm', plate), old = nm.firstElementChild;
  $('.mstack', plate).outerHTML = stackOf(s);
  $('small', plate).textContent = s.items.length;
  const el = document.createElement('span'); el.textContent = s.name;
  if (dir && old && !reduce) {
    nm.appendChild(el);
    el.animate([{ transform: 'translateY(' + (dir * 100) + '%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: SPRING });
    old.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(' + (-dir * 100) + '%)', opacity: 0 }], { duration: 220, easing: 'ease-in' }).finished.then(() => old.remove());
  } else { nm.innerHTML = ''; nm.appendChild(el); }
}
function drawRail() {
  if (SECS.length < 2) { rail.hidden = true; return; }
  rail.hidden = false;
  const H = rail.clientHeight || 400, tot = SECS.reduce((n, s) => n + s.items.length, 0);
  rail.innerHTML = SECS.map((s, i) => { const h = Math.max(6, H * s.items.length / tot);
    return '<div class="rseg" data-i="' + i + '" style="flex-grow:' + Math.max(1, s.items.length) + '">' + (isCountry() && FLAGS[s.key] && h >= 13 ? '<span class="fl" style="background-image:url(' + FLAGS[s.key] + ')"></span>' : s.short && h >= 13 ? '<b>' + esc(s.short) + '</b>' : '') + '</div>'; }).join('');
  $$('.rseg', rail).forEach((el, k) => el.toggleAttribute('data-on', k === cur));
}
function railAt(y) { const segs = $$('.rseg', rail); for (const el of segs) { const r = el.getBoundingClientRect(); if (y <= r.bottom + 1.5) return [+el.dataset.i, segs]; } return [segs.length - 1, segs]; }
let railDrag = false, railI = -1;
function railMove(e, jumpNow) {
  const [i, segs] = railAt(e.clientY);
  const sr = stage.getBoundingClientRect();
  segs.forEach(el => { const r = el.getBoundingClientRect(), d = Math.abs((r.top + r.bottom) / 2 - e.clientY) / SC; const f = Math.max(0, 1 - d / 70);
    el.style.setProperty('--fx', (1 + f * 1.4).toFixed(2)); el.style.setProperty('--fs', (1 + f * .45).toFixed(2)); });
  if (i !== railI) { railI = i; const s = SECS[i]; rlabel.innerHTML = stackOf(s) + esc(s.name) + '<small>' + s.items.length + '</small>';
    rlabel.animate([{ transform: 'scale(.94)' }, { transform: 'none' }], { duration: 260, easing: SPRING }); }
  rlabel.style.top = Math.round((e.clientY - sr.top) / SC - 20) + 'px';
  rlabel.hidden = false;
  if (jumpNow) jump(i, false);
}
let railDown = null;
rail.addEventListener('pointermove', e => { if (railDown != null && !railDrag && Math.abs(e.clientY - railDown) > 4) { railDrag = true; rail.setAttribute('data-drag', ''); } railMove(e, railDrag); });
rail.addEventListener('pointerdown', e => { railDown = e.clientY; rail.setPointerCapture(e.pointerId); railMove(e, false); });
rail.addEventListener('pointerup', e => { const dragged = railDrag; railDrag = false; railDown = null; rail.removeAttribute('data-drag');
  try { rail.releasePointerCapture(e.pointerId); } catch (x) {} if (!dragged && railI >= 0) glide(railI); });
rail.addEventListener('pointerleave', () => { if (railDrag) return; rlabel.hidden = true; railI = -1; $$('.rseg', rail).forEach(el => { el.style.removeProperty('--fx'); el.style.removeProperty('--fs'); }); });
function jump(i) { const t = TOPS[i]; if (!t) return; cancelAnimationFrame(glideRaf); scroll.scrollTop = Math.max(0, t.top - BAR - 4); }
/* going to a group: a near one is reached by a glide of the wall (ease in and out, longer for
   longer ways); a far one by a soft cut: the wall dims and slides off in the way of travel,
   the group rises in from the other side. The group's heading answers on arrival. */
let glideRaf = 0;
function glide(i) {
  const t = TOPS[i]; if (!t) return;
  const to = Math.max(0, Math.min(t.top - BAR - 4, scroll.scrollHeight - scroll.clientHeight)), from = scroll.scrollTop, dist = to - from;
  cancelAnimationFrame(glideRaf);
  if (reduce || Math.abs(dist) < 2) { scroll.scrollTop = to; arrive(i); return; }
  if (Math.abs(dist) > scroll.clientHeight * 1.6) {
    const sh = $('#shelf'), dir = Math.sign(dist);
    sh.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(' + (-dir * 30) + 'px)' }], { duration: 160, easing: 'cubic-bezier(.4,0,1,1)' }).finished.then(() => {
      scroll.scrollTop = to; arrive(i);
      sh.animate([{ opacity: 0, transform: 'translateY(' + (dir * 40) + 'px)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,1,.3,1)' });
    });
    return;
  }
  const T0 = performance.now(), dur = Math.min(640, 320 + Math.abs(dist) * .28), ease = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  (function f(now) { const k = Math.min(1, (now - T0) / dur); scroll.scrollTop = from + dist * ease(k); if (k < 1) glideRaf = requestAnimationFrame(f); else arrive(i); })(T0);
}
function arrive(i) {
  const h = $$('#shelf .sec')[i]?.querySelector('.sh'); if (!h || reduce) return;
  h.animate([{ transform: 'translateY(10px)', opacity: .35 }, { transform: 'none', opacity: 1 }], { duration: 480, easing: SPRING });
  const f = $('.flag', h); if (f) { f.classList.remove('wave'); void f.offsetWidth; f.classList.add('wave'); setTimeout(() => f.classList.remove('wave'), 1200); }
}

/* ── menus: sorting, and the list of groups ────────────────────────────── */
let menu = null;
function openMenu(btn, kind) {
  closeMenu();
  const r = at(btn);
  menu = document.createElement('div'); menu.className = 'menu' + (kind === 'jump' ? ' glass lg' : ''); menu.dataset.kind = kind; menu.setAttribute('role', 'menu');
  if (kind === 'sort') {
    const cur2 = S.tab === 'albums' ? (S.sort === 'genre' ? 'genre:' + S.lens : S.sort) : S.asort;
    menu.innerHTML = SORTS[S.tab].map(it => it ? '<button type="button" role="menuitemradio" data-pick="' + it[0] + '" aria-pressed="' + (cur2 === it[0]) + '"><span class="nm">' + it[1] + '</span><small>' + it[2] + '</small></button>' : '<hr>').join('');
  } else {
    menu.innerHTML = SECS.map((s, i) => '<button type="button" role="menuitem" data-goto="' + i + '" aria-pressed="' + (i === cur) + '">' + stackOf(s) + '<span class="nm">' + esc(s.name) + '</span><small class="mono-n">' + s.items.length + '</small></button>').join('');
  }
  const top = r.y + r.h + 8;
  Object.assign(menu.style, { left: Math.min(r.x, stage.offsetWidth - 300) + 'px', top: top + 'px', maxHeight: (stage.offsetHeight - top - 150) + 'px' });
  stage.appendChild(menu); btn.setAttribute('aria-expanded', 'true'); menu.owner = btn;
  if (kind === 'jump') $('[aria-pressed="true"]', menu)?.scrollIntoView?.call && (menu.scrollTop = Math.max(0, ($('[aria-pressed="true"]', menu)?.offsetTop || 0) - 80));
  if (!reduce) { menu.animate([{ transform: 'scale(.86)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: SPRING });
    $$('button', menu).slice(0, 14).forEach((b, i) => b.animate([{ transform: 'translateY(-4px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, delay: 30 + i * 24, easing: EASE, fill: 'backwards' })); }
  menu.addEventListener('click', e => {
    const p = e.target.closest('[data-pick]'), g = e.target.closest('[data-goto]');
    if (p) { const [s, l] = p.dataset.pick.split(':'); closeMenu();
      if (S.tab === 'albums') { S.sort = s; if (l) S.lens = l; } else S.asort = s;
      renderBar(); scroll.scrollTop = 0; renderShelf(true); }
    if (g) { closeMenu(); glide(+g.dataset.goto); }
  });
}
function closeMenu() { if (!menu) return; const m = menu; menu = null; m.owner?.setAttribute('aria-expanded', 'false');
  m.animate([{ opacity: 1 }, { transform: 'scale(.92)', opacity: 0 }], { duration: 150, easing: 'ease-in', fill: 'forwards' }).finished.then(() => m.remove()); }

/* ── taking the film off: the corner is pulled, the film peels back over itself (a fold
   that travels across the sleeve, the flap carrying light along its crease and a shadow),
   comes off and what is left evaporates, with a quiet crinkle; an album opened and left
   unheard is wrapped again ──────────────────────────────────────────────────────────── */
let ac = null, crinkles = null;
/* the first sound used to cost a hitch (an audio context and its noise made on the spot):
   both are made at the first touch of the page */
function warmAudio() {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    if (crinkles) return;
    const sr = ac.sampleRate;
    crinkles = [0, 1, 2].map(() => { const len = Math.floor(sr * .7), buf = ac.createBuffer(1, len, sr), d = buf.getChannelData(0);
      let t = Math.floor(sr * .02);
      while (t < len) { const n = Math.floor(sr * (.002 + Math.random() * .012)), amp = (.25 + Math.random() * .75) * (t < sr * .12 ? .5 : 1);
        for (let j = 0; j < n && t + j < len; j++) d[t + j] = (Math.random() * 2 - 1) * amp * Math.exp(-j / (n * .35));
        t += n + Math.floor(sr * (.003 + Math.random() * .028)); }
      return buf; });
  } catch (e) {}
}
stage.addEventListener('pointerdown', warmAudio, { once: true, capture: true });
function crinkle() {
  try { warmAudio(); if (!crinkles) return;
    const src = ac.createBufferSource(); src.buffer = crinkles[Math.floor(Math.random() * crinkles.length)];
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1600;
    const g = ac.createGain(), now = ac.currentTime;
    g.gain.setValueAtTime(.0001, now); g.gain.exponentialRampToValueAtTime(.08, now + .03); g.gain.setValueAtTime(.08, now + .45); g.gain.exponentialRampToValueAtTime(.0001, now + .7);
    src.connect(hp).connect(g).connect(ac.destination); src.start(now);
  } catch (e) {}
}
/* the film's look painted once per size (haze, two bands of light, the rim, the sticker) */
const TEX = new Map();
function filmTex(w, h, sticker) {
  const key = w + 'x' + h + (sticker ? 's' : ''); if (TEX.has(key)) return TEX.get(key);
  const dpr = Math.min(2, devicePixelRatio || 1), c = document.createElement('canvas'); c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const x = c.getContext('2d'); x.scale(dpr, dpr);
  x.fillStyle = 'rgba(255,255,255,.06)'; x.fillRect(0, 0, w, h);
  const dx = .927, dy = .375, L = w * dx + h * dy, g = x.createLinearGradient(w / 2 - dx * L / 2, h / 2 - dy * L / 2, w / 2 + dx * L / 2, h / 2 + dy * L / 2);
  [[0, 0], [.34, 0], [.4, .12], [.46, .03], [.52, 0], [.7, 0], [.74, .07], [.79, 0], [1, 0]].forEach(([o, a]) => g.addColorStop(o, 'rgba(255,255,255,' + a + ')'));
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.strokeStyle = 'rgba(255,255,255,.32)'; x.lineWidth = 1; x.strokeRect(.5, .5, w - 1, h - 1);
  x.fillStyle = 'rgba(255,255,255,.22)'; x.fillRect(1, 1, w - 2, 2);
  if (sticker) {
    x.save(); x.translate(12, 12); x.rotate(-4 * Math.PI / 180);
    x.font = '600 11.5px Geist, Inter, system-ui, sans-serif'; const tw = x.measureText('не слушал').width, bw = tw + 31, bh = 22;
    x.shadowColor = 'rgba(0,0,0,.3)'; x.shadowBlur = 4; x.shadowOffsetY = 2; x.fillStyle = '#f4efe4';
    x.beginPath(); x.roundRect ? x.roundRect(0, 0, bw, bh, 6) : x.rect(0, 0, bw, bh); x.fill(); x.shadowColor = 'transparent';
    x.fillStyle = '#e2552f'; x.beginPath(); x.arc(11, bh / 2, 3, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#2a2620'; x.textBaseline = 'middle'; x.fillText('не слушал', 20, bh / 2 + .5); x.restore();
  }
  TEX.set(key, c); return c;
}
const hostOf = box => box.classList.contains('row') ? $('.rc', box) : box;
/* the corner is pulled, the film peels back over itself (a fold that travels along the
   diagonal; the flap carries light along its crease and casts a shadow), comes off, and
   what is left evaporates. All of it on one canvas over the cover. */
function peel(host, done) {
  const film = $('.film', host);
  if (!film || reduce) { film?.remove(); done(); return; }
  crinkle();
  const w = film.offsetWidth, h = film.offsetHeight, tex = filmTex(w, h, !!$('.sticker', film)), dpr = tex.width / w;
  film.remove();
  const cv = document.createElement('canvas'); cv.className = 'peelc'; cv.width = tex.width; cv.height = tex.height; host.appendChild(cv);
  const x = cv.getContext('2d'); x.scale(dpr, dpr);
  const L = Math.hypot(w, h), ux = -w / L, uy = h / L, v = (a, b, p) => (a - w) * ux + b * uy - p, sq = [[0, 0], [w, 0], [w, h], [0, h]];
  const clip = (poly, p, keep) => { const out = []; for (let i = 0; i < poly.length; i++) { const A = poly[i], B = poly[(i + 1) % poly.length];
    const va = v(A[0], A[1], p), vb = v(B[0], B[1], p), ia = keep ? va >= 0 : va < 0, ib = keep ? vb >= 0 : vb < 0;
    if (ia) out.push(A); if (ia !== ib) { const t = va / (va - vb); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); } } return out; };
  const path = pts => { x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.closePath(); };
  const ease = t => t < .18 ? .08 * (1 - Math.pow(1 - t / .18, 3)) : (k => .08 + (1.02 - .08) * (k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2))((t - .18) / .82);
  const T0 = performance.now(), dur = 760; let gone = false;
  (function frame(now) {
    const t = Math.min(1, (now - T0) / dur), p = ease(t) * L;
    x.clearRect(0, 0, w, h);
    const rest = clip(sq, p, true);
    if (rest.length > 2) { x.save(); path(rest); x.clip(); x.drawImage(tex, 0, 0, w, h); x.restore(); }
    const fl = clip(sq, p, false).map(([a, b]) => { const d = v(a, b, p); return [a - 2 * d * ux, b - 2 * d * uy]; });
    if (fl.length > 2 && p > 1) {
      const fx = w + ux * p, fy = uy * p, g = x.createLinearGradient(fx, fy, fx + ux * p, fy + uy * p);
      g.addColorStop(0, 'rgba(255,255,255,.75)'); g.addColorStop(.1, 'rgba(238,240,247,.36)'); g.addColorStop(1, 'rgba(214,218,230,.16)');
      x.save(); x.shadowColor = 'rgba(0,0,0,.38)'; x.shadowBlur = 10; x.shadowOffsetX = -3; x.shadowOffsetY = 5; path(fl); x.fillStyle = g; x.fill(); x.restore();
    }
    if (t > .8 && !gone) { gone = true;
      cv.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate(-6px,-10px) scale(1.04)' }], { duration: 380, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }).finished.then(() => cv.remove()); }
    if (t < 1) requestAnimationFrame(frame);
  })(T0);
  host.animate([{ transform: 'none' }, { transform: 'translateY(-2px) rotate(-.4deg)', offset: .15 }, { transform: 'none' }], { duration: 520, easing: SPRING });
  setTimeout(done, 620);
}
/* opened and left unheard: a new film is drawn over it from the left, shrinks tight with a
   little tug, and the shop's sticker is put back on */
function rewrap(box, a) {
  if (a.p || !box.isConnected) return;
  const host = hostOf(box); if (!host || $('.film', host)) return;
  box.setAttribute('data-sealed', '');
  host.insertAdjacentHTML('beforeend', FILM);
  if (reduce) return;
  const film = host.lastElementChild, st = $('.sticker', film);
  film.animate([{ clipPath: 'inset(0 100% 0 0)', opacity: .4 }, { clipPath: 'inset(0 0% 0 0)', opacity: 1 }], { duration: 560, easing: 'cubic-bezier(.3,.7,.2,1)' });
  host.animate([{ transform: 'none' }, { transform: 'scale(1.025)', offset: .45 }, { transform: 'scale(.99)', offset: .75 }, { transform: 'none' }], { duration: 620, delay: 420, easing: 'ease-out' });
  st?.animate([{ transform: 'scale(.3) rotate(-28deg)', opacity: 0 }, { transform: 'rotate(-4deg)', opacity: 1 }], { duration: 440, delay: 600, easing: SPRING, fill: 'backwards' });
}
/* the light on the film follows the pointer */
let hoverFilm = null;
lib.addEventListener('pointermove', e => {
  const c = e.target.closest('[data-sealed]'); const f = c && $('.film', c); if (!f) return;
  const r = f.getBoundingClientRect(); f.style.setProperty('--hx', ((e.clientX - r.left) / r.width).toFixed(3)); f.style.setProperty('--hy', ((e.clientY - r.top) / r.height).toFixed(3));
});

/* ── playing: the cover flies into the mini player ─────────────────────── */
const mini = { cover: $('#miniCover'), title: $('#miniTitle'), artist: $('#miniArtist') };
let playing = true, ppos = 72, dur = 238, ACC = '#cfd0ff';
function setNow(t, accent) {
  const a = byId[t.al];
  mini.cover.style.cssText = a?.s ? bgFull(a.s, 'a') : 'background:' + phOf(a || {});
  mini.title.textContent = t.t; mini.artist.textContent = t.ar;
  ACC = accent || a?.acc || '#cfd0ff'; $('#mini').style.setProperty('--mini-acc', ACC); stage.style.setProperty('--acc', ACC);
  ppos = 0; dur = 180 + (t.t.length * 7) % 120; setPlaying(true);
  window.MX?.onPlay?.(t);
}
function fly(el, then) {
  const to = mini.cover;
  if (!el || reduce) { then(); return; }
  let src = null;
  if (el.tagName === 'IMG' && el.naturalWidth) src = [el, 0, 0, el.naturalWidth, el.naturalHeight];
  else if (el.dataset.s) src = sheetCanvas(el.dataset.s);
  if (!src) { then(); return; }
  const a = at(el), b = at(to);
  const cv = document.createElement('canvas'); cv.width = cv.height = 200; cv.className = 'fly';
  try { cv.getContext('2d').drawImage(src[0], src[1], src[2], src[3], src[4], 0, 0, 200, 200); } catch (e) { then(); return; }
  const rad = getComputedStyle(el.closest('.card, .rc, .hit, .pw') || el).borderRadius;
  Object.assign(cv.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px', transformOrigin: '0 0', borderRadius: '9px' });
  stage.appendChild(cv);
  const dx = a.x - b.x, dy = a.y - b.y, s = a.w / b.w;
  cv.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ')', borderRadius: (parseFloat(rad) / s || 4) + 'px' },
    { transform: 'translate(' + dx * .45 + 'px,' + (dy * .45 - 90) + 'px) scale(' + (1 + (s - 1) * .4) + ') rotate(-4deg)', offset: .45 },
    { transform: 'none', borderRadius: '9px' }], { duration: 680, easing: 'cubic-bezier(.3,.6,.25,1)' }).onfinish = () => {
    cv.remove(); then();
    to.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.2) rotate(-3deg)' }, { transform: 'scale(1)' }], { duration: 440, easing: SPRING });
  };
}
const coverEl = box => $('.cv', box) || $('img', box);
function playAlbum(a, box) {
  const t = topTrack(x => x.al === a.id) || { t: a.t, ar: a.ar, al: a.id };
  const go = () => fly(coverEl(box), () => setNow(t, a.acc));
  if (sealed(a)) { a.p = 1; const chip = $('[data-sealfilter] small'); if (chip) chip.textContent = sealedCount();
    box.removeAttribute('data-sealed'); const host = hostOf(box); if (host && $('.film', host)) peel(host, go); else go(); }
  else go();
}
function openAlbum(a, box) {
  const press = () => ($('.sl', box) || box).animate([{ transform: 'none' }, { transform: 'scale(.97)', offset: .3 }, { transform: 'none' }], { duration: 380, easing: SPRING });
  const host = hostOf(box);
  if (sealed(a) && host && $('.film', host)) {
    box.removeAttribute('data-sealed');
    peel(host, () => { press(); toast('<b>' + esc(a.t) + '</b> <span>· здесь открывается разворот. Закроешь, не послушав, — запакуется обратно</span>'); });
    setTimeout(() => rewrap(box, a), 3300);
  } else { press(); toast('<b>' + esc(a.t) + '</b> <span>· здесь открывается разворот альбома</span>'); }
}
let toastEl = null, toastT = 0;
function toast(html) {
  toastEl?.remove(); clearTimeout(toastT);
  const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = html; stage.appendChild(t); toastEl = t;
  t.animate([{ transform: 'translateY(12px) scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: SPRING });
  toastT = setTimeout(() => t.animate([{ opacity: 1 }, { transform: 'translateY(6px) scale(.96)', opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' }).finished.then(() => t.remove()), 2600);
}

/* ── the mini player: progress and the spectrum (a stand-in for the app's) ─ */
const toggle = $('#miniToggle');
function setPlaying(on) { playing = on; toggle.innerHTML = icon(on ? 'Pause' : 'Play', 20); toggle.setAttribute('aria-label', on ? 'Пауза' : 'Играть'); if (on) spec(); }
toggle.addEventListener('click', () => setPlaying(!playing));
const clock = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
setInterval(() => { if (!playing) return; ppos = (ppos + .25) % dur; $('#mini').style.setProperty('--p', (ppos / dur).toFixed(4)); $('#miniTime').textContent = clock(ppos) + ' / ' + clock(dur); }, 250);
const cvs = $('#spec'), cx = cvs.getContext('2d'), N = 16, lvl = new Float32Array(N), tgt = new Float32Array(N);
let raf = 0, tick = 0;
function spec() { if (!raf) raf = requestAnimationFrame(frame); }
function frame(ts) {
  raf = 0; tick++;
  const w = cvs.width, h = cvs.height;
  if (tick % 4 === 0) for (let i = 0; i < N; i++) tgt[i] = playing ? Math.max(.05, (1 - i / N * .55) * (.35 + .65 * Math.abs(Math.sin(ts / (380 + i * 37) + i * 1.7) * Math.cos(ts / (910 - i * 23))))) : 0;
  let moving = false;
  for (let i = 0; i < N; i++) { const d = tgt[i] - lvl[i]; lvl[i] += d * (d > 0 ? .5 : .12); if (Math.abs(d) > .002) moving = true; }
  cx.clearRect(0, 0, w, h);
  const pts = [[0, h]]; for (let i = 0; i < N; i++) pts.push([(i + .5) / N * w, h - lvl[i] * (h - 6)]); pts.push([w, h]);
  cx.beginPath(); cx.moveTo(0, h);
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; cx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2); }
  cx.lineTo(w, h); cx.closePath();
  const g = cx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, ACC); g.addColorStop(1, 'transparent');
  cx.globalAlpha = .28; cx.fillStyle = g; cx.fill(); cx.globalAlpha = .9; cx.strokeStyle = ACC; cx.lineWidth = 2; cx.stroke(); cx.globalAlpha = 1;
  if (playing || moving) spec();
}

/* ── search: the icon grows into a field, the answers drop out of it ───── */
let SR = null, shown = false;
function search(q) {
  const n = norm(q); if (!n) return null;
  const sc = s => !s ? 0 : s.startsWith(n) ? 3 : (' ' + s).includes(' ' + n) ? 2 : s.includes(n) ? 1 : 0;
  const pick = (list, f, cap, tie) => list.map(x => [f(x), x]).filter(p => p[0] > 0).sort((x, y) => y[0] - x[0] || tie(x[1], y[1])).slice(0, cap);
  return [
    { k: 'artist', name: 'Артисты', hits: pick(AR, a => sc(a.nn), 3, (x, y) => y.p - x.p || y.n - x.n) },
    { k: 'album', name: 'Альбомы', hits: pick(AL, a => Math.max(sc(a.nt), sc(a.na) * .5), 4, (x, y) => y.p - x.p) },
    { k: 'song', name: 'Песни', hits: pick(TR, t => Math.max(sc(t.nt), sc(t.na) * .4), 6, (x, y) => y.p - x.p) },
  ].filter(g => g.hits.length).sort((x, y) => y.hits[0][0] - x.hits[0][0]);
}
function markq(s, q) { const n = norm(q); const i = s.toLowerCase().replace(/ё/g, 'е').indexOf(n);
  return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + n.length)) + '</mark>' + esc(s.slice(i + n.length)); }
function hitHtml(k, x, q, idx) {
  if (k === 'artist') return '<button type="button" class="hit" data-k="artist" data-hit="' + idx + '"><span class="pic"' + (x.s ? ' data-s="r:' + x.s[0] + ':' + x.s[1] + '" style="' + bgFull(x.s, 'r') + '"' : ' style="background:hsl(' + hueOf(x.name) + ' 35% 30%)"') + '></span><span class="tx"><b>' + markq(x.name, q) + '</b><small><i>Артист</i> · ' +
    (x.al ? nAlb(x.al) + ' · ' : '') + nSong(x.n) + '</small></span><span class="go">' + CHEV + '</span></button>';
  if (k === 'album') return '<button type="button" class="hit" data-k="album" data-hit="' + idx + '"><span class="pic" data-s="a:' + x.s[0] + ':' + x.s[1] + '" style="' + bgFull(x.s, 'a') + '"></span><span class="tx"><b>' + markq(x.t, q) + '</b><small><i>Альбом</i> · ' + esc(x.ar) + (x.y ? ' · ' + x.y : '') + '</small></span><span class="go">' + CHEV + '</span></button>';
  const a = byId[x.al];
  return '<button type="button" class="hit" data-k="song" data-hit="' + idx + '"><span class="pw"><span class="pic"' + (a?.s ? ' data-s="a:' + a.s[0] + ':' + a.s[1] + '" style="' + bgFull(a.s, 'a') + '"' : '') + '></span><span class="note">' + NOTE + '</span></span><span class="tx"><b>' + markq(x.t, q) + '</b><small><i>Песня</i> · ' + esc(x.ar) + (a ? ' · ' + esc(a.t) : '') + '</small></span><span class="go">' + icon('Play', 14) + '</span></button>';
}
function openSearch() {
  if (SR) { SR.input.focus({ preventScroll: true }); return; }
  const btn = $('[data-search]'); if (!btn) return;
  closeMenu();
  const r = at(btn), W = stage.offsetWidth, right = W - (r.x + r.w);
  const tools = $$('#bar .tools > *:not(.sbtn)'), tb = $('#bar .tabs'), tabsEnd = tb ? at(tb).x + at(tb).w : 0;
  const left = Math.max(tools.length ? Math.min(...tools.map(x => at(x).x)) - 8 : r.x + r.w - 440, tabsEnd + 24);
  const w = Math.max(360, r.x + r.w - left);
  $('#bar').setAttribute('data-searching', '');
  const field = document.createElement('div'); field.className = 'sfield lg';
  field.innerHTML = icon('Search', 18) + '<input id="libSearch" type="search" placeholder="Альбом, песня или артист" aria-label="Поиск по библиотеке" autocomplete="off" spellcheck="false"><button type="button" class="ic x" aria-label="Закрыть поиск">' + icon('Close', 16) + '</button>';
  Object.assign(field.style, { right: right + 'px', top: (r.y + r.h / 2 - 22) + 'px', width: w + 'px' });
  const res = document.createElement('div'); res.className = 'sres lg'; res.setAttribute('role', 'listbox');
  const top = r.y + r.h / 2 + 30;
  Object.assign(res.style, { right: right + 'px', top: top + 'px', width: w + 'px', maxHeight: (stage.offsetHeight - top - 86 - 64) + 'px' });
  stage.append(field, res); btn.setAttribute('data-hide', '');
  SR = { field, res, input: $('input', field), btn, flat: [], on: 0 };
  if (!reduce) field.animate([{ clipPath: 'inset(0 0 0 ' + (w - 44) + 'px round 22px)', opacity: .6 }, { clipPath: 'inset(0 0 0 0 round 22px)', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.2,1.1,.3,1)' });
  SR.input.focus({ preventScroll: true });
  SR.input.addEventListener('input', draw);
  $('.x', field).addEventListener('click', closeSearch);
  SR.input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!SR.flat.length) return; SR.on = (SR.on + (e.key === 'ArrowDown' ? 1 : -1) + SR.flat.length) % SR.flat.length; markOn(); }
    else if (e.key === 'Enter' && SR.flat[SR.on]) { e.preventDefault(); act(SR.flat[SR.on], $('[data-hit="' + SR.on + '"]', SR.res)); }
  });
  res.addEventListener('pointermove', e => { const h = e.target.closest('[data-hit]'); if (h && +h.dataset.hit !== SR.on) { SR.on = +h.dataset.hit; markOn(); } });
  res.addEventListener('click', e => { const h = e.target.closest('[data-hit]'); if (h) act(SR.flat[+h.dataset.hit], h); });
}
function draw() {
  const q = SR.input.value, groups = search(q);
  SR.flat = []; SR.on = 0;
  if (!groups) { if (shown) { shown = false; const r = SR.res; r.animate([{ opacity: 1 }, { transform: 'translateY(-6px) scale(.97)', opacity: 0 }], { duration: 160, easing: 'ease-in' }).finished.then(() => { if (!shown) r.innerHTML = ''; }); } return; }
  let h = groups.length ? '' : '<div class="snone">Ничего не нашлось по «' + esc(q) + '».<br>Ищу по названиям альбомов и песен и по именам артистов.</div>';
  for (const g of groups) h += '<div class="sgroup" data-k="' + g.k + '"><h3>' + g.name + '<small>' + g.hits.length + '</small></h3>' +
    g.hits.map(([, x]) => { SR.flat.push({ k: g.k, x }); return hitHtml(g.k, x, q, SR.flat.length - 1); }).join('') + '</div>';
  SR.res.innerHTML = h + '<div class="shint"><span>↑↓ выбрать</span><span>Enter открыть</span><span>Esc закрыть</span></div>'; markOn();
  if (!shown) { shown = true;
    if (!reduce) { SR.res.animate([{ transform: 'translateY(-8px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: SPRING });
      $$('.hit', SR.res).slice(0, 10).forEach((el, i) => el.animate([{ transform: 'translateY(6px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, delay: 40 + i * 22, easing: EASE, fill: 'backwards' })); } }
}
function markOn() { $$('.hit', SR.res).forEach(h => h.toggleAttribute('data-on', +h.dataset.hit === SR.on));
  const el = $('[data-hit="' + SR.on + '"]', SR.res); if (el) { const r = SR.res, t = el.offsetTop, b = t + el.offsetHeight;
    if (t < r.scrollTop + 8) r.scrollTop = t - 8; else if (b > r.scrollTop + r.clientHeight - 30) r.scrollTop = b - r.clientHeight + 30; } }
function closeSearch() {
  if (!SR) return; const { field, res, btn } = SR; SR = null; shown = false; $('#bar')?.removeAttribute('data-searching');
  const w = field.offsetWidth;
  res.animate([{ opacity: 1 }, { transform: 'translateY(-8px) scale(.96)', opacity: 0 }], { duration: 170, easing: 'ease-in', fill: 'forwards' }).finished.then(() => res.remove());
  field.animate([{ clipPath: 'inset(0 0 0 0 round 22px)', opacity: 1 }, { clipPath: 'inset(0 0 0 ' + (w - 44) + 'px round 22px)', opacity: 0 }], { duration: reduce ? 1 : 260, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' })
    .finished.then(() => { field.remove(); btn.removeAttribute('data-hide'); btn.animate([{ transform: 'scale(.7)' }, { transform: 'none' }], { duration: 380, easing: SPRING }); });
}
function act(h, el) {
  if (!h) return;
  if (h.k === 'song') { fly($('.pic', el), () => setNow(h.x)); closeSearch(); return; }
  closeSearch();
  toast('<b>' + esc(h.k === 'album' ? h.x.t : h.x.name) + '</b> <span>· здесь ' + (h.k === 'album' ? 'открывается разворот альбома' : 'открывается страница артиста') + '</span>');
}

/* ── events ────────────────────────────────────────────────────────────── */
lib.addEventListener('click', e => {
  const t = e.target;
  const tab = t.closest('[data-tab]');
  if (tab) { if (S.tab === tab.dataset.tab) return; S.tab = tab.dataset.tab; closeMenu();
    $$('.tabs [data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === S.tab))); placeMarks();
    setTimeout(() => { renderBar(); scroll.scrollTop = 0; renderShelf(false);
      if (!reduce) $('#shelf').animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: EASE }); }, 0);
    return; }
  if (t.closest('[data-sortmenu]')) { const b = t.closest('[data-sortmenu]'); menu && menu.owner === b ? closeMenu() : openMenu(b, 'sort'); return; }
  if (t.closest('[data-sealfilter]')) { S.sealed = !S.sealed; t.closest('[data-sealfilter]').setAttribute('aria-pressed', String(S.sealed)); scroll.scrollTop = 0; renderShelf(true); return; }
  const vw = t.closest('[data-view]');
  if (vw) { if (S.view === vw.dataset.view) return; S.view = vw.dataset.view; $$('.views [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === S.view))); placeMarks();
    renderShelf(false); if (!reduce) $$('#shelf .card, #shelf .row').slice(0, 40).forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: i * 10, easing: EASE, fill: 'backwards' })); return; }
  if (t.closest('[data-search]')) { openSearch(); return; }
  if (t.closest('[data-jump]')) { const h = t.closest('[data-jump]'); openMenu(h, 'jump'); return; }
  const sec = t.closest('[data-play-sec]');
  if (sec) { const s = SECS[+sec.dataset.playSec], first = $('.card, .row', sec.closest('.sec')); const x = s.items.find(i => i.p) || s.items[0];
    const tr = S.tab === 'artists' ? topTrack(i => i.arId === x.id) : topTrack(i => i.al === x.id);
    if (tr) fly(first && coverEl(first), () => setNow(tr));
    toast('<b>' + esc(s.name) + '</b> <span>· ' + s.items.length + ' вперемешку</span>'); return; }
  const pa = t.closest('[data-play-artist]');
  if (pa) { const box = pa.closest('[data-artist]'), ar = arById[box.dataset.artist]; const tr = topTrack(x => x.arId === ar.id) || topTrack(x => x.na === ar.nn);
    if (tr) fly(coverEl(box), () => setNow(tr)); return; }
  if (t.closest('[data-play-day]')) { playAlbum(DAY, t.closest('[data-dayband]')); return; }
  if (t.closest('[data-open-day]')) { openAlbum(DAY, t.closest('[data-dayband]')); return; }
  const card = t.closest('[data-id]');
  if (card) { const a = byId[card.dataset.id];
    if (t.closest('[data-play]')) playAlbum(a, card); else openAlbum(a, card); return; }
  const ar = t.closest('[data-artist]');
  if (ar) { toast('<b>' + esc(arById[ar.dataset.artist].name) + '</b> <span>· здесь открывается страница артиста</span>'); return; }
  if (t.closest('[data-play-list]')) { const p = t.closest('[data-list]'); toast('Плейлист играет'); fly($('img', p), () => setNow(TR[0])); return; }
  if (t.closest('[data-list]')) { toast('Экран плейлиста пока прежний'); return; }
  if (t.closest('[data-newlist]')) toast('Здесь появится поле для названия');
});
plate.addEventListener('click', () => { menu && menu.owner === plate ? closeMenu() : openMenu(plate, 'jump'); });
scroll.addEventListener('scroll', () => onScroll(false), { passive: true });
stage.addEventListener('click', e => { if (menu && !e.target.closest('.menu, [data-sortmenu], #plate, [data-jump]')) closeMenu();
  if (SR && !e.target.closest('.sfield, .sres, [data-search]')) closeSearch(); });
$('.now', stage).addEventListener('click', () => toast('Здесь открывается плеер'));
document.addEventListener('keydown', e => {
  if (e.key === '/' && !e.target.closest('input, textarea')) { e.preventDefault(); openSearch(); }
  if (e.key === 'Escape') closeMenu();
});
$$('#sSeg button').forEach(b => b.addEventListener('click', () => { S.size = +b.dataset.s; try { localStorage.setItem('mx-lib2-size', S.size); } catch (e) {} closeSearch(); closeMenu(); syncSegs(); fit(); }));
$('#slow').addEventListener('click', () => {
  S.slow = !S.slow; syncSegs();
  if (S.slow) { for (const k in SHEETS) delete SHEETS[k]; renderShelf(false); toast('<b>Медленная сеть</b> <span>· обложки идут по одной-две секунды</span>'); }
});
function syncSegs() { $$('#sSeg button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.s === S.size))); $('#slow').setAttribute('aria-pressed', String(S.slow)); }
addEventListener('resize', () => fit());

/* what the statistics module (stats.js) uses */
function goTab(k) { const b = $('.tabs [data-tab="' + k + '"]'); if (b && S.tab !== k) b.click(); }
function playTitle(title, artistName, el) {
  const tr = title ? topTrack(x => x.t === title) : topTrack(x => x.ar === artistName);
  if (tr) fly(el, () => setNow(tr));
}
window.MX = { $, $$, esc, plural, icon, flagHtml, countryName, stage, toast, at, SPRING, EASE, reduce, audio: () => { warmAudio(); return ac; }, goTab, playTitle };
stage.style.setProperty('--bgs', G * 100 + '% ' + G * 100 + '%');
icons(document);
lib.innerHTML = '<div class="bar" id="bar"></div><div id="shelf"></div>';
renderBar();
setNow(topTrack(() => true)); ppos = 72;
syncSegs(); fit(); renderShelf(false); fit();
})();
