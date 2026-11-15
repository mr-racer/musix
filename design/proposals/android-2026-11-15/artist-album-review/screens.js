// screens.js — the artist «Кадр», the album «Конверт», the stubs of entries (library, player), the states
// and the review panel. Data: DATA (bake.py), images: DATA.img (turned into blob URLs at start).
let IMGURL = {};
const img = (k) => (k && IMGURL[k]) || '';
const el = {
  stage: $('#stage'), pgA: $('#pgArtist'), pgL: $('#pgLibrary'), arScroll: $('#arScroll'), arIn: $('#arIn'), arBack: $('#arBack'), arHead: $('#arHead'),
  album: $('#album'), alBg: $('#alBg'), slot: $('#alSlot'), slotLo: $('#alCoverLo'), slotHi: $('#alCover'), alScroll: $('#alScroll'), leaf: $('#leaf'), leafIn: $('#leafIn'),
  alClose: $('#alClose'), alHead: $('#alHead'), mini: $('#mini'), miniArt: $('#miniArt'), miniTitle: $('#miniTitle'), miniArtist: $('#miniArtist'), miniPlay: $('#miniPlay'), miniNext: $('#miniNext'),
  qchip: $('#qchip'), ps: $('#pstub'), tabbar: $('#tabbar'), libScroll: $('#libScroll'), libIn: $('#libIn'),
};
let M = { W: 412, H: 915, P: 20, ap: 16, S: 170, C: 380, ct: 88, fh: 461 };
const st = { slug: 'arctic-monkeys', a: null, scene: 'ready', heard: 'snap', page: 'artist', now: null, playing: false, ctx: '', queue: [], libTab: 'artists' };
const RAW = Object.fromEntries(DATA.artists.map((a) => [a.slug, a]));
let cache = {};

/* ---------------- words ---------------- */
const MON_G = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MON_P = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const dayMon = (d) => { if (!d) return ''; const [, m, dd] = d.split('-').map(Number); return `${dd} ${MON_G[m - 1]}`; };
const inMonth = (d) => (d ? MON_P[+d.split('-')[1] - 1] : '');
const pl = {
  songs: (n) => plural(n, 'песня', 'песни', 'песен'), songsOf: (n) => plural(n, 'песни', 'песен', 'песен'), albums: (n) => plural(n, 'альбом', 'альбома', 'альбомов'),
  plays: (n) => plural(n, 'прослушивание', 'прослушивания', 'прослушиваний'), times: (n) => plural(n, 'раз', 'раза', 'раз'), years: (n) => plural(n, 'год', 'года', 'лет'),
  noms: (n) => plural(n, 'номинация', 'номинации', 'номинаций'), laur: (n) => plural(n, 'лауреата', 'лауреатов', 'лауреатов'),
};
const COUNTRY = DATA.country || {};
const countryName = (cc) => COUNTRY[cc] || (() => { try { return new Intl.DisplayNames(['ru'], { type: 'region' }).of(cc); } catch (e) { return cc; } })();
const stars = (() => { let s = ''; for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) s += `<circle cx="${(1.5 + c * 2.5).toFixed(1)}" cy="${(1.4 + r * 2.5).toFixed(1)}" r=".5" fill="#fff"/>`; return s; })();
const FLAG = {
  US: `<svg viewBox="0 0 30 20" preserveAspectRatio="xMidYMid slice"><rect width="30" height="20" fill="#fff"/>${[0, 2, 4, 6, 8, 10, 12].map((i) => `<rect y="${(i * 20 / 13).toFixed(2)}" width="30" height="${(20 / 13).toFixed(2)}" fill="#b22234"/>`).join('')}<rect width="13" height="${(20 * 7 / 13).toFixed(2)}" fill="#3c3b6e"/>${stars}</svg>`,
  GB: '<svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice"><rect width="60" height="30" fill="#012169"/><path d="M0 0L60 30M60 0L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0L60 30M60 0L0 30" stroke="#C8102E" stroke-width="2"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></svg>',
  CA: '<svg viewBox="0 0 40 20" preserveAspectRatio="xMidYMid slice"><rect width="40" height="20" fill="#fff"/><rect width="10" height="20" fill="#d52b1e"/><rect x="30" width="10" height="20" fill="#d52b1e"/><path fill="#d52b1e" d="M20 3.4l1.3 2.5 1.5-.7-.6 3.5 2.1-2.1.5 1.4 2.4-.4-.8 2.3 1 .5-3.9 3 .4 1.3-3.6-.4.1 3.4h-.8l.1-3.4-3.6.4.4-1.3-3.9-3 1-.5-.8-2.3 2.4.4.5-1.4 2.1 2.1-.6-3.5 1.5.7z"/></svg>',
};

