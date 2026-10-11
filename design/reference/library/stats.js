(() => {
const MX = window.MX, ST = window.STATS;
if (!MX || !ST) return;
const { $, $$, esc, plural, icon, flagHtml, stage, toast, at, SPRING, EASE, reduce } = MX;
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const ru = iso => { const [y, m, d] = iso.split('-').map(Number); return d + ' ' + MON[m - 1]; };
const num = n => Math.round(n).toLocaleString('ru-RU');
const dec1 = x => String(Math.round(x * 10) / 10).replace('.', ',');
ST.ach.forEach(a => { if (a.ctx?.text) a.ctx.text = a.ctx.text.replace(/\d{4}-\d{2}-\d{2}/g, ru); });

/* ── words ─────────────────────────────────────────────────────────────── */
const H = ST.total_ms / 3.6e6, TOP = ST.top_artists[0].name;
const times = x => { const r = Math.round(x * 2) / 2; if (r < 1) return 'почти целиком'; return r % 1 ? Math.floor(r) + ',5 раза' : r + ' ' + plural(r, 'раз', 'раза', 'раз'); };
const nx = (n, a, b, c) => num(n) + ' ' + plural(Math.round(n), a, b, c);
const mln = n => n >= 1e6 ? dec1(n / 1e6) + ' млн' : num(n);
const WALK = [['до Твери', 180], ['до Петербурга', 710], ['до Минска', 720], ['до Варшавы', 1260], ['до Берлина', 1820], ['до Парижа', 2850]];
const km = H * 5, walkTo = [...WALK].reverse().find(w => km > w[1]);
/* comparisons for the time: from space to dumplings; a few of them with a wink */
const PHRASES = [
  'Это как <b>долететь до Луны</b> ' + times(H / 76),
  'Можно было бы сварить <b>' + nx(H * 60 / 8, 'кастрюлю', 'кастрюли', 'кастрюль') + ' пельменей</b>. По восемь минут, с лавровым листом',
  '<b>«Bohemian Rhapsody»</b> ' + nx(H * 60 / 5.92, 'раз', 'раза', 'раз') + ' подряд. Is this the real life? Да, это твоя статистика',
  '<b>«Never Gonna Give You Up»</b> ' + nx(H * 60 / 3.55, 'раз', 'раза', 'раз') + ' подряд. Тебя бы зарикроллили на всю жизнь вперёд',
  '«4′33″» Джона Кейджа <b>' + nx(H * 60 / 4.55, 'раз', 'раза', 'раз') + '</b> подряд — и ни одной ноты',
  H < 264.4 ? 'Ещё <b>' + dec1(264.4 - H) + ' ч</b> — и ты перекроешь рекорд Рэнди Гарднера: 264 часа без сна. Он, правда, обходился без музыки'
            : 'Ты перекрыл рекорд Рэнди Гарднера: <b>264 часа</b> без сна. Только он не спал, а ты слушал',
  'Ленивец за это время прополз бы <b>' + num(H * .24) + ' км</b>. Медленно, но под хороший бит',
  'Это <b>' + nx(H / 1.5, 'пара', 'пары', 'пар') + '</b> по полтора часа. Целый семестр, только без сессии',
  '«Сапсан» успел бы сгонять <b>из Москвы в Петербург</b> ' + times(H / 3.75),
  'Хватило бы на <b>«Игру престолов»</b> целиком ' + times(H / 70) + ' — и на то, чтобы ещё раз разочароваться в финале',
  H < 350 ? 'Ещё <b>' + num(350 - H) + ' ч</b> — и это был бы испанский до B1. Но ' + esc(TOP) + ', видимо, важнее'
          : 'За это время можно было выучить <b>испанский до B1</b>. Но ' + esc(TOP) + ', видимо, важнее',
  '<b>«Stayin\' Alive»</b> ' + nx(H * 60 / 4.75, 'раз', 'раза', 'раз') + ' подряд. Под неё делают массаж сердца — так что ты, считай, спас целый город',
  'Toto пели: «It\'s gonna take a lot to drag me away from you». <b>' + num(H) + ' ' + plural(Math.round(H), 'час', 'часа', 'часов') + '</b> — да, тебя не оттащить',
  '<b>«bad guy»</b> Билли Айлиш ' + nx(H * 60 / 3.23, 'раз', 'раза', 'раз') + ' подряд. Duh',
  '«You only get one shot» — у тебя их было <b>' + num(ST.plays) + '</b>. Эминем бы не одобрил',
  'У Jay-Z «99 Problems», но <b>' + num(H) + ' ' + plural(Math.round(H), 'час', 'часа', 'часов') + ' музыки</b> — явно не одна из них',
  '<b>«The Final Countdown»</b> ' + nx(H * 60 / 5.17, 'раз', 'раза', 'раз') + ' подряд. Самый долгий обратный отсчёт в истории',
  '<b>«Hey Jude»</b> ' + nx(H * 60 / 7.18, 'раз', 'раза', 'раз') + ' подряд — и из них ' + nx(H * 60 / 7.18 * 4 / 60, 'час', 'часа', 'часов') + ' чистого «на-на-на»',
  'Твоё сердце за это время ударило около <b>' + mln(H * 60 * 70) + ' раз</b>. Надеемся, в ритм',
  'МКС облетела бы Землю <b>' + nx(H * 60 / 92, 'раз', 'раза', 'раз') + '</b>',
  walkTo ? 'Пешком ты прошёл бы <b>' + num(km) + ' км</b> — дальше, чем от Москвы ' + walkTo[0] : 'Пешком ты прошёл бы <b>' + num(km) + ' км</b>',
];
let ph = Math.floor(Math.random() * PHRASES.length);

const NOM = { 'Хип-хоп': 'хип-хоп', 'Поп': 'поп', 'Рок': 'рок', 'Электроника': 'электроника', 'Альтернатива': 'альтернатива', 'R&B и соул': 'R&B и соул', 'Саундтреки': 'саундтреки', 'Ню-метал': 'ню-метал' };
const DEC = { 1960: 'шестидесятых', 1970: 'семидесятых', 1980: 'восьмидесятых', 1990: 'девяностых', 2000: 'нулевых', 2010: 'десятых', 2020: 'двадцатых' };
const ORD = ['', '', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой', 'девятый', 'десятый', 'одиннадцатый', 'двенадцатый', 'тринадцатый', 'четырнадцатый', 'пятнадцатый', 'шестнадцатый', 'семнадцатый', 'восемнадцатый', 'девятнадцатый', 'двадцатый'];
const HOURW = ['полуночи', 'часа ночи', 'двух ночи', 'трёх ночи', 'четырёх утра', 'пяти утра', 'шести утра', 'семи утра', 'восьми утра', 'девяти утра', 'десяти утра', 'одиннадцати',
  'полудня', 'часа дня', 'двух', 'трёх', 'четырёх', 'пяти вечера', 'шести вечера', 'семи вечера', 'восьми вечера', 'девяти вечера', 'десяти вечера', 'одиннадцати вечера'];
const ADJ = { US: 'американские', GB: 'британские', CA: 'канадские', DE: 'немецкие', FR: 'французские', AU: 'австралийские', SE: 'шведские', RU: 'русские', IT: 'итальянские', NL: 'нидерландские', IE: 'ирландские', ES: 'испанские', NG: 'нигерийские', JM: 'ямайские', NZ: 'новозеландские', BE: 'бельгийские' };
function portrait() {
  const g = ST.listened.genres.filter(x => NOM[x[0]]), d = ST.listened.decades.slice(0, 2).map(x => +x[0]).sort();
  const s = [];
  s.push('Твоя музыка — это прежде всего <b>' + NOM[g[0][0]] + '</b> и <b>' + NOM[g[1][0]] + '</b>' + (d.length === 2 && DEC[d[0]] && DEC[d[1]] ? ' ' + DEC[d[0]] + ' и ' + DEC[d[1]] : '') + '.');
  const sh = ST.top_artists[0].share, n = Math.round(100 / sh);
  s.push('Чаще всех звучит <b>' + esc(ST.top_artists[0].name) + '</b> — ' + (sh >= 50 ? 'больше половины всей музыки' : n <= 20 && ORD[n] ? 'примерно каждый ' + ORD[n] + ' час твоей музыки' : dec1(sh) + ' % времени') + '.');
  const h = ST.hours.indexOf(Math.max(...ST.hours)), part = h <= 4 ? 'глубокой ночью' : h <= 10 ? 'утром' : h <= 16 ? 'днём' : h <= 21 ? 'вечером' : 'поздно вечером';
  const r = ST.days / ST.span;
  s.push('Слушаешь чаще всего ' + part + ', около ' + HOURW[h].replace(' вечера', '').replace(' утра', '').replace(' ночи', '') + (r > .85 ? ', и почти без перерывов: музыка была в ' + ST.days + ' днях из ' + ST.span : r > .5 ? ', через день или чаще' : '') + '.');
  const c = ST.listened.countries.filter(x => x[0] !== '—'), c1 = c[0], c2 = c[1];
  if (c1 && ADJ[c1[0]]) {
    const w = c1[1] >= 50 ? 'больше половины времени' : c1[1] >= 40 ? 'почти половина времени' : c1[1] >= 30 ? 'около трети времени' : Math.round(c1[1]) + ' % времени';
    s.push('Артисты у тебя в основном <b>' + ADJ[c1[0]] + '</b> — на них ' + (c1[1] >= 40 && c1[1] < 50 ? 'приходится ' : 'приходится ') + w + (c2 && ADJ[c2[0]] ? ', на втором месте ' + ADJ[c2[0]] : '') + '.');
  }
  return s.join(' ');
}

/* ── stickers: die-cut, ten of them, each its own shape and colour ─────── */
const ART = {
  repeat: ['#ff7a8a', '#d9356f', 'c', '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>'],
  marathon: ['#ffc15a', '#ff7a2f', 's', '<circle cx="12" cy="14" r="7"/><path d="M12 10.5v3.5l2.5 2"/><path d="M10 2.5h4"/><path d="M12 2.5v4"/><path d="M18.5 6.5l1.5-1.5"/>'],
  picky: ['#7fe3ff', '#3b7cf0', 'c', '<path d="M5.5 4.5l9.5 7.5-9.5 7.5z" fill="#fff"/><path d="M19 5v14"/>'],
  night: ['#a493ff', '#4c3fb8', 's', '<path d="M20 13.5A8 8 0 1 1 10.5 4a6.3 6.3 0 0 0 9.5 9.5z"/><path d="M17 3v3M15.5 4.5h3"/>'],
  whole: ['#f6cf5c', '#d98b25', 'c', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.2" stroke-opacity=".5"/><circle cx="12" cy="12" r="2.2" fill="#fff"/>'],
  week: ['#ff9a4d', '#e8452c', 's', '<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3.5 10h17"/><path d="M10 13.2h4.2l-2.6 5"/>'],
  unwrap: ['#b9f3dc', '#2fb38a', 'c', '<path d="M3.5 7.5L12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="M3.5 7.5L12 11.5l8.5-4"/><path d="M12 11.5v9"/><path d="M7.7 5.5l8.5 4"/>'],
  time: ['#f2dca2', '#b0813f', 's', '<path d="M6.5 2.5h11M6.5 21.5h11"/><path d="M7.5 2.5c0 4.2 2.4 6.3 4.5 9.5-2.1 3.2-4.5 5.3-4.5 9.5"/><path d="M16.5 2.5c0 4.2-2.4 6.3-4.5 9.5 2.1 3.2 4.5 5.3 4.5 9.5"/><path d="M9.5 19.5h5l-2.5-2.6z" fill="#fff"/>'],
  one: ['#ff8fc3', '#d93f7b', 'c', '<path d="M20.4 5a5.2 5.2 0 0 0-7.4 0L12 6l-1-1a5.2 5.2 0 0 0-7.4 7.4l1 1L12 20.5l7.4-7.1 1-1a5.2 5.2 0 0 0 0-7.4z"/>'],
  globe: ['#7deab5', '#1f9d6a', 's', '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>'],
};
const ROT = { repeat: -5, marathon: 4, picky: -3, night: 6, whole: -6, week: 3, unwrap: -4, time: 5, one: -2, globe: 4 };
let uid = 0;
function art(a, on) {
  const [c1, c2, sh, g] = ART[a.id], id = 'g' + (uid++);
  const shape = (inset, attrs) => sh === 'c' ? '<circle cx="60" cy="60" r="' + (56 - inset) + '" ' + attrs + '/>' : '<rect x="' + (6 + inset) + '" y="' + (6 + inset) + '" width="' + (108 - 2 * inset) + '" height="' + (108 - 2 * inset) + '" rx="' + (30 - inset * .6) + '" ' + attrs + '/>';
  const glyph = '<g transform="translate(60 60) scale(2.25) translate(-12 -12)" fill="none" stroke="' + (on ? '#fff' : 'rgba(255,255,255,.36)') + '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (on ? g : g.replace(/fill="#fff"/g, 'fill="rgba(255,255,255,.36)"')) + '</g>';
  if (on) return '<svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs>' +
    shape(0, 'fill="#f6f2ea"') + shape(6, 'fill="url(#' + id + ')"') + shape(6, 'fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1.2"') + glyph + '</svg>';
  const frac = Math.max(0, Math.min(1, a.value / a.target)), C = 2 * Math.PI * 62;
  return '<svg viewBox="0 0 120 120" aria-hidden="true">' + shape(0, 'fill="rgba(255,255,255,.035)" stroke="rgba(255,255,255,.2)" stroke-width="1.4" stroke-dasharray="5 5"') + glyph +
    '<circle cx="60" cy="60" r="62" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="3.5"/>' +
    '<circle cx="60" cy="60" r="62" fill="none" stroke="var(--acc,#fff)" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="' + (frac * C).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 60 60)"/></svg>';
}
const left = a => { const n = a.target - a.value; if (a.id === 'one') return 'ещё ' + dec1(n) + ' ч'; if (a.id === 'repeat') return 'ещё ' + n + ' ' + plural(n, 'раз', 'раза', 'раз') + ' — и твоя';
  return 'осталось ' + num(n); };
function stickerHtml(a) {
  const on = !!a.earned, near = !on && a.value / a.target >= .7;
  return '<div class="sk" data-ach="' + a.id + '"' + (on ? ' data-on' : '') + ' style="--rot:' + ROT[a.id] + 'deg"><div class="st-art">' + art(a, on) + '</div><b>' + esc(a.name) + '</b><small>' + esc(a.line) + '</small>' +
    '<span class="when' + (near ? ' near' : '') + '">' + (on ? 'получена ' + ru(a.earned) : (a.id === 'one' ? dec1(a.value) + ' из ' + a.target + ' ч' : num(a.value) + ' из ' + num(a.target)) + ' · ' + left(a)) + '</span></div>';
}

/* ── «бульк»: a drop into water, quiet, in the same frame as the sticker lands ── */
function bulk() {
  try {
    const ac = MX.audio(); if (!ac) return; const t = ac.currentTime + .005;
    const drop = (t0, f0, f1, dur, vol) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur * .55);
      g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + .008); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
      o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + dur + .02); };
    drop(t, 1250, 330, .2, .14); drop(t + .075, 1700, 560, .12, .05);
  } catch (e) {}
}
let popEl = null, popT = 0;
function pop(a) {
  popEl?.remove(); clearTimeout(popT);
  const p = document.createElement('div'); p.className = 'ach-pop'; p.setAttribute('role', 'status');
  p.innerHTML = '<div class="st-art">' + art(a, true) + '</div><div class="t"><i>Новая ачивка</i><b>' + esc(a.name) + '</b><small>' + esc(a.line) + (a.ctx?.text && a.id !== 'week' ? ' · ' + esc(a.ctx.text) : '') + '</small></div>';
  stage.appendChild(p); popEl = p;
  const sa = $('.st-art', p);
  if (!reduce) {
    p.animate([{ transform: 'translateX(calc(100% + 40px))', opacity: .3 }, { transform: 'none', opacity: 1 }], { duration: 560, easing: 'cubic-bezier(.2,1.15,.35,1)' });
    sa.animate([{ transform: 'scale(1.9) rotate(-28deg)', opacity: 0 }, { transform: 'scale(1.9) rotate(-28deg)', opacity: 0, offset: .4 }, { transform: 'scale(.9) rotate(-2deg)', opacity: 1, offset: .72 }, { transform: 'scale(1) rotate(-6deg)', opacity: 1 }],
      { duration: 640, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
    p.animate([{ transform: 'none' }, { transform: 'translateY(3px) scale(.985)', offset: .5 }, { transform: 'none' }], { duration: 260, delay: 470, easing: 'ease-out' });
  }
  setTimeout(bulk, reduce ? 0 : 450);
  const leave = () => p.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(calc(100% + 40px))', opacity: .2 }], { duration: 300, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'forwards' }).finished.then(() => p.remove());
  popT = setTimeout(leave, 5200);
  p.addEventListener('mouseenter', () => clearTimeout(popT));
  p.addEventListener('mouseleave', () => { popT = setTimeout(leave, 1800); });
  p.addEventListener('click', () => { clearTimeout(popT); leave(); MX.goTab?.('stats'); setTimeout(() => { const s = $('[data-ach="' + a.id + '"]'); s?.scrollIntoView({ block: 'center', behavior: 'smooth' }); s?.querySelector('.st-art')?.animate([{ transform: 'rotate(' + ROT[a.id] + 'deg)' }, { transform: 'rotate(' + ROT[a.id] + 'deg) scale(1.18)' }, { transform: 'rotate(' + ROT[a.id] + 'deg)' }], { duration: 520, delay: 400, easing: SPRING }); }, 80); });
}

/* ── the pieces ────────────────────────────────────────────────────────── */
const FAV = ST.top_tracks[0].acc || '#cfd0ff';
const hm = ms => { const m = Math.round(ms / 6e4); return Math.floor(m / 60) + '<small>ч</small> ' + (m % 60) + '<small>мин</small>'; };
function timeHtml() {
  const hh = Math.floor(H), mm = Math.round((H - hh) * 60);
  return '<div class="time"><h3 class="lbl">Ты слушал музыку<small>с ' + ru(ST.since) + '</small></h3><div class="big">' + num(hh) + '<small>ч</small>' + mm + '<small>мин</small></div>' +
    '<div class="phrase"><span class="pt"><span>' + PHRASES[ph] + '</span></span><button type="button" data-phrase aria-label="Другое сравнение">' + icon('Shuffle', 16) + '</button></div></div>';
}
function daysHtml() {
  const first = new Date(ST.cal[0][0] + 'T12:00:00'), off = (first.getDay() + 6) % 7, max = Math.max(...ST.cal.map(c => c[1]));
  let cells = ''; for (let i = 0; i < off; i++) cells += '<i data-empty></i>';
  ST.cal.forEach(([d, c], i) => { const k = c ? Math.round(22 + 78 * Math.sqrt(c / max)) : 0;
    cells += '<i style="background:' + (c ? 'color-mix(in srgb,var(--fav) ' + k + '%,rgba(255,255,255,.06))' : 'rgba(255,255,255,.06)') + '"' + (i === ST.cal.length - 1 ? ' data-today' : '') +
      ' data-say="' + (c ? c + '<small>' + plural(c, 'песня', 'песни', 'песен') + ' · ' + ru(d) + '</small>' : '—<small>тишина · ' + ru(d) + '</small>') + '"></i>'; });
  return '<div class="days"><h3 class="lbl">Дни с музыкой</h3><div class="dn" data-out="' + ST.days + '<small>из ' + ST.span + '</small>">' + ST.days + '<small>из ' + ST.span + '</small></div><div class="cal">' + cells + '</div>' +
    '<div class="streak"><span class="fire">' + icon('Fire', 18) + '</span><span><b>' + ST.streak + '</b> ' + plural(ST.streak, 'день', 'дня', 'дней') + ' подряд' + (ST.streak >= ST.best ? ' — это и есть твой рекорд' : ' · рекорд ' + ST.best) + '</span></div></div>';
}
function factsHtml() {
  const pk = ST.hours.indexOf(Math.max(...ST.hours)), mx = Math.max(...ST.hours), hh = h => String(h).padStart(2, '0') + ':00';
  const peak = hh(pk) + '<small>чаще всего</small>';
  return '<div class="facts" data-wait><div class="fact"><span>В среднем за день</span><b>' + hm(ST.avg_day_ms) + '</b></div>' +
    '<div class="fact"><span>Дослушиваешь до конца</span><b>' + ST.finished_pct + '<small>% песен</small></b></div>' +
    '<div class="fact wide"><span>Когда ты слушаешь</span><b class="hv" data-out="' + peak + '">' + peak + '</b><div class="hours">' +
      ST.hours.map((v, h) => '<i style="--h:' + (v / mx).toFixed(3) + ';--n:' + h + '"' + (h === pk ? ' data-peak' : '') + ' data-say="' + hh(h) + '<small>' + nx(v, 'песня', 'песни', 'песен') + '</small>"></i>').join('') +
      '</div><div class="hx"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></div></div>';
}
function portraitHtml() {
  return '<div class="portrait"><h3 class="lbl">Портрет слушателя</h3><p>' + portrait() + '</p><div class="src">Собран из твоих прослушиваний. Когда вернётся модель, она перепишет его живее.</div></div>';
}
/* favourites: the top three of each, a stack you can turn */
const favState = { artist: 0, track: 0 };
function favText(kind, i) {
  const a = kind === 'artist', x = (a ? ST.top_artists : ST.top_tracks)[i];
  return '<span class="k"><span class="rk">№ ' + (i + 1) + '</span>' + (a ? 'Любимый артист' : 'Любимая песня') + '</span><h4>' + esc(a ? x.name : x.t) + '</h4>' +
    '<div class="n">' + (a ? '<b>' + dec1(x.hours) + ' ч</b> музыки · <b>' + dec1(x.share) + ' %</b> всего времени<br>' + nx(x.plays, 'прослушивание', 'прослушивания', 'прослушиваний')
      : esc(x.ar) + '<br>сыграна до конца <b>' + nx(x.plays, 'раз', 'раза', 'раз') + '</b>') + '</div>';
}
/* the three texts lie on one another in one cell: the tallest sets the height, so the arrows
   never move under the pointer and nothing is clipped while one gives way to the next */
function favHtml(kind) {
  const list = kind === 'artist' ? ST.top_artists : ST.top_tracks;
  return '<div class="fav ' + kind + '" data-fav="' + kind + '"><div class="deck2">' + list.map((x, i) => '<div class="card2" data-pos="' + i + '" data-i="' + i + '"><img src="' + (x.img || x.cover) + '" alt=""></div>').join('') +
    '<button type="button" class="play" data-favplay aria-label="Слушать">' + icon('Play', 18) + '</button></div>' +
    '<div class="ftx"><div class="roll">' + list.map((_, i) => '<div class="fl" data-i="' + i + '"' + (i ? ' data-off aria-hidden="true"' : '') + '>' + favText(kind, i) + '</div>').join('') + '</div>' +
    '<div class="nav"><button type="button" class="arw" data-favgo="-1" aria-label="Назад">' + icon('ChevronLeft', 20) + '</button>' +
    '<span class="dots">' + list.map((_, i) => '<i' + (i ? '' : ' data-on') + '></i>').join('') + '</span><button type="button" class="arw" data-favgo="1" aria-label="Дальше">' + icon('ChevronRight', 20) + '</button></div></div></div>';
}
function favSet(box, kind, i, dir) {
  const n = 3, old = favState[kind]; i = (i + n) % n; if (i === old) return; favState[kind] = i;
  $$('.card2', box).forEach(c => c.dataset.pos = String((+c.dataset.i - i + n) % n));
  $$('.dots i', box).forEach((d, k) => d.toggleAttribute('data-on', k === i));
  const out = $('.fl[data-i="' + old + '"]', box), inn = $('.fl[data-i="' + i + '"]', box);
  inn.style.transition = 'none'; inn.style.setProperty('--dy', (dir * 18) + 'px'); void inn.offsetWidth; inn.style.transition = '';
  inn.removeAttribute('data-off'); inn.removeAttribute('aria-hidden');
  out.style.setProperty('--dy', (-dir * 14) + 'px'); out.setAttribute('data-off', ''); out.setAttribute('aria-hidden', 'true');
}
/* the years: a landscape of the library over time, the peak marked; under the pointer a line
   and a dot run along it and the caption says that year in place */
function yearsHtml() {
  const ys = ST.years, y0 = Math.max(1965, Math.min(...ys.map(y => y[0]))), y1 = Math.max(...ys.map(y => y[0])), raw = {};
  ys.forEach(([y, c]) => raw[y] = c);
  const xs = []; for (let y = y0; y <= y1; y++) xs.push(y);
  const sm = xs.map(y => [1, 2, 3, 2, 1].reduce((a, w, k) => a + w * (raw[y - 2 + k] || 0), 0) / 9);
  const mx = Math.max(...sm), X = y => (y - y0) / (y1 - y0) * 1000, Y = v => 200 - v / mx * 176;
  const pts = xs.map((y, i) => [X(y), Y(sm[i])]);
  let d = 'M' + pts[0][0] + ',' + pts[0][1];
  for (let i = 1; i < pts.length; i++) { const p0 = pts[i - 2] || pts[i - 1], p1 = pts[i - 1], p2 = pts[i], p3 = pts[i + 1] || p2;
    d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ',' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + ' ' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ',' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1); }
  const pkY = ys.reduce((a, b) => b[1] > a[1] ? b : a), pi = xs.indexOf(pkY[0]);
  const decs = []; for (let y = Math.ceil(y0 / 10) * 10; y <= y1; y += 10) decs.push(y);
  const lib = ST.library, core = lib.decades.reduce((a, b) => b[1] > a[1] ? b : a);
  const cap = 'Ядро библиотеки — <b>' + core[0] + '-е</b>: ' + Math.round(core[1]) + ' % песен. Самый богатый год — <b>' + pkY[0] + '</b>.';
  return '<div><h3 class="lbl">Песни по годам<small>' + num(lib.tracks) + '</small></h3><div class="yr" data-wait data-yr=\'' + JSON.stringify({ y0, y1, raw, sm: sm.map(v => +(Y(v) / 200).toFixed(4)) }) + '\'>' +
    decs.map(y => '<span class="gl" style="left:' + (X(y) / 10) + '%"></span>').join('') +
    '<svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="yrg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + FAV + '" stop-opacity=".42"/><stop offset="1" stop-color="' + FAV + '" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="' + d + ' L1000,200 L0,200 Z" fill="url(#yrg)"/><path d="' + d + '" fill="none" stroke="' + FAV + '" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>' +
    '<div class="pk" style="left:' + (X(pkY[0]) / 10) + '%;top:' + (Y(sm[pi]) / 200 * 196) + 'px">' + pkY[0] + '<small>' + nx(pkY[1], 'песня', 'песни', 'песен') + '</small></div>' +
    '<span class="xh"></span><span class="dot"></span><span class="lab"></span><div class="ax">' + decs.map(y => '<span style="left:' + (X(y) / 10) + '%">' + y + '</span>').join('') + '</div></div>' +
    '<p class="cap2" data-out="' + cap.replace(/"/g, '&quot;') + '">' + cap + '</p></div>';
}
const bars = (rows, sayOf, nameOf) => { const mx = rows[0][1];
  return '<div class="hb">' + rows.map(([k, v], i) => '<div class="r"' + (i === 0 ? ' data-peak' : '') + ' data-say="' + sayOf(k, v).replace(/"/g, '&quot;') + '"><span class="nm">' + nameOf(k) + '</span><span class="tr"><i style="width:' + (v / mx * 100) + '%;--n:' + i + '"></i></span><span class="v">' + Math.round(v) + '%</span></div>').join('') + '</div>'; };
function genresHtml() {
  const gen = ST.library.genres.filter(g => g[0] !== 'Другое').slice(0, 6), cap = 'Больше всего — <b>' + esc(gen[0][0].toLowerCase()) + '</b>.';
  return '<div><h3 class="lbl">По жанрам</h3>' + bars(gen, (k, v) => '<b>' + esc(k) + '</b> — ' + nx(v / 100 * ST.library.tracks, 'песня', 'песни', 'песен') + ', ' + Math.round(v) + ' %', esc) +
    '<p class="cap2" data-out="' + cap.replace(/"/g, '&quot;') + '">' + cap + '</p></div>';
}
function countriesHtml() {
  const cs = ST.listened.countries.filter(c => c[0] !== '—').slice(0, 6), nm = k => esc(MX.countryName(k) || k), cap = 'По времени прослушивания.';
  return '<div><h3 class="lbl">Откуда твои артисты</h3>' + bars(cs, (k, v) => '<b>' + nm(k) + '</b> — ' + dec1(v / 100 * H) + ' ч музыки, ' + Math.round(v) + ' %', k => flagHtml(k) + nm(k)) +
    '<p class="cap2" data-out="' + cap + '">' + cap + '</p></div>';
}
function achHtml() {
  const n = ST.ach.filter(a => a.earned).length;
  return '<div class="achs"><h3 class="lbl">Ачивки<small>' + n + ' из ' + ST.ach.length + '</small></h3><div class="stickers">' + ST.ach.map(stickerHtml).join('') + '</div></div>';
}
function render(el) {
  if (!el) return;
  favState.artist = favState.track = 0;
  el.innerHTML = '<div class="st" style="--fav:' + FAV + '"><div class="hero">' + timeHtml() + daysHtml() + portraitHtml() + factsHtml() + '</div>' +
    '<div><h3 class="lbl">Любимые</h3><div class="favs">' + favHtml('artist') + favHtml('track') + '</div></div>' +
    '<div>' + yearsHtml() + '<div class="two" data-wait>' + genresHtml() + countriesHtml() + '</div></div>' + achHtml() + '</div>';
  reveal(el);
  if (!reduce) $$('.sk[data-on] .st-art', el).forEach((s, i) => s.animate([{ transform: 'scale(.6) rotate(-30deg)', opacity: 0 }, { transform: 'rotate(' + ROT[s.parentElement.dataset.ach] + 'deg)', opacity: 1 }], { duration: 520, delay: 120 + i * 70, easing: SPRING, fill: 'backwards' }));
}
window.renderStats = render;

/* ── charts come in when first seen ──────────────────────────────────── */
let io = null;
function reveal(el) {
  io?.disconnect();
  io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { const x = e.target; x.setAttribute('data-growing', ''); x.removeAttribute('data-wait'); io.unobserve(x); setTimeout(() => x.removeAttribute('data-growing'), 1600); } }), { root: $('#scroll'), threshold: .3 });
  $$('[data-wait]', el).forEach(x => io.observe(x));
}
/* ── a mark under the pointer says its value in place, as the home's week does ── */
function say(target, html) { if (!target || target.dataset.now === html) return; target.dataset.now = html; target.innerHTML = '<span class="say">' + html + '</span>'; }
function unsay(target) { if (!target || !target.dataset.now) return; delete target.dataset.now; target.innerHTML = '<span class="say">' + target.dataset.out + '</span>'; }
stage.addEventListener('pointerover', e => {
  const t = e.target, st = t.closest('#stats'); if (!st) return;
  const cell = t.closest('.cal i[data-say]'); if (cell) { say($('.days .dn', st), cell.dataset.say); return; }
  const hr = t.closest('.hours i'); if (hr) { say($('.hv', st), hr.dataset.say); return; }
  const r = t.closest('.hb .r'); if (r) { say($('.cap2', r.closest('.hb').parentElement), r.dataset.say); }
});
stage.addEventListener('pointerout', e => {
  const t = e.target, st = t.closest('#stats'); if (!st) return;
  if (t.closest('.cal') && !e.relatedTarget?.closest?.('.cal')) unsay($('.days .dn', st));
  if (t.closest('.hours') && !e.relatedTarget?.closest?.('.hours')) unsay($('.hv', st));
  const hb = t.closest('.hb'); if (hb && !e.relatedTarget?.closest?.('.hb')) unsay($('.cap2', hb.parentElement));
  const yr = t.closest('.yr'); if (yr && !e.relatedTarget?.closest?.('.yr')) unsay($('.cap2', yr.parentElement));
});
stage.addEventListener('pointermove', e => {
  const yr = e.target.closest('#stats .yr'); if (!yr) return;
  const { y0, y1, raw, sm } = JSON.parse(yr.dataset.yr), r = yr.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.round(y0 + f * (y1 - y0));
  const x = (y - y0) / (y1 - y0) * 100, svgH = yr.clientHeight - 34;
  $('.xh', yr).style.left = x + '%'; const dot = $('.dot', yr); dot.style.left = x + '%'; dot.style.top = (sm[y - y0] * svgH) + 'px';
  const lab = $('.lab', yr); lab.style.left = Math.max(4, Math.min(96, x)) + '%'; lab.style.top = (sm[y - y0] * svgH) + 'px';
  const html = y + '<small>' + nx(raw[y] || 0, 'песня', 'песни', 'песен') + '</small>'; if (lab.dataset.now !== html) { lab.dataset.now = html; lab.innerHTML = html; }
});
stage.addEventListener('click', e => {
  const t = e.target;
  if (!t.closest('#stats')) return;
  if (t.closest('[data-phrase]')) {
    const btn = t.closest('[data-phrase]'), pt = $('.phrase .pt'); ph = (ph + 1) % PHRASES.length;
    $$('span', pt).slice(0, -1).forEach(x => x.remove());              // a click during a change: drop what was leaving
    const old = pt.lastElementChild, n = document.createElement('span'); n.innerHTML = PHRASES[ph]; pt.appendChild(n);
    if (reduce) { old?.remove(); return; }
    old?.animate([{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'translateY(-8px)', filter: 'blur(5px)' }], { duration: 170, easing: 'ease-in', fill: 'forwards' }).finished.then(() => old.remove());
    n.animate([{ opacity: 0, transform: 'translateY(10px)', filter: 'blur(5px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { duration: 460, delay: 110, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'backwards' });
    $('svg', btn)?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(180deg)' }], { duration: 520, easing: 'cubic-bezier(.3,1.25,.4,1)' });
    return; }
  const s = t.closest('[data-ach]');
  if (s) { const a = ST.ach.find(x => x.id === s.dataset.ach); if (a.earned) pop(a); else { toast('<b>' + esc(a.name) + '</b> <span>· ' + esc(left(a)) + '</span>'); $('.st-art', s).animate([{ transform: 'none' }, { transform: 'rotate(-6deg)' }, { transform: 'rotate(5deg)' }, { transform: 'none' }], { duration: 420, easing: 'ease-out' }); } return; }
  const f = t.closest('[data-fav]');
  if (f) { const k = f.dataset.fav, list = k === 'artist' ? ST.top_artists : ST.top_tracks;
    const go = t.closest('[data-favgo]'); if (go) { favSet(f, k, favState[k] + +go.dataset.favgo, +go.dataset.favgo); return; }
    const c = t.closest('.card2'); if (c && c.dataset.pos !== '0') { const i = +c.dataset.i; favSet(f, k, i, i > favState[k] ? 1 : -1); return; }
    if (t.closest('[data-favplay]')) { const x = list[favState[k]]; MX.playTitle(k === 'artist' ? null : x.t, k === 'artist' ? x.name : null, $('.card2[data-pos="0"] img', f)); } }
});
/* the easter egg: play «Stronger» once more and «На репите» is yours */
MX.onPlay = t => { const a = ST.ach.find(x => x.id === 'repeat');
  if (a && !a.earned && a.ctx && t && a.ctx.text.startsWith(t.t + ' ·')) { a.value = a.target; a.earned = ST.today; setTimeout(() => pop(a), 700); const el = $('#stats'); if (el) setTimeout(() => render(el), 900); } };
$('#popBtn')?.addEventListener('click', () => { const on = ST.ach.filter(a => a.earned); pop(on[Math.floor(Math.random() * on.length)]); });
render($('#stats'));
})();
