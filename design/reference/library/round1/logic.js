(() => {
const D = window.DATA, IC = window.ICONS;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPRING = 'cubic-bezier(.34,1.56,.64,1)', EASE = 'cubic-bezier(.22,.9,.3,1)', SETTLE = 'cubic-bezier(.25,1.12,.35,1)';

function icon(name, size) { const d = IC[name]; if (!d) return '';
  return '<svg class="i" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true">' + d.d.map((p, i) => d.fill.includes(i) ? '<path d="' + p + '" fill="currentColor"/>' : '<path d="' + p + '" fill="none" stroke="currentColor" stroke-width="' + d.w + '" stroke-linecap="round" stroke-linejoin="round"/>').join('') + '</svg>'; }
function icons(root) { $$('[data-ic]', root).forEach(el => { const [n, s] = el.dataset.ic.split(':'); el.outerHTML = icon(n, +s); }); }
const NOTE = '<svg class="i" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" fill="currentColor"/><circle cx="17" cy="16" r="3" fill="currentColor"/></svg>';
const PLAY = icon('Play', 18), PLAY_S = icon('Play', 14), CHEV = icon('ChevronRight', 16);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plural = (n, a, b, c) => { const x = n % 10, y = n % 100; return x === 1 && y !== 11 ? a : x >= 2 && x <= 4 && (y < 10 || y >= 20) ? b : c; };
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTH = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const day = iso => { const d = new Date(iso); return d.getDate() + ' ' + MON[d.getMonth()]; };
const num = n => n.toLocaleString('ru-RU');
const norm = s => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const store = { get(k) { try { return localStorage.getItem('mx-lib-' + k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem('mx-lib-' + k, v); } catch (e) {} } };

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
const MPA = Math.max(1, ...AR.map(a => a.p));
const sealedCount = () => AL.filter(a => !a.p).length;
const topTrack = (pred) => TR.filter(pred).sort((x, y) => y.p - x.p)[0];
const labelBg = a => 'radial-gradient(circle at 38% 32%, color-mix(in srgb,' + (a.acc || '#888') + ' 70%, white), ' + (a.acc || '#444') + ' 72%)';

/* ── state ─────────────────────────────────────────────────────────────── */
const S = { v: store.get('v') || 'b', size: +(store.get('size') ?? 3), tab: 'albums', sort: 'plays', lens: 'tags', sealed: false, view: 'grid', asort: 'plays' };
const SIZES = [[1280, 720], [1512, 982], [1728, 1117], [1920, 1080], [2560, 1440]];
const CARD = [164, 176, 188, 196, 214];
const stage = $('#stage'), viewport = $('#viewport'), scroll = $('#scroll'), lib = $('#lib');
let SC = 1;
function fit() {
  const [W, H] = SIZES[S.size];
  stage.style.width = W + 'px'; stage.style.height = H + 'px'; stage.style.containerType = 'inline-size';
  stage.style.setProperty('--card', CARD[S.size] + 'px');
  SC = Math.min(1, viewport.clientWidth / W);
  stage.style.transform = SC < 1 ? 'scale(' + SC + ')' : 'none'; stage.style.marginInline = SC < 1 ? '0' : 'auto';
  viewport.style.height = Math.round(H * SC) + 'px';
  $('#sizeTag').textContent = W + ' × ' + H + (SC < 1 ? ' · показано в ' + Math.round(SC * 100) + ' %' : '');
  placeMarks();
}
/* stage coordinates of an element (the stage is scaled) */
function at(el) { const s = stage.getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x: (r.left - s.left) / SC, y: (r.top - s.top) / SC, w: r.width / SC, h: r.height / SC }; }

/* ── sorting and sections ──────────────────────────────────────────────── */
const SORTS = [['plays', 'Слушаю чаще'], ['new', 'Новые'], ['az', 'А–Я'], ['year', 'Год'], ['genre', 'Жанр']];
const ASORTS = [['plays', 'Слушаю чаще'], ['az', 'А–Я'], ['tracks', 'Больше песен']];
const byPlays = (a, b) => b.p - a.p || (b.last || '').localeCompare(a.last || '') || a.nt.localeCompare(b.nt, 'ru');
function sections() {
  let list = S.sealed ? AL.filter(a => !a.p) : AL.slice();
  const one = items => [{ key: null, items }];
  const group = (keyOf, nameOf, order) => {
    const m = new Map();
    for (const a of list) { const k = keyOf(a); if (!m.has(k)) m.set(k, []); m.get(k).push(a); }
    return [...m.entries()].map(([k, items]) => ({ key: k, name: nameOf(k), items: items.sort(byPlays) })).sort(order);
  };
  if (S.sort === 'plays') return one(list.sort(byPlays));
  if (S.sort === 'az') return one(list.sort((a, b) => a.nt.localeCompare(b.nt, 'ru')));
  if (S.sort === 'new') return group(a => a.add.slice(0, 7), k => { const [y, m] = k.split('-'); return MONTH[+m - 1] + (+y !== 2026 ? ' ' + y : ''); },
    (x, y) => y.key.localeCompare(x.key)).map(s => (s.items.sort((a, b) => b.add.localeCompare(a.add) || (b.y || 0) - (a.y || 0)), s));
  if (S.sort === 'year') return group(a => a.y ? Math.floor(a.y / 10) * 10 : 0, k => k ? (k + '-е') : 'Без года', (x, y) => (y.key || -1) - (x.key || -1));
  if (S.lens === 'sound') return group(a => a.cl ?? -1, k => CL[k]?.name || 'Без кластера', (x, y) => y.items.length - x.items.length);
  return group(a => a.g, k => k, (x, y) => (x.key === 'Другое') - (y.key === 'Другое') || y.items.length - x.items.length);
}

/* ── the library, per variant ──────────────────────────────────────────── */
const hours = Math.round(AL.reduce((s, a) => s + (a.ms || 0), 0) / 3.6e6);
const songs = TR.length;
const summary = () => '<b>' + num(AL.length) + '</b> ' + plural(AL.length, 'альбом', 'альбома', 'альбомов') + ' · <b>' + num(AR.length) + '</b> ' + plural(AR.length, 'артист', 'артиста', 'артистов') +
  ' · <b>' + num(songs) + '</b> ' + plural(songs, 'песня', 'песни', 'песен') + ' · <b>' + num(hours) + '</b> ' + plural(hours, 'час', 'часа', 'часов') + ' музыки';
const TABS = [['albums', 'Альбомы', AL.length], ['artists', 'Артисты', AR.length], ['lists', 'Плейлисты', D.playlists.length], ['stats', 'Статистика', null]];
const tabsHtml = () => '<div class="tabs" role="group" aria-label="Раздел">' + TABS.map(([k, n, c]) =>
  '<button type="button" data-tab="' + k + '" aria-pressed="' + (S.tab === k) + '">' + n + (c != null ? '<small>' + c + '</small>' : '') + '</button>').join('') + '<span class="ul"></span></div>';
const why = a => 'Ты слушал его <b>' + a.p + ' ' + plural(a.p, 'раз', 'раза', 'раз') + '</b>, но не ставил с ' + day(a.last) + '.';
function dayHtml() {
  const a = DAY;
  if (S.v === 'a') return '<div class="strip" data-dayblock>' +
    '<div class="sl" data-play-day><span class="vinyl"><span class="lbl" style="background:' + labelBg(a) + '"></span></span><img src="' + PICK.big + '" alt=""></div>' +
    '<div class="tx"><span class="dayLabel" style="--day-acc:' + a.acc + '">Пластинка дня</span><b>' + esc(a.t) + ' — <span class="alink">' + esc(a.ar) + '</span></b><span class="why">' + why(a) + '</span></div>' +
    '<button type="button" class="btnPlay" data-play-day>' + PLAY_S + 'Слушать</button></div>';
  if (S.v === 'b') return '<div class="day" data-dayblock>' +
    '<div class="sl" data-play-day><span class="vinyl"><span class="lbl" style="background:' + labelBg(a) + '"></span></span><img src="' + PICK.big + '" alt=""></div>' +
    '<div class="tx"><span class="dayLabel" style="--day-acc:' + a.acc + '">Пластинка дня · ' + day(today) + '</span><h3>' + esc(a.t) + '</h3>' +
    '<span class="ar"><span class="alink">' + esc(a.ar) + '</span>' + (a.y ? ' · ' + a.y : '') + '</span><span class="why">' + why(a) + '</span>' +
    '<button type="button" class="btnPlay" data-play-day>' + PLAY_S + 'Слушать</button></div></div>';
  return '';
}
function barHtml() {
  const t = S.tab;
  let h = '';
  if (S.v === 'c') h += '<span class="ttl">Библиотека</span>' + tabsHtml() + '<span class="grow"></span>';
  if (t === 'albums' || t === 'artists') {
    const opts = t === 'albums' ? SORTS : ASORTS, cur = t === 'albums' ? S.sort : S.asort;
    if (S.v === 'c') {
      const name = t === 'albums' && S.sort === 'genre' ? (S.lens === 'sound' ? 'Звучание' : 'Жанр') : opts.find(o => o[0] === cur)[1];
      h += '<button type="button" class="sortpill" data-sortmenu aria-expanded="false" aria-label="Сортировка: ' + name + '">' + icon('Bars', 15) + '<b>' + name + '</b>' + icon('ChevronDown', 16) + '</button>';
    } else {
      h += '<div class="sorts" role="group" aria-label="Сортировка"><span class="thumb"></span>' + opts.map(([k, n]) =>
        '<button type="button" data-sort="' + k + '" aria-pressed="' + (cur === k) + '">' + n + '</button>').join('') + '</div>';
      if (t === 'albums') h += '<div class="lens"' + (S.sort === 'genre' ? ' data-on' : '') + ' role="group" aria-label="Жанр"><button type="button" data-lens="tags" aria-pressed="' + (S.lens === 'tags') + '">по тегам</button><button type="button" data-lens="sound" aria-pressed="' + (S.lens === 'sound') + '">по звучанию</button></div>';
    }
    if (t === 'albums') h += '<button type="button" class="chip" data-sealfilter aria-pressed="' + S.sealed + '" title="Не распечатаны: альбомы, которые ты ещё не слушал"><span class="wrap"></span><span class="lbl">Не распечатаны</span><small>' + sealedCount() + '</small></button>';
    if (S.v !== 'c') h += '<span class="grow"></span>';
    h += '<div class="views" role="group" aria-label="Вид"><button type="button" data-view="grid" aria-pressed="' + (S.view === 'grid') + '" aria-label="Плиткой">' + icon('Grid', 16) + '</button><button type="button" data-view="rows" aria-pressed="' + (S.view === 'rows') + '" aria-label="Строками">' + icon('List', 16) + '</button></div>';
  } else if (S.v !== 'c') h += '<span class="grow"></span>';
  h += '<button type="button" class="sbtn" data-search aria-label="Поиск по библиотеке">' + icon('Search', 18) + '<kbd>/</kbd></button>';
  return h;
}
function renderLib() {
  stage.dataset.v = S.v;
  let h = '';
  if (S.v === 'b') h += '<div class="daylight" style="--day-bg:url(' + PICK.bg + ')"' + (S.tab === 'albums' ? '' : ' hidden') + '></div>';
  if (S.v === 'a') h += '<div class="head"><div><h1 class="title">Библиотека</h1><div class="sum">' + summary() + '</div></div></div>' + tabsHtml() + '<div class="dayslot">' + (S.tab === 'albums' ? dayHtml() : '') + '</div>';
  if (S.v === 'b') h += '<div class="head"><div class="hl"><div><h1 class="title">Библиотека</h1><div class="sum">' + summary() + '</div></div>' + tabsHtml() + '</div><div class="dayslot">' + (S.tab === 'albums' ? dayHtml() : '') + '</div></div>';
  h += '<span class="sentinel" aria-hidden="true"></span><div class="bar" id="bar">' + barHtml() + '</div><div id="shelf"></div>';
  lib.innerHTML = h;
  renderShelf(false);
  requestAnimationFrame(placeMarks);
  notes();
}
function renderBar() { $('#bar').innerHTML = barHtml(); placeMarks(); }

/* the underline under the open tab and the thumb under the sort: they spring to the new place */
function placeMarks() {
  const tb = $('.tabs [aria-pressed="true"]'), ul = $('.tabs .ul');
  if (tb && ul) { ul.style.setProperty('--x', tb.offsetLeft + 'px'); ul.style.setProperty('--w', tb.offsetWidth + 'px'); }
  const sb = $('.sorts [aria-pressed="true"]'), th = $('.sorts .thumb');
  if (sb && th) { th.style.setProperty('--x', sb.offsetLeft + 'px'); th.style.setProperty('--w', sb.offsetWidth + 'px'); }
}

/* ── the shelf ─────────────────────────────────────────────────────────── */
function cardHtml(a, isDay) {
  const sealed = !a.p;
  const cap = S.v === 'c' ? '<div class="cap">' + (isDay ? '<span class="dayLabel">Пластинка дня</span>' : '') + '<b>' + esc(a.t) + '</b><small>' + esc(a.ar) + (a.y ? ' · ' + a.y : '') + '</small>' + (isDay ? '<div class="why">' + why(a) + '</div>' : '') + '</div>' : '';
  return '<article class="card" data-id="' + a.id + '"' + (sealed ? ' data-sealed' : '') + (isDay ? ' data-day' : '') + '><div class="deck">' +
    '<span class="disc vinyl"><span class="lbl" style="background:' + labelBg(a) + '"></span></span>' +
    '<img class="sleeve" src="' + (isDay && S.v === 'c' ? PICK.big : a.c) + '" alt="" decoding="async">' + (sealed ? '<span class="film"></span>' : '') + cap +
    '<button type="button" class="play" data-play aria-label="Слушать «' + esc(a.t) + '»">' + PLAY + '</button></div>' +
    '<div class="ct">' + esc(a.t) + '</div><div class="cs">' + esc(a.ar) + (a.y ? ' · ' + a.y : '') + '</div></article>';
}
const maxP = () => Math.max(1, ...AL.map(a => a.p));
function rowHtml(a, mp) {
  const sealed = !a.p;
  return '<div class="row" data-id="' + a.id + '"' + (sealed ? ' data-sealed' : '') + '><div class="rc"><img src="' + a.c + '" alt="" decoding="async">' + (sealed ? '<span class="film"></span>' : '') + '</div>' +
    '<b>' + esc(a.t) + '</b><span class="m">' + esc(a.ar) + '</span><span class="n">' + (a.y || '—') + '</span><span class="m">' + esc(S.sort === 'genre' && S.lens === 'tags' ? (CL[a.cl]?.name || '—') : a.g) + '</span>' +
    '<span class="n">' + a.n + ' ' + plural(a.n, 'песня', 'песни', 'песен') + '</span>' +
    (a.p ? '<span class="pl"><i style="--f:' + Math.sqrt(a.p / mp).toFixed(3) + '"></i>' + a.p + '</span>' : '<span><span class="new">не слушал</span></span>') +
    '<button type="button" class="rp" data-play aria-label="Слушать">' + PLAY_S + '</button></div>';
}
function divHtml(s) {
  const n = s.items.length, cnt = n + ' ' + plural(n, 'альбом', 'альбома', 'альбомов');
  const stack = '<span class="stack">' + s.items.slice(0, 4).map(a => '<img src="' + a.c + '" alt="">').join('') + '</span>';
  const dp = '<button type="button" class="dp" data-play-sec="' + esc(s.key) + '">' + PLAY_S + 'Слушать секцию</button>';
  if (S.v === 'b') return '<div class="dv"><div class="tab">' + stack + '<h2>' + esc(s.name) + '</h2><small>' + cnt + '</small></div>' + dp + '</div>';
  if (S.v === 'c') return '<div class="dv"><h2>' + esc(s.name) + '</h2><small>' + cnt + '</small>' + dp + '</div>';
  return '<div class="dv"><h2>' + esc(s.name) + '</h2><small>' + cnt + '</small><span class="rule"></span>' + dp + '</div>';
}
let SECS = [];
function renderShelf(flipIt) {
  const shelf = $('#shelf');
  const old = flipIt ? snapshot() : null;
  let h = '';
  if (S.tab === 'albums') {
    SECS = sections();
    const mp = maxP();
    if (!SECS.some(s => s.items.length)) h = '<p class="empty">Всё распечатано: каждый альбом ты слушал хотя бы раз.</p>';
    for (const s of SECS) {
      h += '<section class="sec">' + (s.key != null ? divHtml(s) : '');
      if (S.view === 'grid') {
        const dayFirst = S.v === 'c' && s.key == null && !S.sealed;
        const items = dayFirst ? [DAY, ...s.items.filter(a => a !== DAY)] : s.items;
        h += '<div class="grid">' + items.map((a, i) => cardHtml(a, dayFirst && i === 0)).join('') + '</div>';
      } else {
        h += (s === SECS[0] ? '<div class="rhead"><span></span><span>Альбом</span><span>Артист</span><span>Год</span><span>' + (S.sort === 'genre' && S.lens === 'tags' ? 'Звучание' : 'Жанр') + '</span><span>Песни</span><span>Прослушано</span><span></span></div>' : '') +
          '<div class="rows">' + s.items.map(a => rowHtml(a, mp)).join('') + '</div>';
      }
      h += '</section>';
    }
  } else if (S.tab === 'artists') {
    const list = AR.slice().sort(S.asort === 'az' ? (a, b) => a.nn.localeCompare(b.nn, 'ru') : S.asort === 'tracks' ? (a, b) => b.n - a.n : (a, b) => b.p - a.p || b.n - a.n);
    const ph = a => a.c ? '<img src="' + a.c + '" alt="" decoding="async">' : '<span class="mono" style="--h:' + ([...a.name].reduce((s, c) => s + c.charCodeAt(0), 0) % 360) + '">' + esc([...a.name][0]) + '</span>';
    if (S.view === 'grid') h = '<div class="agrid">' + list.map(a => '<div class="acard" data-artist="' + a.id + '"><div class="aph">' + ph(a) +
      '<button type="button" class="play" data-play-artist aria-label="Слушать ' + esc(a.name) + '">' + PLAY + '</button></div><b>' + esc(a.name) + '</b><small>' +
      (a.al ? a.al + ' ' + plural(a.al, 'альбом', 'альбома', 'альбомов') + ' · ' : '') + a.n + ' ' + plural(a.n, 'песня', 'песни', 'песен') + '</small></div>').join('') + '</div>';
    else h = '<div class="rhead arow" style="display:grid"><span></span><span>Артист</span><span>Альбомы</span><span>Песни</span><span>Прослушано</span><span></span></div><div class="rows">' + list.map(a =>
      '<div class="row arow" data-artist="' + a.id + '"><div class="rc">' + (a.c ? '<img src="' + a.c + '" alt="">' : '<img alt="" style="background:hsl(' + ([...a.name].reduce((s, c) => s + c.charCodeAt(0), 0) % 360) + ' 35% 30%)">') + '</div><b>' + esc(a.name) + '</b><span class="n">' + (a.al || '—') + '</span><span class="n">' + a.n + '</span>' +
      (a.p ? '<span class="pl"><i style="--f:' + Math.sqrt(a.p / MPA).toFixed(3) + '"></i>' + a.p + '</span>' : '<span><span class="new">не слушал</span></span>') + '<button type="button" class="rp" data-play-artist aria-label="Слушать">' + PLAY_S + '</button></div>').join('') + '</div>';
  } else if (S.tab === 'lists') {
    h = '<div class="pgrid">' + D.playlists.slice().sort((a, b) => b.upd.localeCompare(a.upd)).map(p => {
      const c = p.c.filter(Boolean);
      return '<div class="pcard" data-list="' + p.id + '"><div class="mosaic" data-n="' + c.length + '">' + c.map(u => '<img src="' + u + '" alt="">').join('') + '</div><b>' + esc(p.name) + '</b><small>' + p.n + ' ' + plural(p.n, 'песня', 'песни', 'песен') + ' · обновлён ' + day(p.upd) + '</small></div>';
    }).join('') + '<div class="pcard" data-newlist><div class="pnew"><span class="plus">' + icon('Plus', 22) + '</span>Новый плейлист</div></div></div>';
  } else {
    h = '<div class="soon"><h2>Статистика — следующий раунд</h2><p>Время и дни прослушивания с фразами-сравнениями, серия дней подряд и лучшая серия, любимые артист и песня, портрет слушателя из твоих данных, годы и жанры короткой сводкой, ачивки со всплывашкой и тихим «бульком».</p></div>';
  }
  shelf.innerHTML = h;
  if (old) flip(old);
}
/* things travel: cards that were on screen move to their new places, new ones rise in */
function snapshot() { const r = scroll.getBoundingClientRect(), m = new Map();
  $$('#shelf [data-id]').forEach(el => { const b = el.getBoundingClientRect(); if (b.bottom > r.top && b.top < r.bottom) m.set(el.dataset.id, b); }); return m; }
function flip(old) {
  if (reduce) return;
  const r = scroll.getBoundingClientRect(); let k = 0;
  $$('#shelf [data-id], #shelf .dv').forEach(el => {
    const b = el.getBoundingClientRect(); if (b.bottom < r.top || b.top > r.bottom) return;
    const o = el.dataset.id && old.get(el.dataset.id);
    if (o) { const dx = (o.left - b.left) / SC, dy = (o.top - b.top) / SC; if (Math.abs(dx) + Math.abs(dy) < 1) return;
      el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: 640, easing: SETTLE }); }
    else el.animate([{ opacity: 0, transform: 'translateY(16px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: Math.min(k++, 28) * 12, easing: 'cubic-bezier(.2,.9,.3,1.08)', fill: 'backwards' });
  });
}
function keepBar() { const s = $('.sentinel'); if (!s) return; const top = s.offsetTop; if (scroll.scrollTop > top) scroll.scrollTop = top; }

/* ── the sticky bar and the dividers know when they stand still ────────── */
scroll.addEventListener('scroll', () => {
  const bar = $('#bar'), sen = $('.sentinel'); if (!bar || !sen) return;
  const top = scroll.getBoundingClientRect().top;
  bar.toggleAttribute('data-stuck', sen.getBoundingClientRect().top < top + 1);
  const bh = bar.getBoundingClientRect().height;
  $$('#shelf .dv').forEach(d => d.toggleAttribute('data-stuck', d.getBoundingClientRect().top <= top + bh + 2 && d.parentElement.getBoundingClientRect().top < top + bh - 2));
  if (menu) closeMenu();
}, { passive: true });

/* ── playing: the cover flies into the mini player ─────────────────────── */
const mini = { cover: $('#miniCover'), title: $('#miniTitle'), artist: $('#miniArtist') };
let playing = true, pos = 72, dur = 238, ACC = '#cfd0ff';
function setNow(t, accent) {
  const a = byId[t.al];
  mini.cover.src = a ? a.c : ''; mini.title.textContent = t.t; mini.artist.textContent = t.ar;
  ACC = accent || a?.acc || '#cfd0ff'; $('#mini').style.setProperty('--mini-acc', ACC);
  pos = 0; dur = 180 + (t.t.length * 7) % 120; setPlaying(true);
}
function fly(img, then) {
  const to = mini.cover;
  if (!img || reduce || !img.naturalWidth) { then(); return; }
  const a = at(img), b = at(to);
  const cv = document.createElement('canvas'); cv.width = cv.height = 160; cv.className = 'fly';
  try { cv.getContext('2d').drawImage(img, 0, 0, 160, 160); } catch (e) { then(); return; }
  Object.assign(cv.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px', transformOrigin: '0 0', borderRadius: getComputedStyle(img).borderRadius });
  stage.appendChild(cv);
  const dx = a.x - b.x, dy = a.y - b.y, s = a.w / b.w;
  cv.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ')', borderRadius: getComputedStyle(img).borderRadius },
    { transform: 'translate(' + dx * .45 + 'px,' + (dy * .45 - 90) + 'px) scale(' + (1 + (s - 1) * .4) + ') rotate(-4deg)', offset: .45 },
    { transform: 'none', borderRadius: '9px' }], { duration: 680, easing: 'cubic-bezier(.3,.6,.25,1)' }).onfinish = () => {
    cv.remove(); then();
    to.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.2) rotate(-3deg)' }, { transform: 'scale(1)' }], { duration: 440, easing: SPRING });
  };
}
function playAlbum(a, img) {
  const t = topTrack(x => x.al === a.id) || { t: a.t, ar: a.ar, al: a.id };
  const go = () => fly(img, () => setNow(t, a.acc));
  if (!a.p) tear(img.closest('.card, .row'), a, go); else go();
}
/* the first play of a sealed sleeve: the film tears in two and falls away */
function tear(el, a, then) {
  a.p = 1;
  const film = el && $('.film', el);
  const chip = $('[data-sealfilter]'); if (chip) $('small', chip).textContent = sealedCount();
  if (!film || reduce) { film?.remove(); el?.removeAttribute('data-sealed'); then(); toast('<b>Распечатано.</b> <span>Осталось ' + sealedCount() + '</span>'); return; }
  const r = at(film);
  const piece = (clip, kf) => { const p = document.createElement('div'); p.className = 'shred';
    Object.assign(p.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', clipPath: clip }); stage.appendChild(p);
    return p.animate(kf, { duration: 760, easing: 'cubic-bezier(.45,0,.8,.4)', fill: 'forwards' }).finished.then(() => p.remove()); };
  film.remove(); el.removeAttribute('data-sealed');
  el.animate([{ transform: 'none' }, { transform: 'translateY(-3px) rotate(-.6deg)' }, { transform: 'none' }], { duration: 300, easing: SPRING });
  piece('polygon(0 0,56% 0,50% 18%,47% 40%,52% 62%,44% 100%,0 100%)', [{ transform: 'none', opacity: 1 }, { transform: 'translate(-6px,-4px) rotate(-3deg)', opacity: 1, offset: .14 }, { transform: 'translate(-60px,' + (r.h * .9) + 'px) rotate(-24deg)', opacity: 0 }]);
  piece('polygon(56% 0,100% 0,100% 100%,44% 100%,52% 62%,47% 40%,50% 18%)', [{ transform: 'none', opacity: 1 }, { transform: 'translate(7px,-6px) rotate(4deg)', opacity: 1, offset: .14 }, { transform: 'translate(70px,' + (r.h * 1.05) + 'px) rotate(30deg)', opacity: 0 }]);
  setTimeout(then, 260);
  setTimeout(() => toast('<b>Распечатано.</b> <span>Осталось ' + sealedCount() + ' нераспечатанных</span>'), 500);
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
setInterval(() => { if (!playing) return; pos = (pos + .25) % dur; $('#mini').style.setProperty('--p', (pos / dur).toFixed(4)); $('#miniTime').textContent = clock(pos) + ' / ' + clock(dur); }, 250);
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
  const acc = ACC;
  const pts = [[0, h]]; for (let i = 0; i < N; i++) pts.push([(i + .5) / N * w, h - lvl[i] * (h - 6)]); pts.push([w, h]);
  cx.beginPath(); cx.moveTo(0, h);
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; cx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2); }
  cx.lineTo(w, h); cx.closePath();
  const g = cx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, acc); g.addColorStop(1, 'transparent');
  cx.globalAlpha = .28; cx.fillStyle = g; cx.fill(); cx.globalAlpha = .9; cx.strokeStyle = acc; cx.lineWidth = 2; cx.stroke(); cx.globalAlpha = 1;
  if (playing || moving) spec();
}