/* ---------------- the fan's way: levels in metal, the air in radio words ---------------- */
const LEVELS = [
  { n: 'На разогреве', at: 0, rule: 'первая песня', m: '#9aa3b5', bg: 'linear-gradient(145deg,#e4e8f0,#8e97a8)', tx: 'linear-gradient(180deg,#eef1f6,#9aa3b5)', txl: 'linear-gradient(180deg,#6f788a,#4a5264)' },
  { n: 'Танцпол', at: 10, rule: '10 прослушиваний', m: '#c98a5a', bg: 'linear-gradient(145deg,#f6d3b0,#b9784a 55%,#7a4524)', tx: 'linear-gradient(180deg,#f8dcc0,#c98a5a)', txl: 'linear-gradient(180deg,#a8643a,#6e3c1c)' },
  { n: 'Первый ряд', at: 50, rule: '50 прослушиваний', m: '#c8ccd6', bg: 'linear-gradient(145deg,#ffffff,#c9cdd7 50%,#8a8f9c)', tx: 'linear-gradient(180deg,#ffffff,#b4b9c5)', txl: 'linear-gradient(180deg,#7e8492,#525764)' },
  { n: 'Бэкстейдж', at: 150, rule: '150 и половина альбомов', m: '#e3bd63', bg: 'linear-gradient(145deg,#fff1c4,#e3bd63 50%,#a87a26)', tx: 'linear-gradient(180deg,#fff3cf,#d9ae4c)', txl: 'linear-gradient(180deg,#a87c22,#74540e)' },
  { n: 'Легенда', at: 300, rule: '300 и все альбомы', m: '#cdd6ff', bg: 'linear-gradient(145deg,#ffffff,#dfe6f5 35%,#c6cfee 55%,#f0e2f6 75%,#b9c1d6)', tx: 'linear-gradient(100deg,#f6f8ff,#c9d5ff 40%,#f3daf6 70%,#dfe8ff)', txl: 'linear-gradient(100deg,#4f5fa6,#8656a6 50%,#3f6eae)' },
];
function levelOf(plays, albums) {
  const done = albums.filter((a) => a.n && a.heard / a.n >= 0.5).length, cov = done / Math.max(1, albums.length);
  let k = 0;
  for (let j = 0; j < LEVELS.length; j++) if (plays >= LEVELS[j].at && (j < 3 || cov >= (j === 3 ? 0.5 : 1))) k = j;
  const nx = LEVELS[k + 1];
  let need = null, p = 1;
  if (nx) {
    const covNeed = k + 1 === 3 ? 0.5 : k + 1 === 4 ? 1 : 0;
    if (plays < nx.at) { const l = nx.at - plays; need = { to: nx.n, rest: `ещё ${l} ${pl.plays(l)}`, l }; p = plays / nx.at; }
    else { const l = Math.ceil(covNeed * albums.length) - done; need = { to: nx.n, rest: `дослушать ещё ${l} ${pl.albums(l)}`, l }; p = cov / covNeed; }
  }
  return { ...LEVELS[k], k, need, p: clamp(p), done };
}
const FREQ = [['Не сходит с эфира', 5], ['Тяжёлая ротация', 4], ['В ротации', 3], ['Частый гость эфира', 2], ['Иногда в эфире', 1], ['Редко в эфире', 1]];
function freqOf(rank, N, plays) {
  if (!rank || !plays || N < 1) return { n: 'Ещё не в эфире', bars: 0, s: '' };
  const q = rank / N, t = rank === 1 ? 0 : q <= 0.02 ? 1 : q <= 0.1 ? 2 : q <= 0.3 ? 3 : q <= 0.6 ? 4 : 5;
  const pct = N > 1 ? Math.floor(((N - rank) / (N - 1)) * 100) : 100;
  return { n: FREQ[t][0], bars: FREQ[t][1], s: rank === 1 ? 'чаще всех в твоей библиотеке' : `чаще, чем ${pct} % твоих артистов` };
}
/* the Grammy laurel: its branches grow with the wins (a full wreath from 12) — web/src/artist/model.ts */
const LAUREL_STEM = 'M11.6 28.5Q0.4 19 7.6 1.6';
function laurelPath(k) {
  const P0 = [11.6, 28.5], P1 = [0.4, 19], P2 = [7.6, 1.6];
  const at = (t) => [0, 1].map((j) => (1 - t) ** 2 * P0[j] + 2 * (1 - t) * t * P1[j] + t * t * P2[j]);
  const tan = (t) => { const v = [0, 1].map((j) => 2 * (1 - t) * (P1[j] - P0[j]) + 2 * t * (P2[j] - P1[j])), l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
  const rot = (d, a) => [d[0] * Math.cos(a) - d[1] * Math.sin(a), d[0] * Math.sin(a) + d[1] * Math.cos(a)];
  const f = (x) => x.toFixed(2);
  const leaf = (p, d, L, w) => {
    const q = [p[0] + d[0] * L, p[1] + d[1] * L], m = [p[0] + d[0] * L * 0.5, p[1] + d[1] * L * 0.5], n = [-d[1] * w, d[0] * w];
    return `M${f(p[0])} ${f(p[1])}Q${f(m[0] + n[0])} ${f(m[1] + n[1])} ${f(q[0])} ${f(q[1])}Q${f(m[0] - n[0])} ${f(m[1] - n[1])} ${f(p[0])} ${f(p[1])}Z`;
  };
  let d = '';
  for (let i = 0; i < k; i++) {
    const t = k === 1 ? 0.1 : 0.1 + (i * 0.8) / (k - 1), p = at(t), tg = tan(t), L = 5.4 - (i * 1.2) / Math.max(1, k - 1);
    d += leaf(p, rot(tg, -0.62), L, 1.55) + leaf(p, rot(tg, 0.55), L * 0.78, 1.3);
  }
  return d + leaf(at(0.97), tan(0.97), 4, 1.4);
}
const laurelLeaves = (w) => (w ? Math.min(6, 1 + Math.ceil(w / 2.4)) : 2);
const laurel = (k, gold, right) => `<svg class="${right ? 'r' : 'l'}" viewBox="0 0 13 30" aria-hidden="true"><path d="${LAUREL_STEM}" fill="none" stroke="${gold ? '#c99a3c' : '#e3c37a'}" stroke-width=".9" stroke-linecap="round" opacity="${gold ? 1 : 0.7}"/><path d="${laurelPath(k)}" ${gold ? 'fill="url(#mxGold)"' : 'fill="none" stroke="#e3c37a" stroke-width=".8" opacity=".85"'}/></svg>`;
const statue = (win) => `<svg viewBox="0 0 20 30" aria-hidden="true"><g ${win ? 'fill="url(#mxGold)" stroke="rgba(96,66,12,.5)" stroke-width=".35"' : 'fill="none" stroke="#d9b45a" stroke-width=".9" opacity=".75"'} stroke-linejoin="round"><path d="M9.3 14.6C9.5 11.6 10.9 9.4 13 7.8L15.3 1.6C17.4 2 19.4 3.9 20 6.2L14 9.2C12.2 10.5 11 12.2 10.7 14.6Z"/><ellipse cx="10" cy="15.3" rx="6.3" ry="1.5"/><rect x="9.3" y="16.5" width="1.4" height="4.4" rx=".4"/><rect x="7.4" y="20.7" width="5.2" height="1.3" rx=".55"/></g>${win ? '<rect x="3" y="22" width="14" height="7.6" rx="1.1" fill="url(#mxBase)"/><rect x="3.4" y="22" width="13.2" height=".55" rx=".27" fill="#e2bd63" opacity=".85"/>' : '<rect x="3.4" y="22.4" width="13.2" height="6.8" rx="1" fill="none" stroke="#d9b45a" stroke-width=".9" opacity=".55"/>'}</svg>`;

/* ---------------- the model: one artist, as the screen needs it ---------------- */
function prep(r, mode) {
  const albums = r.albums.map((x) => {
    const tracks = x.tracks.map((t) => ({ ...t, plays: mode === 'none' ? 0 : mode === 'all' ? Math.max(t.plays, 2) : t.plays }));
    const heard = tracks.filter((t) => t.plays > 0).length, plays = tracks.reduce((s, t) => s + t.plays, 0);
    return { ...x, tracks, heard, plays, p: x.n ? heard / x.n : 0, last: mode === 'none' ? null : x.last || '2026-09-28', slug: r.slug };
  });
  const total = albums.reduce((s, a) => s + a.n, 0), heardTracks = albums.reduce((s, a) => s + a.heard, 0);
  const plays = mode === 'snap' ? r.plays : mode === 'none' ? 0 : Math.max(r.plays, 320, albums.reduce((s, a) => s + a.plays, 0));
  const rank = mode === 'none' ? null : mode === 'all' ? 1 : r.rank;
  const years = albums.map((a) => a.year).filter(Boolean);
  const a = {
    ...r, albums, total, heardTracks, plays, rank,
    lv: levelOf(plays, albums), fq: freqOf(rank, DATA.libArtists, plays),
    city: (r.city || '').split(',')[0] || null, country: countryName(r.cc),
    yearsText: r.dead && r.end ? `${r.start}–${r.end}` : r.start ? `с ${r.start}` : null,
    range: years.length ? (Math.min(...years) === Math.max(...years) ? `${years[0]}` : `${Math.min(...years)} – ${Math.max(...years)}`) : '',
    light: lum(r.page) > 0.55, story: mode === 'snap' ? r.story : null,
  };
  a.index = new Map();
  for (const al of albums) for (const t of al.tracks) a.index.set(t.id, { t, al, art: a });
  return a;
}
function lum(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 0; const n = parseInt(m[1], 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; }
const artist = (slug) => cache[slug] || (cache[slug] = prep(RAW[slug], st.heard));
const findTrack = (id) => { for (const s in RAW) { const hit = artist(s).index.get(id); if (hit) return hit; } return null; };
const hotOf = (al) => { const top = al.tracks.reduce((b, t) => (t.plays > (b?.plays || 0) ? t : b), null); return top && top.plays >= 2 ? top : null; };
function lamp(al) {
  if (!al.plays) return 'Ещё не распечатан — самое время';
  if (al.heard === al.n && al.plays >= al.n * 2) return `Обыгран до дыр: все ${al.n} ${pl.songs(al.n)}`;
  if (al.heard === al.n) return `Дослушан целиком · ${al.plays} ${pl.times(al.plays)} вместе`;
  if (al.heard / al.n < 0.5) return `Начат: ${al.heard} из ${al.n} — есть что открыть`;
  return `${al.plays} ${pl.times(al.plays)} вместе · последний — в ${inMonth(al.last)}`;
}
const statText = (x) => (x.p >= 1 ? `весь · ${x.n} ${pl.songs(x.n)}` : x.heard ? `${x.heard} из ${x.n}` : 'ещё не слушал');

/* ================= the artist «Кадр» ================= */
function frameHTML(a, loading) {
  const g = a.grammy, w = g?.wins || 0, n = g?.noms || 0, k = laurelLeaves(w);
  const gb = g && (w || n) ? `<span class="sep">·</span><button class="gb${w ? '' : ' zero'}" id="gb" aria-label="Грэмми: ${w || n}">${laurel(k, !!w)}<b>${w || n}</b>${laurel(k, !!w, true)}<em>${w ? 'Грэмми' : `${pl.noms(n)} Грэмми`}</em></button>` : '';
  // no photo: the name grows and stands on a field of the artist's own colour (the logo is not used there)
  const noph = st.scene === 'nophoto';
  const name = a.logo && !noph ? `<h1 class="sr">${esc(a.name)}</h1><img class="logo" id="arName" src="${img(a.logo)}" alt="">` : `<h1 class="name${a.name.length > 18 ? ' long' : ''}" id="arName">${esc(a.name)}</h1>`;
  return `<header class="frame${a.light && !noph ? ' light' : ''}${noph ? ' nophoto' : ''}" id="frame">
      ${noph ? '' : `<img class="ph" id="arPhoto" src="${loading ? img(a.slug + '-ph-t') : img(a.photo)}" alt="" style="${loading ? 'filter:blur(14px);transform:scale(1.1)' : ''}">
      <div class="ph-blur"><img src="${img(a.slug + '-ph-t')}" alt=""></div>`}<i class="shade"></i>
      <div class="ftext">${name}
        <div class="facts">${loading ? '<p><i class="sk" style="width:180px;height:14px"></i></p><p><i class="sk" style="width:130px;height:14px"></i></p>'
          : `<p><span class="flag">${FLAG[a.cc] || ''}</span><span>${esc(a.country || '')}</span>${a.city ? `<span class="sep">·</span><span>${esc(a.city)}</span>` : ''}</p>
          <p>${a.genre ? `<span>${esc(a.genre)}</span>` : ''}${a.yearsText ? `<span class="sep">·</span><span class="num" style="font-family:var(--sans)">${a.yearsText}</span>` : ''}${gb}</p>`}</div>
      </div></header>`;
}
function youHTML(a) {
  const L = a.lv, nx = LEVELS[L.k + 1];
  const vars = `--m:${L.m};--mbg:${L.bg};--mtx:${L.tx};--mtxl:${L.txl};--nmbg:${(nx || L).bg};--p:${L.p.toFixed(3)}`;
  const beads = LEVELS.map((_, j) => `<i class="${j <= L.k ? 'on' : ''}"></i>`).join('');
  const bars = [6, 8.5, 11, 13.5, 16].map((h, j) => `<i class="${j < a.fq.bars ? 'on' : ''}" style="height:${h}px"></i>`).join('');
  const s = a.plays ? `${a.plays} ${pl.plays(a.plays)} · ${a.heardTracks} из ${a.total} ${pl.songsOf(a.total)}${a.fq.s ? ` · ${a.fq.s}` : ''}` : `Ещё ни одной песни. Начни с «${esc(a.albums[0]?.clean || '')}» — с него всё и началось.`;
  const next = L.need ? `До уровня «${L.need.to}» — ${L.need.rest}` : 'Легенда — выше только сцена';
  return `<button class="you" id="you" style="${vars}" aria-label="Ты и ${esc(a.name)}: ${L.n}, ${a.fq.n}">
    <span class="you-h"><span>Ты и ${esc(a.name)}</span>${icon('ChevronRight')}</span>
    <span class="you-l"><span class="lvl"><em>${L.n}</em><span class="beads">${beads}</span></span><span class="air"><span class="bars">${bars}</span><span>${a.fq.n}</span></span></span>
    <span class="you-s">${s}</span>
    <span class="you-n">${next}${L.need ? '<i class="prog"><i></i></i>' : ''}</span></button>`;
}
function bodyHTML(a) {
  const nAl = a.albums.length, off = st.scene === 'offline';
  return `<div class="ar-body">
    <p class="ar-meta"><span>${nAl} ${pl.albums(nAl)}</span><span class="dot">·</span><button class="link" id="arSongs"><span>${a.total} ${pl.songs(a.total)}</span>${icon('ChevronRight')}</button>${a.bio ? `<span class="dot">·</span><button class="link" id="arBio"><span>Биография</span>${icon('ChevronRight')}</button>` : ''}</p>
    <div class="acts"><button class="pill big solid mb" id="arPlay"></button><button class="pill big" id="arFlow"${off ? ' aria-disabled="true"' : ''}>${icon('Sparkles')}<span>Поток артиста</span></button></div>
    ${off ? '<p class="offnote"><i></i>Нет сети — показываю то, что сохранено на телефоне</p>' : ''}
    ${youHTML(a)}
    <section class="disco"><div class="disco-h"><h2>Дискография</h2><span>${nAl === 1 ? 'один альбом' : a.range}</span></div><div class="axis" id="axis"></div></section>
  </div>`;
}
function skeletonHTML() {
  return `<div class="ar-body"><p class="ar-meta"><i class="sk" style="width:220px;height:14px"></i></p>
    <div class="acts"><i class="sk" style="height:48px;border-radius:24px"></i><i class="sk" style="height:48px;border-radius:24px"></i></div>
    <div style="margin-top:24px;display:flex;flex-direction:column;gap:10px"><i class="sk" style="width:60%;height:16px"></i><i class="sk" style="width:90%;height:12px"></i><i class="sk" style="width:75%;height:12px"></i></div>
    <div style="margin-top:34px;display:grid;grid-template-columns:1fr 1fr;gap:20px 40px"><i class="sk" style="aspect-ratio:1"></i><i></i><i></i><i class="sk" style="aspect-ratio:1;margin-top:-60%"></i></div></div>`;
}
function errorHTML() {
  return `<div class="ar-body"><div class="state-box"><b>Не получилось загрузить артиста</b><p>Проверь сеть — и попробуем ещё раз.</p><button class="pill" id="arRetry">${icon('Retry')}<span>Повторить</span></button></div></div>`;
}
let arDrag = null, arReveal = null, waterIO = null;
function renderArtist() {
  const a = st.a, pg = el.pgA, sc = st.scene;
  pg.style.setProperty('--page', a.page); pg.style.setProperty('--tint', a.tint || '#8a7a66');
  el.arIn.innerHTML = frameHTML(a, sc === 'loading' || sc === 'error') + (sc === 'error' ? errorHTML() : sc === 'loading' ? skeletonHTML() : bodyHTML(a));
  $('#arHeadImg').src = img(a.slug + '-ph-s'); $('#arHeadName').textContent = a.name;
  $('#arHeadSub').textContent = `${a.albums.length} ${pl.albums(a.albums.length)} · ${a.lv.n}`;
  if (sc === 'error') { $('#arRetry').addEventListener('click', () => { setScene('loading'); }); return; }
  if (sc === 'loading') return;
  const ph = $('#arPhoto');
  if (ph) { ph.style.opacity = 0; (ph.decode ? ph.decode() : Promise.resolve()).catch(() => {}).then(() => { ph.style.transition = 'opacity .4s var(--std)'; ph.style.opacity = ''; }); }
  $('#gb')?.addEventListener('click', openGrammy);
  $('#arSongs').addEventListener('click', openSongs);
  $('#arBio')?.addEventListener('click', openBio);
  $('#you').addEventListener('click', openPath);
  const play = $('#arPlay');
  setPlayButton(play, isPlaying('artist:' + a.slug));
  play.addEventListener('click', () => { hap('Press'); playContext('artist:' + a.slug); });
  $('#arFlow').addEventListener('click', () => {
    if (st.scene === 'offline') { toast('Поток артиста соберётся, когда вернётся сеть'); return; }
    hap('Press'); playContext('flow:' + a.slug); toast(`Поток ${a.name}: его песни и похожие по звуку`);
  });
  layoutAxis();
}

/* the axis of years: covers on both sides, each next one on the other side and lower ("a zipper"),
   the year is a stop on the axis at the cover's shoulder; pauses over six years break the zipper */
function layoutAxis() {
  const host = $('#axis'), a = st.a;
  if (!host) return;
  if (waterIO) waterIO.disconnect();
  const al = a.albums, L = a.lv;
  host.className = 'axis'; host.style.cssText = `--S:${M.S}px;--mbg:${L.bg}`;
  if (al.length === 1) return soloAxis(host, a, al[0]);
  const S = M.S, capH = 60, block = S + 9 + capH, step = Math.max(Math.round(S * 0.62), Math.ceil((block + 22) / 2));
  const cx = M.W / 2, xL = cx - 20 - S, xR = cx + 20;
  const tops = [], marks = [], segs = [];
  let y = 0;
  if (a.band && a.formed && (!al[0].year || a.formed < al[0].year)) { marks.push({ y: 0, t: `${a.formed} · группа собралась` }); y = 50; segs.push([12, y + 11, a.formed && al[0].year - a.formed > 6]); }
  al.forEach((x, i) => {
    let top = y;
    if (i > 0) {
      const gap = x.year && al[i - 1].year ? x.year - al[i - 1].year : 0;
      if (gap > 6) { const gy = tops[i - 1] + block + 16; marks.push({ y: gy, t: `${gap} ${pl.years(gap)}`, gap: true }); top = gy + 52; segs.push([tops[i - 1] + 11, top + 11, true]); }
      else { top = tops[i - 1] + step; segs.push([tops[i - 1] + 11, top + 11, false]); }
    }
    tops.push(top);
  });
  let end = tops[tops.length - 1] + block;
  if (a.dead && a.end) {
    const last = al[al.length - 1].year || a.end, gy = end + 18;
    marks.push({ y: gy, t: `✝ ${a.end}` }); segs.push([tops[tops.length - 1] + 11, gy + 12, a.end - last > 6]); end = gy + 34;
  }
  let html = segs.map(([y0, y1, gap]) => `<i class="seg-line${gap ? ' gap' : ''}" style="top:${y0}px;height:${Math.max(0, y1 - y0)}px"></i>`).join('');
  html += marks.map((m) => `<div class="mark${m.gap ? ' gap' : ''}" style="top:${m.y}px"><span>${esc(m.t)}</span></div>`).join('');
  al.forEach((x, i) => {
    const side = i % 2 ? 'R' : 'L', small = img(x.cover + '-s'), p = x.p;
    html += `<div class="al ${side}" data-i="${i}" style="left:${side === 'L' ? xL : xR}px;top:${tops[i]}px">
      <div class="cvw" style="--lab:url(${small})"><i class="vinyl"></i>
        <button class="cv${p >= 1 ? ' full' : p <= 0 ? ' none' : ''}" style="--p:${p.toFixed(3)}" aria-label="Открыть «${esc(x.clean)}», ${statText(x)}">
          <img class="g" src="${small}" alt=""><span class="fill"><img src="${small}" alt=""><i class="ln"></i></span>${p >= 1 ? `<span class="okm">${icon('Check')}</span>` : ''}</button></div>
      <span class="al-cap"><button class="t">${esc(x.clean)}</button><small>${x.ed ? `<span class="badge">${esc(x.ed)}</span>` : ''}${statText(x)}</small></span></div>
      <span class="yr${x.heard ? '' : ' mute'}" style="top:${tops[i]}px">${x.year || '—'}</span>`;
  });
  host.style.height = end + 'px';
  host.innerHTML = html;
  bindAxis(host, al);
}
function soloAxis(host, a, x) {
  const S1 = Math.round(M.W * 0.46), small = img(x.cover + '-s');
  host.className = 'solo'; host.style.cssText = `--S1:${S1}px;--S:${S1}px;--mbg:${a.lv.bg}`;
  host.innerHTML = `<div class="al L" data-i="0" style="position:relative;width:${S1}px"><div class="cvw" style="--lab:url(${small})"><i class="vinyl"></i>
      <button class="cv${x.p >= 1 ? ' full' : x.p <= 0 ? ' none' : ''}" style="--p:${x.p.toFixed(3)}" aria-label="Открыть «${esc(x.clean)}»"><img class="g" src="${small}" alt=""><span class="fill"><img src="${small}" alt=""><i class="ln"></i></span>${x.p >= 1 ? `<span class="okm">${icon('Check')}</span>` : ''}</button></div></div>
    <div class="al-cap"><span class="y">${x.year || ''}</span><button class="t">${esc(x.clean)}</button><small>${statText(x)}</small><p>Единственный альбом ${esc(a.name)} в твоей библиотеке.</p></div>`;
  bindAxis(host, [x]);
}
function bindAxis(host, al) {
  const press = (on, item) => item && item.classList.toggle('press', on);
  for (const item of $$('.al', host)) {
    // the title is under the cover on the axis, beside it when the artist has one album
    const x = al[+item.dataset.i], cv = $('.cv', item), t = $('.t', item) || $('.t', host);
    cv.addEventListener('pointerdown', () => press(true, item));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) cv.addEventListener(ev, () => setTimeout(() => press(false, item), ev === 'pointerup' ? 140 : 0));
    cv.addEventListener('click', () => openAlbum(x, st.a, { kind: 'img', el: cv }));
    t.addEventListener('click', () => openAlbum(x, st.a, { kind: 'word', el: t }));
  }
  el.arScroll.addEventListener('dragstart-mx', () => $$('.al.press', host).forEach((n) => n.classList.remove('press')), { once: true });
  // the water rises once, the first time a cover is seen; one after another, 60 ms apart
  let k = 0, kt = 0;
  waterIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      waterIO.unobserve(e.target);
      const cv = e.target, p = +cv.style.getPropertyValue('--p');
      if (still() || p <= 0) continue;
      const delay = (k++) * 60; clearTimeout(kt); kt = setTimeout(() => { k = 0; }, 150);
      const o = { duration: 700, delay, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'backwards' };
      $('.fill', cv).animate([{ transform: 'translateY(100%)' }, { transform: `translateY(${((1 - p) * 100).toFixed(2)}%)` }], o);
      $('.fill>img', cv).animate([{ transform: 'translateY(-100%)' }, { transform: `translateY(${((p - 1) * 100).toFixed(2)}%)` }], o);
      const ok = $('.okm', cv);
      if (ok) ok.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: delay + 640, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'backwards' });
    }
  }, { root: el.arScroll, threshold: 0.35 });
  for (const cv of $$('.cv', host)) waterIO.observe(cv);
}