/* ── search: the icon grows into a field, the answers drop out of it ───── */
let SR = null;
function search(q) {
  const n = norm(q); if (!n) return null;
  const sc = s => !s ? 0 : s.startsWith(n) ? 3 : (' ' + s).includes(' ' + n) ? 2 : s.includes(n) ? 1 : 0;
  const pick = (list, f, cap, tie) => list.map(x => [f(x), x]).filter(p => p[0] > 0).sort((x, y) => y[0] - x[0] || tie(x[1], y[1])).slice(0, cap);
  const groups = [
    { k: 'artist', name: 'Артисты', hits: pick(AR, a => sc(a.nn), 3, (x, y) => y.p - x.p || y.n - x.n) },
    { k: 'album', name: 'Альбомы', hits: pick(AL, a => Math.max(sc(a.nt), sc(a.na) * .5), 4, (x, y) => y.p - x.p) },
    { k: 'song', name: 'Песни', hits: pick(TR, t => Math.max(sc(t.nt), sc(t.na) * .4), 6, (x, y) => y.p - x.p) },
  ].filter(g => g.hits.length);
  groups.sort((x, y) => y.hits[0][0] - x.hits[0][0]);
  return groups;
}
function mark(s, q) { const n = norm(q); const i = s.toLowerCase().replace(/ё/g, 'е').indexOf(n);
  return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + n.length)) + '</mark>' + esc(s.slice(i + n.length)); }