/* the Grammy case: MorphMenu out of the laurel on Deep glass, above it, in the name's zone */
function openGrammy(e) {
  e.stopPropagation();
  const a = st.a, g = a.grammy, w = g.wins || 0, n = g.noms || 0, hollow = Math.max(0, n - w), total = w + hollow;
  const gw = total > 32 ? 10 : total > 22 ? 12 : 14, gs = Math.min(32, 216 / Math.max(1, total)).toFixed(1) + 'ms';
  const line = w ? `<b>№${g.pos}</b> из ${DATA.laureates} ${pl.laur(DATA.laureates)} твоей библиотеки${n ? ` · ${n} ${pl.noms(n)}` : ''}` : `${n} ${pl.noms(n)} — и ни одной статуэтки. Академия, ну.`;
  const shelf = Array.from({ length: w }, (_, i) => `<span class="st" style="--gw:${gw}px;--i:${i};--gs:${gs}">${statue(true)}</span>`).join('')
    + Array.from({ length: hollow }, (_, i) => `<span class="st" style="--gw:${gw}px;--i:${w + i};--gs:${gs}">${statue(false)}</span>`).join('');
  const W = Math.min(300, M.W - 32);
  openMorph(e.currentTarget, `<div class="gcase"><div class="gtop"><b class="gn${w ? '' : ' zero'}">${w || n}</b><span class="gt"><span class="gl">Грэмми</span><span class="gr">${line}</span></span></div><div class="shelf">${shelf}</div></div>`,
    { glass: 'deep', width: W, dim: 0.12, place: (b, mw, mh) => ({ x: clamp(b.x - 6, 16, M.W - mw - 16), y: Math.max(40, b.y - mh - 12) }) });
}
/* «Путь фаната»: five steps out of the strip, the dates they were taken */
function openPath(e) {
  const a = st.a, L = a.lv, s = a.story;
  const dates = {}; if (s?.first) dates[0] = s.first.date; for (const x of s?.levels || []) dates[x.k] = x.date;
  const rows = LEVELS.map((lv, j) => ({ lv, j })).reverse().map(({ lv, j }) => {
    const got = j <= L.k, cur = j === L.k;
    const right = got ? (dates[j] ? dayMon(dates[j]) : 'взят') : j === L.k + 1 && L.need ? L.need.rest.replace('дослушать ещё', 'ещё').replace(/ прослушивани\S+/, ' ' + pl.times(L.need.l)) : '';
    return `<li class="${got ? 'got' : ''}${cur ? ' cur' : ''}" style="--m:${lv.m};--mbg:${lv.bg};--mtx:${lv.tx};--mtxl:${lv.txl}"><i class="pd"></i><span><b>${lv.n}</b><small>${lv.rule}</small></span><em>${right}</em></li>`;
  }).join('');
  const top = L.k === 4 ? 'Легенда — выше только сцена.' : `Сейчас — «${L.n}». Следующая ступень — «${LEVELS[L.k + 1].n}».`;
  const first = s?.first ? `<p class="path-first">Всё началось ${dayMon(s.first.date)} с «${esc(s.first.title)}».</p>` : '';
  openMorph(e.currentTarget, `<span class="cap">Путь фаната · ${esc(a.name)}</span><p class="path-top">${top}</p><ol class="path">${rows}</ol>${first}`,
    { width: M.W - 24, dim: 0.3, place: (b, mw, mh) => ({ x: 12, y: clamp(b.y + b.h / 2 - mh / 2, 40, M.H - 76 - mh - 8) }) });
}
/* the sheets of the artist: the biography (Deep glass) and all the songs (float) */
function paragraphs(text) {
  const out = []; let cur = '';
  for (const s of text.split(/(?<=[.!?»])\s+(?=[A-ZА-ЯЁ«])/)) { cur += (cur ? ' ' : '') + s; if (cur.length > 380) { out.push(cur); cur = ''; } }
  if (cur) out.push(cur);
  return out;
}
function openBio() {
  const a = st.a;
  openSheet({ title: 'Биография', aside: a.name, glass: 'deep', dim: 0.3, build(inner) {
    inner.innerHTML = (a.nameOrigin ? `<div class="origin"><span class="cap">Откуда имя</span><p>${esc(a.nameOrigin)}</p></div>` : '')
      + `<div class="bio">${paragraphs(a.bio).map((p) => `<p>${esc(p)}</p>`).join('')}</div>`
      + (a.facts.length ? `<div class="knew" id="knew"><div class="knew-h"><span class="cap">А ты знал</span><span class="num" id="knewN">1 / ${a.facts.length}</span></div><div class="knew-box" id="knewBox"><div>${esc(a.facts[0])}</div></div>${a.facts.length > 1 ? '<span class="knew-more">Коснись — следующий факт</span>' : ''}</div>` : '');
    const box = $('#knewBox', inner);
    if (!box) return;
    // the box keeps the height of the tallest fact: nothing below it jumps
    const probe = document.createElement('div'); probe.style.cssText = 'position:absolute;visibility:hidden;left:0;right:0'; box.append(probe);
    let hmax = 0; for (const f of a.facts) { probe.textContent = f; hmax = Math.max(hmax, probe.offsetHeight); } probe.remove();
    box.style.setProperty('--kh', hmax + 'px');
    let i = 0;
    $('#knew', inner).addEventListener('click', () => { if (a.facts.length < 2) return; i = (i + 1) % a.facts.length; swap(box, esc(a.facts[i])); $('#knewN', inner).textContent = `${i + 1} / ${a.facts.length}`; });
  } });
}
function openSongs() {
  const a = st.a, all = a.albums.flatMap((al) => al.tracks.map((t) => ({ t, al }))).sort((x, y) => y.t.plays - x.t.plays);
  openSheet({ title: `${all.length} ${pl.songs(all.length)}`, aside: 'чаще — выше', build(inner) {
    inner.innerHTML = `<div class="sheet-rows">${all.map(({ t, al }) => trackRow(t, { art: img(al.cover + '-s'), sub: `${al.clean} · ${t.plays ? `${t.plays} ${pl.times(t.plays)}` : 'ещё не слушал'}`, queued: qpos(t.id) })).join('')}</div>`;
    bindRows(inner, 'artist:' + a.slug);
    markNow();
  } });
}