function hitHtml(k, x, q, idx) {
  if (k === 'artist') return '<button type="button" class="hit" data-k="artist" data-hit="' + idx + '"><img class="pic" src="' + (x.c || '') + '" alt=""><span class="tx"><b>' + mark(x.name, q) + '</b><small><i>Артист</i> · ' +
    (x.al ? x.al + ' ' + plural(x.al, 'альбом', 'альбома', 'альбомов') + ' · ' : '') + x.n + ' ' + plural(x.n, 'песня', 'песни', 'песен') + '</small></span><span class="go">' + CHEV + '</span></button>';
  if (k === 'album') return '<button type="button" class="hit" data-k="album" data-hit="' + idx + '"><img class="pic" src="' + x.c + '" alt=""><span class="tx"><b>' + mark(x.t, q) + '</b><small><i>Альбом</i> · ' + esc(x.ar) + (x.y ? ' · ' + x.y : '') + '</small></span><span class="go">' + CHEV + '</span></button>';
  const a = byId[x.al];
  return '<button type="button" class="hit" data-k="song" data-hit="' + idx + '"><span class="pw"><img class="pic" src="' + (a?.c || '') + '" alt=""><span class="note">' + NOTE + '</span></span><span class="tx"><b>' + mark(x.t, q) + '</b><small><i>Песня</i> · ' + esc(x.ar) + (a ? ' · ' + esc(a.t) : '') + '</small></span><span class="go">' + icon('Play', 14) + '</span></button>';
}
function openSearch() {
  if (SR) { SR.input.focus(); return; }
  const btn = $('[data-search]'); if (!btn) return;
  const r = at(btn), W = stage.offsetWidth, w = Math.min(500, Math.max(380, W * .3));
  const right = W - (r.x + r.w);
  const field = document.createElement('div'); field.className = 'sfield';
  field.innerHTML = icon('Search', 18) + '<input id="libSearch" type="search" placeholder="Альбом, песня или артист" aria-label="Поиск по библиотеке" autocomplete="off" spellcheck="false"><button type="button" class="ic x" aria-label="Закрыть поиск">' + icon('Close', 16) + '</button>';
  Object.assign(field.style, { right: right + 'px', top: (r.y + r.h / 2 - 22) + 'px', width: w + 'px' });
  const res = document.createElement('div'); res.className = 'sres'; res.setAttribute('role', 'listbox');
  Object.assign(res.style, { right: right + 'px', top: (r.y + r.h / 2 + 30) + 'px', width: w + 'px', maxHeight: (stage.offsetHeight - (r.y + r.h / 2 + 30) - 86 - 64) + 'px' });
  stage.append(field, res); btn.setAttribute('data-hide', '');
  SR = { field, res, input: $('input', field), btn, flat: [], on: 0 };
  if (!reduce) field.animate([{ clipPath: 'inset(0 0 0 ' + (w - 44) + 'px round 22px)', opacity: .6 }, { clipPath: 'inset(0 0 0 0 round 22px)', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.2,1.1,.3,1)' });
  SR.input.focus({ preventScroll: true });
  SR.input.addEventListener('input', () => draw());
  $('.x', field).addEventListener('click', closeSearch);
  SR.input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!SR.flat.length) return; SR.on = (SR.on + (e.key === 'ArrowDown' ? 1 : -1) + SR.flat.length) % SR.flat.length; mark2(); }
    else if (e.key === 'Enter' && SR.flat[SR.on]) { e.preventDefault(); act(SR.flat[SR.on], $('[data-hit="' + SR.on + '"]', SR.res)); }
  });
  res.addEventListener('pointermove', e => { const h = e.target.closest('[data-hit]'); if (h && +h.dataset.hit !== SR.on) { SR.on = +h.dataset.hit; mark2(); } });
  res.addEventListener('click', e => { const h = e.target.closest('[data-hit]'); if (h) act(SR.flat[+h.dataset.hit], h); });
}
let shown = false;
function draw() {
  const q = SR.input.value, groups = search(q);
  SR.flat = []; SR.on = 0;
  if (!groups) { if (shown) hideRes(); return; }
  let h = '';
  if (!groups.length) h = '<div class="snone">Ничего не нашлось по «' + esc(q) + '».<br>Ищу по названиям альбомов и песен и по именам артистов.</div>';
  for (const g of groups) {
    h += '<div class="sgroup" data-k="' + g.k + '"><h3>' + g.name + '<small>' + g.hits.length + '</small></h3>' +
      g.hits.map(([, x]) => { SR.flat.push({ k: g.k, x }); return hitHtml(g.k, x, q, SR.flat.length - 1); }).join('') + '</div>';
  }
  h += '<div class="shint"><span>↑↓ выбрать</span><span>Enter открыть</span><span>Esc закрыть</span></div>';
  SR.res.innerHTML = h; mark2();
  if (!shown) { shown = true; SR.res.hidden = false;
    if (!reduce) { SR.res.animate([{ transform: 'translateY(-8px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: SPRING });
      $$('.hit', SR.res).slice(0, 10).forEach((el, i) => el.animate([{ transform: 'translateY(6px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, delay: 40 + i * 22, easing: EASE, fill: 'backwards' })); } }
}
function hideRes() { shown = false; const r = SR.res; r.animate([{ opacity: 1 }, { transform: 'translateY(-6px) scale(.97)', opacity: 0 }], { duration: 160, easing: 'ease-in' }).finished.then(() => { if (!shown) { r.innerHTML = ''; } }); }
function mark2() { $$('.hit', SR.res).forEach(h => h.toggleAttribute('data-on', +h.dataset.hit === SR.on)); const el = $('[data-hit="' + SR.on + '"]', SR.res); if (el) { const r = SR.res, t = el.offsetTop, b = t + el.offsetHeight; if (t < r.scrollTop + 8) r.scrollTop = t - 8; else if (b > r.scrollTop + r.clientHeight - 30) r.scrollTop = b - r.clientHeight + 30; } }
function closeSearch() {
  if (!SR) return; const { field, res, btn } = SR; SR = null; shown = false;
  const w = field.offsetWidth;
  res.animate([{ opacity: 1 }, { transform: 'translateY(-8px) scale(.96)', opacity: 0 }], { duration: 170, easing: 'ease-in', fill: 'forwards' }).finished.then(() => res.remove());
  field.animate([{ clipPath: 'inset(0 0 0 0 round 22px)', opacity: 1 }, { clipPath: 'inset(0 0 0 ' + (w - 44) + 'px round 22px)', opacity: 0 }], { duration: reduce ? 1 : 260, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' })
    .finished.then(() => { field.remove(); btn.removeAttribute('data-hide'); btn.animate([{ transform: 'scale(.7)' }, { transform: 'none' }], { duration: 380, easing: SPRING }); });
}
function act(h, el) {
  if (!h) return;
  if (h.k === 'song') { const img = $('.pic', el); fly(img, () => setNow(h.x)); closeSearch(); return; }
  if (h.k === 'album') { toast('<b>' + esc(h.x.t) + '</b> <span>· здесь откроется разворот альбома</span>'); closeSearch(); return; }
  toast('<b>' + esc(h.x.name) + '</b> <span>· здесь откроется страница артиста</span>'); closeSearch();
}

/* ── the sort menu of «Стена» ──────────────────────────────────────────── */
let menu = null;
function openMenu(btn) {
  const t = S.tab, r = at(btn);
  const items = t === 'albums' ? [['plays', 'Слушаю чаще', 'по прослушиваниям'], ['new', 'Новые', 'по дате добавления'], ['az', 'А–Я', ''], ['year', 'Год', 'по десятилетиям'], null, ['genre:tags', 'Жанр по тегам', 'из файлов'], ['genre:sound', 'Жанр по звучанию', 'сонар вкуса']]
    : [['plays', 'Слушаю чаще', ''], ['az', 'А–Я', ''], ['tracks', 'Больше песен', '']];
  const cur = t === 'albums' ? (S.sort === 'genre' ? 'genre:' + S.lens : S.sort) : S.asort;
  menu = document.createElement('div'); menu.className = 'menu';
  menu.innerHTML = items.map(it => it ? '<button type="button" data-pick="' + it[0] + '" aria-pressed="' + (cur === it[0]) + '">' + it[1] + '<small>' + it[2] + '</small></button>' : '<hr>').join('');
  Object.assign(menu.style, { left: r.x + 'px', top: (r.y + r.h + 8) + 'px' });
  stage.appendChild(menu); btn.setAttribute('aria-expanded', 'true');
  if (!reduce) { menu.animate([{ transform: 'scale(.85)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: SPRING });
    $$('button', menu).forEach((b, i) => b.animate([{ transform: 'translateY(-4px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, delay: 30 + i * 26, easing: EASE, fill: 'backwards' })); }
  menu.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (!b) return; const [s, l] = b.dataset.pick.split(':');
    closeMenu(); if (t === 'albums') { S.sort = s; if (l) S.lens = l; } else S.asort = s; renderBar(); keepBar(); renderShelf(true); });
}
function closeMenu() { if (!menu) return; const m = menu; menu = null; $('[data-sortmenu]')?.setAttribute('aria-expanded', 'false');
  m.animate([{ opacity: 1 }, { transform: 'scale(.9)', opacity: 0 }], { duration: 150, easing: 'ease-in', fill: 'forwards' }).finished.then(() => m.remove()); }

/* ── events ────────────────────────────────────────────────────────────── */
lib.addEventListener('click', e => {
  const t = e.target;
  const tab = t.closest('[data-tab]');
  if (tab) { if (S.tab === tab.dataset.tab) return; S.tab = tab.dataset.tab;
    $$('.tabs [data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === S.tab))); placeMarks();
    const slot = $('.dayslot'); if (slot) { const want = S.tab === 'albums';
      if (want && !slot.firstChild) { slot.innerHTML = dayHtml(); slot.firstChild?.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: EASE }); }
      if (!want && slot.firstChild) slot.innerHTML = ''; }
    const dl = $('.daylight'); if (dl) dl.hidden = S.tab !== 'albums';
    renderBar(); keepBar(); renderShelf(false);
    if (!reduce) $('#shelf').animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: EASE });
    return; }
  const so = t.closest('[data-sort]');
  if (so) { const k = so.dataset.sort; if (S.tab === 'albums') { if (S.sort === k) return; S.sort = k; } else { if (S.asort === k) return; S.asort = k; }
    $$('.sorts [data-sort]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sort === k))); placeMarks();
    $('.lens')?.toggleAttribute('data-on', S.tab === 'albums' && S.sort === 'genre');
    keepBar(); renderShelf(true); return; }
  const ln = t.closest('[data-lens]');
  if (ln) { if (S.lens === ln.dataset.lens) return; S.lens = ln.dataset.lens; $$('.lens [data-lens]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lens === S.lens))); keepBar(); renderShelf(true); return; }
  if (t.closest('[data-sealfilter]')) { S.sealed = !S.sealed; t.closest('[data-sealfilter]').setAttribute('aria-pressed', String(S.sealed)); keepBar(); renderShelf(true); return; }
  const vw = t.closest('[data-view]');
  if (vw) { if (S.view === vw.dataset.view) return; S.view = vw.dataset.view; $$('.views [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === S.view)));
    keepBar(); renderShelf(false); if (!reduce) $$('#shelf .card, #shelf .row, #shelf .acard').slice(0, 40).forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: i * 10, easing: EASE, fill: 'backwards' })); return; }
  if (t.closest('[data-search]')) { openSearch(); return; }
  if (t.closest('[data-sortmenu]')) { menu ? closeMenu() : openMenu(t.closest('[data-sortmenu]')); return; }
  if (t.closest('[data-play-day]')) { const box = t.closest('[data-dayblock]') || t.closest('.card'); playAlbum(DAY, $('img', box) || $('.sleeve', box)); return; }
  const sec = t.closest('[data-play-sec]');
  if (sec) { const s = SECS.find(x => String(x.key) === sec.dataset.playSec); if (!s) return; const a = s.items.find(x => x.p) || s.items[0];
    const img = $('.stack img', sec.closest('.dv')); fly(img, () => setNow(topTrack(x => x.al === a.id) || { t: a.t, ar: a.ar, al: a.id }, a.acc));
    toast('<b>' + esc(s.name) + '</b> <span>· ' + s.items.length + ' ' + plural(s.items.length, 'альбом', 'альбома', 'альбомов') + ' вперемешку</span>'); return; }
  const pa = t.closest('[data-play-artist]');
  if (pa) { const box = pa.closest('[data-artist]'), ar = arById[box.dataset.artist]; const tr = topTrack(x => x.arId === ar.id) || topTrack(x => x.na === ar.nn);
    if (tr) fly($('img', box), () => setNow(tr)); return; }
  const card = t.closest('[data-id]');
  if (card) { const a = byId[card.dataset.id];
    if (t.closest('[data-play]') || !a.p) { playAlbum(a, $('.sleeve, .rc img', card)); return; }
    toast('<b>' + esc(a.t) + '</b> <span>· здесь откроется разворот альбома</span>'); return; }
  const ar = t.closest('[data-artist]');
  if (ar) { toast('<b>' + esc(arById[ar.dataset.artist].name) + '</b> <span>· здесь откроется страница артиста</span>'); return; }
  if (t.closest('[data-list]')) { toast('Экран плейлиста пока прежний'); return; }
  if (t.closest('[data-newlist]')) { toast('Здесь появится поле для названия'); }
});
stage.addEventListener('click', e => { if (menu && !e.target.closest('.menu, [data-sortmenu]')) closeMenu();
  if (SR && !e.target.closest('.sfield, .sres, [data-search]')) closeSearch(); });
$('.now', stage).addEventListener('click', () => toast('Здесь откроется плеер'));
document.addEventListener('keydown', e => {
  if (e.key === '/' && !e.target.closest('input, textarea')) { e.preventDefault(); openSearch(); }
  if (e.key === 'Escape') { closeMenu(); }
});

function notes() { $$('#notes section').forEach(s => { const n = s.dataset.n; s.dataset.on = String(n === 'all' || n === 'srv' || n === S.v); }); }
$$('#vSeg button').forEach(b => b.addEventListener('click', () => { if (S.v === b.dataset.v) return; S.v = b.dataset.v; store.set('v', S.v); closeSearch(); closeMenu(); syncSegs(); renderLib(); scroll.scrollTop = 0; }));
$$('#sSeg button').forEach(b => b.addEventListener('click', () => { S.size = +b.dataset.s; store.set('size', S.size); closeSearch(); closeMenu(); syncSegs(); fit(); }));
function syncSegs() { $$('#vSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.v))); $$('#sSeg button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.s === S.size))); }
addEventListener('resize', fit);

icons(document);
const first = topTrack(() => true);
setNow(first); pos = 72;
syncSegs(); renderLib(); fit();
})();