/* ================= the album «Конверт» ================= */
const AL = { open: false, al: null, art: null, entry: null, cs: { x: 0, y: 0, s: 1 }, d: 0, over: false, t: 0 };
AL.hinge = new Hinge(el.leaf, $('#leafShade'));
AL.hinge.at = function (h) { this.s.alive = false; this.s.v = this.s.to = h; this.draw(h); };
AL.flyS = new Spring(0, FLIGHT, (p) => AL.onFly && AL.onFly(p));
AL.backS = new Spring(0, SPR(0.42), (p) => drawBack(p));
AL.pullS = new Spring(0, SPR(0.32), (d) => drawPull(d));
AL.scrollS = new Spring(0, SPR(0.45), (v) => { el.alScroll.scrollTop = v; });
const curPage = () => (st.page === 'library' ? el.pgL : el.pgA);
function drawBack(p) {
  const pg = curPage();
  pg.style.transform = p > 0.001 ? `scale(${(1 - 0.04 * p).toFixed(4)})` : '';
  pg.style.opacity = p > 0.001 ? (1 - 0.5 * p).toFixed(3) : '';
  el.alBg.style.opacity = p.toFixed(3);
}
function writeCover(x, y, s, o = 1, r = 10) {
  AL.cs = { x, y, s };
  el.slot.style.transform = Math.abs(x) + Math.abs(y) + Math.abs(1 - s) > 0.01 ? tf(x, y, s) : '';
  el.slot.style.borderRadius = r.toFixed(2) + 'px';
  el.slot.style.opacity = o < 0.999 ? o.toFixed(3) : '';
}
const slotRect = () => ({ x: (M.W - M.C) / 2, y: M.ct, w: M.C, h: M.C });
const leafKids = () => [...el.leafIn.children];
/** a rect measured as it will be once the page behind has come back to scale 1 */
function restRect(node) {
  const pg = curPage(), t = pg.style.transform; pg.style.transform = '';
  const b = box(node); pg.style.transform = t; return b;
}
function setCover(al) {
  el.slotLo.src = img(al.cover + '-s'); el.slotHi.style.opacity = 0; el.slotHi.src = img(al.cover);
  (el.slotHi.decode ? el.slotHi.decode() : Promise.resolve()).catch(() => {}).then(() => { el.slotHi.style.opacity = ''; });
}
function fillAlbum(al, art) {
  AL.al = al; AL.art = art;
  el.album.style.setProperty('--tint', al.tint || '#888');
  setCover(al);
  const f = $('img', el.alBg); f.src = img(al.cover + '-f');
  $('#alHeadImg').src = img(al.cover + '-s'); $('#alHeadT').textContent = al.clean; $('#alHeadA').textContent = art.name;
  fillLeaf(al, art);
}
function fillLeaf(al, art) {
  const loading = st.scene === 'loading';
  const unheard = al.tracks.filter((t) => !t.plays).length, hot = hotOf(al);
  const mins = Math.round(al.tracks.reduce((s, t) => s + t.d, 0) / 60), discs = new Set(al.tracks.map((t) => t.disc)).size > 1;
  let rows = '', disc = 0;
  al.tracks.forEach((t, i) => {
    if (discs && t.disc !== disc) { disc = t.disc; rows += `<span class="cap disc">Диск ${disc}</span>`; }
    rows += trackRow(t, { no: t.no || i + 1, hot: hot && t.id === hot.id, isNew: !t.plays, sub: t.feat.length ? 'feat. ' + t.feat.join(', ') : '', queued: qpos(t.id) });
  });
  const cr = [];
  if (al.producers.length) cr.push(['Продюсеры', al.producers.map((n) => `<button class="link" data-prod="${esc(n)}"><span>${esc(n)}</span></button>`).join('')]);
  if (al.label) cr.push(['Лейбл', `<span>${esc(al.label)}</span>`]);
  if (al.year) cr.push(['Год', `<span class="num">${al.year}</span>`]);
  const others = art.albums.filter((x) => x.id !== al.id);
  el.leafIn.innerHTML = `<h1 class="al-title${al.clean.length > 30 ? ' long' : ''}" id="alTitle">${esc(al.clean)}${al.ed ? `<span class="badge">${esc(al.ed)}</span>` : ''}</h1>
    <button class="link al-by" id="alBy"><span>${esc(art.name)}</span>${icon('ChevronRight')}</button>
    <p class="al-meta">${[al.year, al.genre, `${al.n} ${pl.songs(al.n)}`, `${mins} мин`].filter(Boolean).join(' · ')}</p>
    <div class="al-listen"><button class="pill big solid mb" id="alPlay"></button><p class="lamp">${esc(lamp(al))}</p></div>
    ${st.scene === 'offline' ? '<p class="al-note"><i class="spin" style="display:none"></i>Нет сети — играют песни, сохранённые на телефоне</p>' : ''}
    <div class="al-sh"><h2>Песни</h2>${unheard ? `<span><i></i>${unheard} ещё не слышал</span>` : '<span>все услышаны</span>'}</div>
    ${loading ? `<div class="sk-rows" id="alRows">${Array.from({ length: Math.min(8, al.n) }, (_, i) => `<i class="sk" style="height:16px;width:${60 + ((i * 37) % 35)}%"></i>`).join('')}</div>` : `<div class="al-rows" id="alRows">${rows}</div>`}
    ${cr.length ? `<dl class="roll al-credits">${cr.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}
    ${others.length ? `<section class="more"><h2>Ещё у ${esc(art.name)}</h2><div id="alStack"></div><p class="more-hint">Веди пальцем по стопке и отпусти на нужной</p></section>` : ''}`;
  setPlayButton($('#alPlay'), isPlaying('album:' + al.id));
  $('#alPlay').addEventListener('click', () => { hap('Press'); playContext('album:' + al.id); });
  $('#alBy').addEventListener('click', toArtistFromAlbum);
  for (const b of $$('[data-prod]', el.leafIn)) b.addEventListener('click', () => toast(`Продюсер ${b.dataset.prod}: его песни в библиотеке — позже`));
  if (!loading) bindRows($('#alRows'), 'album:' + al.id);
  if (others.length) coverStack($('#alStack'), others.map((x) => ({ img: img(x.cover + '-s'), name: x.clean, year: x.year })), { size: M.W > 400 ? 96 : 84, onPick: (i, card) => swapAlbum(others[i], card) });
  markNow();
  if (loading) setTimeout(() => { if (AL.open && AL.al === al) { st.scene = 'ready'; $('#rvState').value = 'ready'; const r = $('#alRows'); r.outerHTML = `<div class="al-rows" id="alRows">${rows}</div>`; bindRows($('#alRows'), 'album:' + al.id); cascade($$('#alRows .trow')); markNow(); } }, 1100);
}
let alReveal = null;
function openAlbum(al, art, entry = { kind: 'none' }) {
  if (sh.def) closeSheet();
  if (mn.open) closeMorph(true);
  if (AL.open) { if (AL.al.id === al.id) return; closeAlbum(0, { quiet: true }); }
  AL.open = true; AL.entry = entry; AL.d = 0; clearTimeout(AL.t);
  // shown before it is filled: the stack and the rows measure themselves (a hidden layer is 0 px wide)
  el.album.hidden = false; el.album.style.opacity = ''; el.slot.style.zIndex = '';
  fillAlbum(al, art);
  AL.scrollS.alive = false; el.alScroll.scrollTop = 0; AL.drag.reset(); $('.sc-in', el.alScroll).style.transform = '';
  alReveal.reset(); setSB();
  if (entry.el) entry.el.closest('.al')?.classList.remove('press');
  if (still() || entry.kind === 'none') {
    writeCover(0, 0, 1); AL.hinge.at(1); AL.backS.snap(1);
    if (!still()) el.album.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    return;
  }
  if (entry.kind === 'img') {
    // the picture that was touched is the one that travels: no copy, no blank frame (its small image is already decoded)
    const src = box(entry.el), f = fromRect(slotRect(), src);
    entry.el.style.visibility = 'hidden';
    AL.onFly = (p) => writeCover(lerp(f.x, 0, p), lerp(f.y, 0, p), lerp(f.s, 1, p), 1, lerp(8 / f.s, 10, p));
    AL.flyS.done = null; AL.flyS.snap(0); AL.flyS.set(1);
    AL.backS.snap(0); AL.backS.set(1);
    AL.hinge.at(0);
    AL.t = setTimeout(() => { AL.hinge.open(); cascade(leafKids(), { delay: 40 }); }, 260);
  } else {
    // a word: it flies into the title; the layer comes out of the blur, the cover sharpens in its slot, the leaf is already open
    writeCover(0, 0, 1); AL.hinge.at(1);
    // the word's landing place is measured at rest, before the leaf starts rising under it
    const t = $('#alTitle'), tb = box(t); t.style.opacity = 0;
    AL.backS.snap(0); AL.backS.set(1);
    const c = M.C * 0.02;
    el.slot.animate([{ transform: `translate(${c}px,${c}px) scale(.96)`, filter: 'blur(8px)', opacity: 0.4 }, { transform: 'none', filter: 'blur(0)', opacity: 1 }], { duration: 460, easing: 'cubic-bezier(.22,.9,.3,1)' });
    el.alScroll.animate([{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 60, easing: 'cubic-bezier(.22,.9,.3,1)', fill: 'backwards' });
    wordFlight(entry.el, t, () => { t.style.opacity = ''; }, tb);
    cascade(leafKids().slice(1), { delay: 140 });
  }
}
function closeAlbum(vel = 0, opt = {}) {
  if (!AL.open) return;
  AL.open = false; clearTimeout(AL.t);
  el.alHead.classList.remove('on'); el.album.classList.remove('headed'); el.alClose.classList.remove('lg', 'deep');
  const e = AL.entry;
  const done = () => {
    el.album.hidden = true; el.album.style.opacity = '';
    if (e?.el) e.el.style.visibility = '';
    $('.sc-in', el.alScroll).style.transform = ''; writeCover(0, 0, 1); AL.hinge.at(1); AL.d = 0; drawBack(0); setSB();
  };
  if (opt.quiet || still()) { AL.flyS.alive = false; AL.backS.alive = false; done(); return; }
  if (e?.kind === 'img' && onStage(e.el)) {
    const target = restRect(e.el), f = fromRect(slotRect(), target), c0 = { ...AL.cs };
    AL.hinge.fold();
    AL.onFly = (p) => writeCover(lerp(c0.x, f.x, p), lerp(c0.y, f.y, p), lerp(c0.s, f.s, p), 1, lerp(10, 8 / f.s, p));
    AL.flyS.snap(0); AL.flyS.done = done; AL.flyS.set(1, Math.max(0, vel) / 900);
    AL.backS.set(0);
  } else if (e?.kind === 'word' && onStage(e.el)) {
    wordFlight($('#alTitle'), e.el, null, restRect(e.el));   // where the word lies once the page is back at scale 1
    AL.backS.set(0);
    el.album.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.02)' }], { duration: 260, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).onfinish = (ev) => { done(); ev.target.cancel(); };
  } else {
    AL.backS.set(0);
    el.album.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' }).onfinish = (ev) => { done(); ev.target.cancel(); };
  }
  setSB(true);
}
/* PullToDismiss: at the top of the leaf a downward drag folds it back under the finger; the cover follows
   and shrinks; past the line a Threshold, released — the flick's projection decides */
function drawPull(d) {
  AL.d = d;
  const q = clamp(d / (M.H * 0.5)), s = 1 - 0.22 * q, y = d * 0.6, x = (M.C * (1 - s)) / 2;
  writeCover(x, y, s);
  const shift = y - M.C * (1 - s);
  $('.sc-in', el.alScroll).style.transform = d > 0.1 ? `translateY(${shift.toFixed(1)}px)` : '';
  AL.hinge.at(1 - 0.62 * q);
  drawBack(1 - 0.85 * q);
  const over = d > M.H * 0.2;
  if (over !== AL.over) { AL.over = over; hap(over ? 'Threshold' : 'ThresholdOff'); }
}
function dimCover() {
  if (AL.flyS.alive || AL.d > 0.5 || !AL.open) return;
  const k = clamp(el.alScroll.scrollTop / (M.C * 0.9)), s = 1 - 0.06 * k;
  writeCover((M.C * (1 - s)) / 2, 0, s, 1 - 0.6 * k);
}
/* «Ещё у артиста»: the picked cover flies from the stack into the slot, the colour flows, the text gives way */
function swapAlbum(al, card) {
  const art = AL.art, src = box(card), f = fromRect(slotRect(), src);
  AL.al = al;
  const old = $('img', el.alBg), nf = old.cloneNode(); nf.src = img(al.cover + '-f'); nf.classList.add('old'); el.alBg.insertBefore(nf, old.nextSibling);
  requestAnimationFrame(() => { nf.classList.remove('old'); old.classList.add('old'); setTimeout(() => old.remove(), 640); });
  el.album.style.setProperty('--tint', al.tint || '#888');
  el.slot.style.zIndex = 3; setCover(al);
  AL.onFly = (p) => writeCover(lerp(f.x, 0, p), lerp(f.y, 0, p), lerp(f.s, 1, p), 1, lerp(8 / f.s, 10, p));
  AL.flyS.snap(0); AL.flyS.done = () => { el.slot.style.zIndex = ''; }; AL.flyS.set(1);
  AL.scrollS.alive = false; AL.scrollS.v = el.alScroll.scrollTop; AL.scrollS.set(0);
  $('#alHeadImg').src = img(al.cover + '-s'); $('#alHeadT').textContent = al.clean;
  const cover = st.page === 'artist' && st.a.slug === art.slug ? $$('#axis .cv')[art.albums.indexOf(al)] : null;
  if (AL.entry?.el) AL.entry.el.style.visibility = '';
  AL.entry = cover ? { kind: 'img', el: cover } : { kind: 'none' };
  if (cover) cover.style.visibility = 'hidden';
  if (still()) { fillLeaf(al, art); return; }
  el.leafIn.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 140, easing: 'ease-in', fill: 'forwards' }).onfinish = (ev) => { fillLeaf(al, art); ev.target.cancel(); cascade(leafKids()); };
}
function toArtistFromAlbum() {
  const art = AL.art, link = $('#alBy');
  if (st.page === 'artist' && st.a.slug === art.slug) { closeAlbum(); return; }
  openArtist(art.slug, { kind: 'word', el: link });
  closeAlbum(0, { quiet: true });
}

/* ---------------- SourceFlight: a word becomes the word ---------------- */
/** toRect: the target's rect at rest, when the caller has to measure it before its own motion starts */
function wordFlight(fromEl, toEl, onLand, toRect = null) {
  if (still() || !onStage(fromEl)) { onLand && onLand(); return; }
  const a = box(fromEl), b = toRect || box(toEl), cs = getComputedStyle(fromEl), ts = getComputedStyle(toEl);
  const text = (fromEl.querySelector('span')?.textContent || fromEl.textContent).trim();
  const g = document.createElement('div'); g.className = 'flyer word';
  g.style.cssText = `font:${ts.fontWeight} ${cs.fontSize}/1.1 ${ts.fontFamily};letter-spacing:${cs.letterSpacing};color:${ts.color === 'rgba(0, 0, 0, 0)' ? cs.color : ts.color}`;
  if (toEl.tagName === 'IMG') { g.style.fontWeight = '700'; g.style.color = '#fff'; }
  g.textContent = text; phone.append(g);
  const h0 = g.offsetHeight, w0 = g.offsetWidth, x0 = a.x, y0 = a.y + (a.h - h0) / 2;
  if (toEl.tagName === 'IMG') {
    // the name becomes the artist's logo: grown to the logo's height, it dissolves into it on the way in
    const k = Math.min((b.h * 0.92) / h0, b.w / w0), x1 = b.x, y1 = b.y + (b.h - h0 * k) / 2;
    toEl.style.transition = 'opacity .26s var(--std)';
    g.animate([{ transform: tf(x0, y0, 1), opacity: 1 }, { transform: tf(x1, y1, k), opacity: 1, offset: 0.55 }, { transform: tf(x1, y1, k), opacity: 0 }],
      { duration: 520, easing: 'cubic-bezier(.3,.8,.2,1)', fill: 'forwards' }).onfinish = () => g.remove();
    setTimeout(() => { onLand && onLand(); setTimeout(() => { toEl.style.transition = ''; }, 300); }, 150);
    return;
  }
  const k = parseFloat(ts.fontSize) / parseFloat(cs.fontSize) || 1;
  const x1 = b.x, y1 = b.y + Math.max(0, (parseFloat(ts.lineHeight) || h0 * k) - h0 * k) / 2;
  // the copy lands exactly on the word and is swapped for it in one frame: no fade, so no dim gap
  g.animate([{ transform: tf(x0, y0, 1) }, { transform: tf(x1, y1, k) }], { duration: 460, easing: 'cubic-bezier(.3,.8,.2,1)', fill: 'forwards' })
    .onfinish = () => { onLand && onLand(); requestAnimationFrame(() => g.remove()); };
}

/* ---------------- the artist: entries ---------------- */
function openArtist(slug, entry = null, { back = false } = {}) {
  const from = curPage(), same = from === el.pgA;
  if (sh.def) closeSheet();
  if (mn.open) closeMorph(true);
  st.slug = slug; st.a = artist(slug); $('#rvArtist').value = slug;
  renderArtist(); el.arScroll.scrollTop = 0; arDrag.reset(); arReveal.reset();
  st.page = 'artist'; setTab('library'); setSB();
  if (same) { if (!still()) el.arIn.animate([{ opacity: 0, filter: 'blur(8px)', transform: 'scale(1.02)' }, { opacity: 1, filter: 'blur(0)', transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.22,.9,.3,1)' }); return; }
  if (entry?.kind === 'img' && !still() && onStage(entry.el)) photoFlight(entry.el, from);
  else {
    // the name is measured before the page comes out of the blur (that entry scales it)
    el.pgA.hidden = false;
    const n = $('#arName'), nb = entry?.kind === 'word' && !still() ? box(n) : null;
    pageFocus(from, el.pgA, back);
    if (nb) { n.style.opacity = 0; wordFlight(entry.el, n, () => { n.style.opacity = ''; }, nb); }
  }
}
/* a photo becomes the frame: the tile's circle grows into the photo's own square; the rest of the page gathers out of the blur */
function photoFlight(srcEl, from) {
  const src = box(srcEl), size = Math.max(M.W, M.fh), target = { x: (M.W - size) / 2, y: 0 };
  const fl = document.createElement('div'); fl.className = 'flyer img'; fl.style.cssText = `width:${size}px;height:${size}px;z-index:21`;
  // the same dimming as the frame's own light photo, or it would darken with a jump on landing
  fl.innerHTML = `<img src="${img(st.a.slug + '-ph-s')}" alt=""${st.a.light ? ' style="filter:brightness(.72)"' : ''}>`; el.stage.append(fl);
  const frame = $('#frame'); frame.style.opacity = 0;
  srcEl.style.visibility = 'hidden';
  el.pgA.hidden = false; el.pgA.style.zIndex = 2; from.style.zIndex = 1;
  el.pgA.animate([{ opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 360, delay: 140, easing: 'cubic-bezier(.22,.9,.3,1)', fill: 'backwards' });
  from.animate([{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'scale(.965)', filter: 'blur(8px)' }], { duration: 300, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
    .onfinish = (ev) => { from.hidden = true; from.style.zIndex = ''; ev.target.cancel(); srcEl.style.visibility = ''; };
  const s = new Spring(0, FLIGHT, (p) => { fl.style.transform = tf(lerp(src.x, target.x, p), lerp(src.y, target.y, p), lerp(src.w / size, 1, p)); fl.style.borderRadius = lerp(size / 2, 0, p).toFixed(1) + 'px'; });
  s.done = () => { frame.style.opacity = ''; fl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).onfinish = () => fl.remove(); el.pgA.style.zIndex = ''; };
  s.set(1);
}
function goLibrary(back = true) {
  if (st.page === 'library') return;
  if (AL.open) closeAlbum(0, { quiet: true });
  const from = curPage(); st.page = 'library'; renderLibrary(); setTab('library'); setSB();
  pageFocus(from, el.pgL, back);
}

/* ---------------- the stubs of entries ---------------- */
let libDrag = null;
function renderLibrary() {
  const arts = DATA.artists.map((r) => artist(r.slug));
  const tiles = st.libTab === 'artists'
    ? arts.map((a) => `<div class="tile" data-s="${a.slug}"><button class="ph" aria-label="${esc(a.name)}"><img src="${img(a.slug + '-ph-s')}" alt=""></button><button class="nm">${esc(a.name)}</button><small>${a.total} ${pl.songs(a.total)}</small></div>`).join('')
    : arts.flatMap((a) => a.albums.map((al) => ({ a, al }))).sort((x, y) => y.al.plays - x.al.plays).slice(0, 12)
      .map(({ a, al }) => `<div class="tile" data-s="${a.slug}" data-id="${al.id}"><button class="ph sq" aria-label="${esc(al.clean)}"><img src="${img(al.cover + '-s')}" alt=""></button><button class="nm">${esc(al.clean)}</button><small>${esc(a.name)} · ${al.year || ''}</small></div>`).join('');
  el.libIn.innerHTML = `<div class="lib-in"><h1 class="lib-h">Библиотека</h1>
    <div class="seg"><button data-t="artists" aria-pressed="${st.libTab === 'artists'}">Артисты</button><button data-t="albums" aria-pressed="${st.libTab === 'albums'}">Альбомы</button></div>
    <p class="lib-note">Заглушка для входов. Фото или обложка — вход «из картинки», имя или название — «из слова».</p>
    <div class="grid">${tiles}</div></div>`;
  for (const b of $$('.seg button', el.libIn)) b.addEventListener('click', () => { if (st.libTab === b.dataset.t) return; st.libTab = b.dataset.t; renderLibrary(); cascade($$('.tile', el.libIn), { by: 8 }); });
  for (const t of $$('.tile', el.libIn)) {
    const a = artist(t.dataset.s), al = t.dataset.id ? a.albums.find((x) => x.id === t.dataset.id) : null;
    $('.ph', t).addEventListener('click', (e) => (al ? openAlbum(al, a, { kind: 'img', el: e.currentTarget }) : openArtist(a.slug, { kind: 'img', el: $('.ph', t) })));
    $('.nm', t).addEventListener('click', (e) => (al ? openAlbum(al, a, { kind: 'word', el: e.currentTarget }) : openArtist(a.slug, { kind: 'word', el: e.currentTarget })));
  }
}
const PS = {};
PS.y = new Spring(1, SPR(0.4), (v) => { el.ps.style.transform = `translateY(${(v * M.H).toFixed(1)}px)`; });
function openPlayer() {
  const n = st.now; if (!n) return;
  $('#psCover').src = img(n.al.cover); $('#psField').src = img(n.al.cover + '-f'); $('#psTitle').textContent = n.t.t;
  $('#psLinks').innerHTML = `<button class="link" id="psArtist"><span>${esc(n.art.name)}</span>${icon('ChevronRight')}</button><button class="link" id="psAlbum"><span>${esc(n.al.clean)}</span>${n.al.year ? `<span class="num" style="text-decoration:none;margin-left:6px;opacity:.7">· ${n.al.year}</span>` : ''}${icon('ChevronRight')}</button>`;
  $('#psArtist').addEventListener('click', (e) => { const l = e.currentTarget; openArtist(n.art.slug, { kind: 'word', el: l }); closePlayer(); });
  $('#psAlbum').addEventListener('click', (e) => { const l = e.currentTarget; openAlbum(n.al, n.art, { kind: 'word', el: l }); closePlayer(); });
  el.ps.classList.add('live'); PS.y.done = null; PS.y.set(0); setSB();
}
function closePlayer() { PS.y.done = () => { el.ps.classList.remove('live'); setSB(); }; PS.y.set(1); setSB(true); }

/* ---------------- playing, the queue, the mini player ---------------- */
const qpos = (id) => st.queue.findIndex((q) => String(q.t.id) === String(id)) + 1;
function isPlaying(ctx) { return st.playing && st.ctx === ctx; }
function contextTracks(ctx) {
  const [kind, key] = ctx.split(':');
  if (kind === 'album') { const hit = findAlbum(key); return hit ? hit.al.tracks.map((t) => ({ t, al: hit.al, art: hit.art })) : []; }
  const a = artist(key.split(':')[0]);
  const all = a.albums.flatMap((al) => al.tracks.map((t) => ({ t, al, art: a })));
  // «Поток» of the mock: a fixed shuffle (ids are UUID strings, so a small string hash)
  const mix = (id) => { let h = 7; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 9973; return h; };
  return kind === 'flow' ? all.sort((x, y) => mix(x.t.id) - mix(y.t.id)) : all.sort((x, y) => y.t.plays - x.t.plays);
}
function findAlbum(id) { const slug = id.split(':')[0], a = artist(slug), al = a.albums.find((x) => x.id === id); return al ? { al, art: a } : null; }
function playContext(ctx) {
  if (st.ctx === ctx && st.now) { st.playing = !st.playing; markNow(); return; }
  const first = contextTracks(ctx)[0]; if (!first) return;
  play(first, ctx);
}
function play(hit, ctx) { st.now = hit; st.ctx = ctx; st.playing = true; markNow(); }
function markNow() {
  const id = st.now?.t.id;
  for (const r of $$('.trow')) { const on = id != null && r.dataset.id === String(id); r.classList.toggle('now', on); r.classList.toggle('playing', on && st.playing); }
  const a = st.a;
  if ($('#arPlay') && a) setPlayButton($('#arPlay'), isPlaying('artist:' + a.slug));
  if ($('#alPlay') && AL.al) setPlayButton($('#alPlay'), isPlaying('album:' + AL.al.id));
  $('#arHeadPlay').innerHTML = a && isPlaying('artist:' + a.slug) ? PAUSE : PLAY;
  $('#alHeadPlay').innerHTML = AL.al && isPlaying('album:' + AL.al.id) ? PAUSE : PLAY;
  renderMini();
}
function renderMini() {
  const n = st.now;
  el.mini.hidden = !n;
  if (!n) return;
  if (el.miniArt.dataset.k !== n.al.cover) { el.miniArt.dataset.k = n.al.cover; el.miniArt.innerHTML = `<img src="${img(n.al.cover + '-s')}" alt="">`; }
  el.miniTitle.textContent = n.t.t; el.miniArtist.textContent = n.art.name;
  el.miniPlay.innerHTML = st.playing ? PAUSE : PLAY; el.miniPlay.setAttribute('aria-label', st.playing ? 'Пауза' : 'Слушать');
}
function bindRows(root, ctx) {
  root.addEventListener('click', (e) => {
    const row = e.target.closest('.trow'); if (!row) return;
    const hit = findTrack(row.dataset.id); if (!hit) return;
    if (e.target.closest('.qn')) { toggleQueue(hit, row); return; }
    if (st.now?.t.id === hit.t.id) { st.playing = !st.playing; markNow(); return; }
    play(hit, ctx);
  });
}
let qTimer = 0;
function toggleQueue(hit, row) {
  const i = st.queue.findIndex((q) => q.t.id === hit.t.id);
  if (i >= 0) { st.queue.splice(i, 1); markQueue(); return; }
  st.queue.push(hit);
  const land = () => {
    hap('Confirm'); el.miniNext.classList.remove('swell'); void el.miniNext.offsetWidth; el.miniNext.classList.add('swell');
    el.qchip.innerHTML = `${icon('QueueNext')}<span>Далее${st.queue.length > 1 ? ` · ${st.queue.length}-й` : ''}:</span><b>${esc(hit.t.t)}</b>`;
    el.qchip.classList.add('on'); clearTimeout(qTimer); qTimer = setTimeout(() => el.qchip.classList.remove('on'), 2600);
    markQueue();
  };
  flyWord($('.tt b', row), hit.t.t, el.miniNext, { onLand: land });
}
function markQueue() {
  for (const r of $$('.trow')) {
    const n = qpos(r.dataset.id), b = $('.qn', r); if (!b) continue;
    b.classList.toggle('on', !!n); $('i', b).textContent = n || ''; b.setAttribute('aria-label', n ? `В очереди ${n}-й — убрать` : 'Играть следующим');
  }
}
el.miniPlay.addEventListener('click', (e) => { e.stopPropagation(); hap('Press'); st.playing = !st.playing; markNow(); });
el.miniNext.addEventListener('click', (e) => {
  e.stopPropagation();
  const next = st.queue.shift() || (() => { const list = contextTracks(st.ctx || 'artist:' + st.a.slug), i = list.findIndex((x) => x.t.id === st.now?.t.id); return list[(i + 1) % list.length]; })();
  if (next) { st.now = next; st.playing = true; markQueue(); markNow(); }
});
el.mini.addEventListener('click', openPlayer);

/* ---------------- shell: tabs, status bar, states ---------------- */
function setTab(t) { for (const b of $$('.tab', el.tabbar)) b.setAttribute('aria-current', b.dataset.t === t ? 'page' : 'false'); }
for (const b of $$('.tab', el.tabbar)) b.addEventListener('click', () => {
  if (b.dataset.t === 'library') { if (AL.open) closeAlbum(); if (st.page !== 'library') goLibrary(false); return; }
  toast(`«${b.textContent.trim()}» — в своём макете; здесь только артист и альбом`);
});
function setSB(leaving = false) {
  const dark = phone.dataset.theme === 'dark';
  let light;
  if ((el.ps.classList.contains('live') && PS.y.to === 0) || (AL.open && !leaving)) light = dark;
  else if (st.page === 'artist' && !arReveal?.on) light = true;
  else light = dark;
  phone.dataset.sb = light ? 'light' : '';
}
function setScene(s) {
  st.scene = s; $('#rvState').value = s;
  renderArtist(); el.arScroll.scrollTop = 0; arReveal.reset();
  if (s === 'loading') setTimeout(() => { if (st.scene !== 'loading') return; st.scene = 'ready'; $('#rvState').value = 'ready'; renderArtist(); cascade($$('.ar-body > *', el.arIn), { by: 8 }); }, 1300);
}

/* ---------------- sizes ---------------- */
function fit() {
  const narrow = innerWidth <= 760;
  let [W, H] = $('#rvSize').value.split(',').map(Number);
  if (narrow) { W = innerWidth; H = innerHeight; zoom = 1; } else zoom = Math.min(1, (innerHeight - 76) / H);
  phone.style.setProperty('--W', W + 'px'); phone.style.setProperty('--H', H + 'px');
  const size = W <= 380 ? '360' : W >= 440 ? '448' : '412';
  phone.dataset.size = size;
  phone.style.transform = zoom < 1 ? `scale(${zoom})` : '';
  phone.style.marginBottom = zoom < 1 ? H * (zoom - 1) + 'px' : '';
  const ap = size === '360' ? 12 : 16;
  M = { W, H, P: size === '360' ? 16 : size === '448' ? 24 : 20, ap, S: Math.floor((W - 2 * ap - 40) / 2), C: W - 32, ct: 88, fh: Math.round(Math.min(1.12 * W, 0.56 * H)),
    nfs: size === '360' ? 38 : size === '448' ? 48 : 44, tfs: size === '360' ? 26 : size === '448' ? 30 : 28 };
  for (const [k, v] of Object.entries({ '--fh': M.fh, '--C': M.C, '--ct': M.ct, '--nfs': M.nfs, '--tfs': M.tfs })) phone.style.setProperty(k, v + 'px');
  el.slot.style.left = (W - M.C) / 2 + 'px'; el.slot.style.top = M.ct + 'px';
  PS.y.snap(PS.y.v);
  if (st.a) layoutAxis();
  if (AL.open) { writeCover(0, 0, 1); const s = $('#alStack'); if (s) fillLeaf(AL.al, AL.art); }
}

/* ---------------- the review panel ---------------- */
$('#rvTheme').addEventListener('change', (e) => { phone.dataset.theme = e.target.value; setSB(); });
$('#rvSize').addEventListener('change', fit);
$('#rvArtist').addEventListener('change', (e) => { if (AL.open) closeAlbum(0, { quiet: true }); openArtist(e.target.value); });
$('#rvState').addEventListener('change', (e) => { if (AL.open) closeAlbum(0, { quiet: true }); if (st.page !== 'artist') openArtist(st.slug); setScene(e.target.value); });
$('#rvHeard').addEventListener('change', (e) => { st.heard = e.target.value; cache = {}; st.a = artist(st.slug); if (AL.open) closeAlbum(0, { quiet: true }); renderArtist(); if (st.page === 'library') renderLibrary(); if (st.now) st.now = findTrack(st.now.t.id) || st.now; markNow(); });
$('#rvMotion').addEventListener('change', (e) => phone.classList.toggle('still', !e.target.checked));
$('#rvOpen').addEventListener('click', async () => {
  if (AL.open) { closeAlbum(); return; }
  if (st.page !== 'artist') { openArtist(st.slug); await wait(450); }
  const a = st.a, i = a.albums.reduce((b, x, j) => (x.plays > a.albums[b].plays ? j : b), 0), cv = $$('#axis .cv')[i];
  if (!cv) return;
  if (!onStage(cv)) { el.arScroll.scrollTop = Math.max(0, box(cv).y - box(el.arScroll).y + el.arScroll.scrollTop - 180); await wait(60); }
  openAlbum(a.albums[i], a, { kind: 'img', el: cv });
});
$('#rvLib').addEventListener('click', () => { if (PS.y.to === 0) closePlayer(); goLibrary(false); });
$('#rvPlayer').addEventListener('click', () => { if (PS.y.to === 0) closePlayer(); else openPlayer(); });
el.arBack.addEventListener('click', () => goLibrary(true));
$('#arHeadPlay').addEventListener('click', () => { hap('Press'); playContext('artist:' + st.a.slug); });
$('#alHeadPlay').addEventListener('click', () => { hap('Press'); playContext('album:' + AL.al.id); });
el.alClose.addEventListener('click', () => closeAlbum());
$('#psClose').addEventListener('click', closePlayer);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (mn.open) closeMorph(); else if (sh.def) closeSheet(); else if (PS.y.to === 0) closePlayer(); else if (AL.open) closeAlbum(); else if (st.page === 'artist') goLibrary(true);
});
addEventListener('resize', fit);

async function start() {
  // the images arrive inlined; the DOM gets short blob URLs (a list of 189 rows must not carry 189 copies)
  await Promise.all(Object.entries(DATA.img).map(async ([k, uri]) => { IMGURL[k] = URL.createObjectURL(await (await fetch(uri)).blob()); }));
  paintIcons();
  arDrag = dragScroll(el.arScroll, { stretch: true });
  AL.drag = dragScroll(el.alScroll, { stretch: true, onPull: {
    start() { AL.flyS.alive = false; AL.pullS.alive = false; AL.over = false; },
    move(d) { drawPull(d); },
    end(d, v) { if (d + project(v, 0.99) > M.H * 0.2 || v > 900) closeAlbum(v); else { AL.pullS.v = d; AL.pullS.set(0, v); AL.pullS.done = () => { AL.d = 0; drawBack(1); }; } },
  } });
  libDrag = dragScroll(el.libScroll, { stretch: true });
  arReveal = revealOnScroll(el.arScroll, () => M.fh - 96, (on) => { el.arHead.classList.toggle('on', on); el.pgA.classList.toggle('headed', on); el.arBack.classList.toggle('on-art', !on); el.arBack.classList.toggle('deep', on); setSB(); });
  alReveal = revealOnScroll(el.alScroll, () => M.ct + M.C + 10 + 26 - 92, (on) => { el.alHead.classList.toggle('on', on); el.album.classList.toggle('headed', on); el.alClose.classList.toggle('lg', on); el.alClose.classList.toggle('deep', on); });
  el.alScroll.addEventListener('scroll', dimCover, { passive: true });
  fit();
  st.a = artist(st.slug);
  renderArtist(); renderLibrary(); el.pgL.hidden = true;
  const top = contextTracks('artist:' + st.slug)[0]; st.now = top; st.ctx = 'artist:' + st.slug; st.playing = false;
  markNow(); setSB();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
}
start();
