// What comes when it is called: the sheet (about, queue, ask) and the morph menu «В плейлист».
// Every sheet is liquid glass v2: «clear» is the see-through glass of the library's floating plate (the queue),
// «deep» has a little more tint under reading text (about, ask).
const sheetEl = $('#sheet'), scrimEl = $('#scrim'), sheetBody = $('#sheetBody'), sheetFoot = $('#sheetFoot'), sheetHead = $('#sheetHead');
const sh = { kind: null, h: 600, over: false, opt: {}, dim: 0.36 };
sh.y = new Spring(0, { k: 260, c: 30, m: 1, eps: 0.05 }, drawSheet);
function drawSheet(y) {
  const o = clamp(1 - y / sh.h);
  sheetEl.style.transform = `translateY(${y.toFixed(1)}px)`;
  scrimEl.style.opacity = (o * sh.dim).toFixed(3);
  el.pl.style.transform = o ? `scale(${(1 - 0.035 * o).toFixed(4)}) translateY(${(-6 * o).toFixed(1)}px)` : '';   // the player steps back
}
const SHEETS = {
  about: { title: 'О песне', build: buildAbout, glass: 'deep', dim: 0.36 },
  queue: { title: 'Далее', build: buildQueue, glass: 'clear', dim: 0.14 },
  ask: { title: 'Спросить', build: buildAsk, glass: 'deep', dim: 0.36 },
};
function openSheet(kind, opt = {}) {
  const fresh = !sh.kind, def = SHEETS[kind];
  sh.kind = kind; sh.opt = opt; sh.dim = def.dim;
  $('#sheetTitle').textContent = def.title; $('#sheetAside').textContent = '';
  sheetBody.innerHTML = ''; sheetFoot.innerHTML = ''; sheetBody.scrollTop = 0; sheetBody.onscroll = null;
  sheetEl.classList.remove('deep', 'clear'); sheetEl.classList.add('lg', def.glass);
  def.build(opt);
  paintIcons(sheetEl);
  sheetEl.classList.add('live'); scrimEl.classList.add('on');
  sheetEl.setAttribute('aria-hidden', 'false');
  sh.h = sheetEl.offsetHeight + 28;
  sh.y.done = null;
  if (fresh) sh.y.snap(sh.h);
  if (!opt.drag) sh.y.set(0);
  hideHint(false);
}
function closeSheet(vel = 0) {
  if (!sh.kind) return;
  sh.h = sheetEl.offsetHeight + 28;                             // it may have grown since it opened
  sh.y.done = () => { sheetEl.classList.remove('live'); scrimEl.classList.remove('on'); sheetEl.setAttribute('aria-hidden', 'true'); sh.kind = null; sheetBody.innerHTML = ''; sheetFoot.innerHTML = ''; el.pl.style.transform = ''; };
  sh.y.set(sh.h, vel);
  scrimEl.classList.remove('on');
}
scrimEl.addEventListener('click', () => closeSheet());
$('#sheetClose').addEventListener('click', () => closeSheet());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (menuOpen) closeMenu(); else closeSheet(); } });
/* The sheet follows the finger; past the open position it resists; position and speed decide.
   Pulled from the «Далее» row, which stands above the system gesture zone, the sheet's edge comes up to the
   finger (it catches up within a few frames) and then stays under it. */
function sheetDrag(e, fromRow) {
  if (!fromRow) sh.h = sheetEl.offsetHeight + 28;
  const p0 = pt(e), base = sh.y.v, tk = tracker(), topOpen = M.H - 8 - sheetEl.offsetHeight;
  sh.y.alive = false; sh.over = base > sh.h * 0.5;
  let target = base;
  const chase = fromRow ? run((dt) => { sh.y.v += (target - sh.y.v) * (1 - Math.exp(-dt * 26)); drawSheet(sh.y.v); }) : null;
  const move = (ev) => {
    const p = pt(ev); tk.add(p.x, p.y);
    let y = fromRow ? p.y - 20 - topOpen : base + (p.y - p0.y);
    if (y < 0) y = -rubber(-y, 160);
    y = Math.min(y, sh.h);
    if (fromRow) target = y; else { sh.y.v = y; drawSheet(y); }
    const over = y > sh.h * 0.5; if (over !== sh.over) { sh.over = over; hap(over ? 'Threshold' : 'ThresholdOff'); }
  };
  const up = (ev) => {
    e.target.removeEventListener('pointermove', move); e.target.removeEventListener('pointerup', up); e.target.removeEventListener('pointercancel', up);
    if (chase) chase();
    const v = tk.vel().y, land = (fromRow ? target : sh.y.v) + project(v, 0.992);
    if (land > sh.h * 0.5 || ev.type === 'pointercancel' && fromRow) closeSheet(v); else { sh.y.done = null; sh.y.set(0, v); scrimEl.classList.add('on'); }
  };
  cap(e.target, e.pointerId);
  e.target.addEventListener('pointermove', move); e.target.addEventListener('pointerup', up); e.target.addEventListener('pointercancel', up);
  if (fromRow) move(e);
}
sheetHead.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) sheetDrag(e, false); });
/* «Далее»: a tap opens the queue; a pull up brings the sheet out after the finger */
let trayG = null;
el.tray.addEventListener('pointerdown', (e) => { trayG = { id: e.pointerId, y0: pt(e).y }; });
el.tray.addEventListener('pointermove', (e) => {
  if (!trayG || trayG.id !== e.pointerId) return;
  if (pt(e).y - trayG.y0 < -10) { trayG = null; openSheet('queue', { drag: true }); sheetDrag({ target: el.tray, pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY }, true); }
});
el.tray.addEventListener('pointerup', () => { if (trayG) { trayG = null; openSheet('queue'); } });
el.tray.addEventListener('pointercancel', () => { trayG = null; });
el.tray.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openSheet('queue'); });
function onTrackChange() { if (sh.kind === 'queue') drawQueue(true); else if (sh.kind) openSheet(sh.kind); }

/* ---------------- О песне: a strip of facts, then the credits as on a film ----------------
   The strip speaks the language of the seek line: one block per fact, the read ones filled. A tap on the right
   goes on, on the left goes back, a swipe does the same. Below, the credits stand in two columns round one axis,
   the way end titles do. No instruments here: they live on the «Звук» side. */
const CAT = { creation: 'Создание', record: 'Запись', sample: 'Семплы', sound: 'Звук', trouble: 'Споры', video: 'Клип' };
const ARTIST = {
  'Madonna': ['Самая продаваемая певица в истории по версии Книги рекордов Гиннесса.', 'Для «Ray of Light» она впервые работала с Уильямом Орбитом — и ушла в электронику.'],
  'Foals': ['Группа собралась в Оксфорде в 2005 году; начинали с математичного рока.', '«Everything Not Saved Will Be Lost» вышел двумя частями в один год.'],
  'Kanye West': ['Начинал как продюсер: его ускоренные соул-семплы звучат на «The Blueprint» Jay-Z.', 'Больше двадцати «Грэмми» — один из самых награждённых рэперов.'],
  'Royal Blood': ['Дуэт из Брайтона: бас-гитара, пропущенная через гитарные усилители, и барабаны.'],
};
const SAMPLES = {
  'Power': [['21st Century Schizoid Man', 'King Crimson', 1969], ['Afromerica', 'Continent Number 6', 1978], ['It’s Your Thing', 'Cold Grits', 1969]],
  'Diamonds from Sierra Leone': [['Diamonds Are Forever', 'Shirley Bassey', 1971]],
};
function buildAbout() {
  const t = cur();
  const facts = [...t.facts.map((f) => ({ text: f.text, group: 'Песня', cat: CAT[(f.labels || [])[0]] || 'Факт' })), ...(ARTIST[t.a] || []).map((text) => ({ text, group: 'Артист', cat: t.a }))];
  const names = (re, max = 3) => [...new Set(t.credits.filter((c) => re.test(c.role)).map((c) => c.name))].slice(0, max);
  const prod = [...new Set([...names(/^(co-)?producer$/i, 4), ...names(/produc/i, 4)])].slice(0, 4);
  const rows = [];
  if (prod.length) rows.push(['Продюсеры', prod.map((n) => `<button class="link"><span>${esc(n)}</span></button>`).join('')]);
  const voices = names(/^(additional )?vocals$/i).filter((n) => n !== t.a);
  if (voices.length) rows.push(['Голоса', voices.map((n) => `<span>${esc(n)}</span>`).join('')]);
  const mix = names(/mixing/i, 2);
  if (mix.length) rows.push(['Сведение', mix.map((n) => `<span>${esc(n)}</span>`).join('')]);
  rows.push(['Жанр', `<span>${esc(t.genre)}</span>`], ['Год', `<span class="num">${t.year}</span>`]);
  if (SAMPLES[t.t]) rows.push(['Семплирует', SAMPLES[t.t].map(([a, b, y]) => `<button class="smp"><b>${esc(a)}</b><small>${esc(b)} · ${y} · нет в фонотеке</small></button>`).join('')]);
  const wrap = document.createElement('div');
  wrap.innerHTML = (facts.length ? `<div class="story rise"><div class="fstrip" id="fstrip">${facts.map((f, i) => `<button class="${i && f.group !== facts[i - 1].group ? 'gap' : ''}" aria-label="Факт ${i + 1} из ${facts.length}"><i></i></button>`).join('')}</div>
      <div class="fhead"><span class="fcat" id="fcat"></span><span class="fnum" id="fnum"></span></div>
      <div class="fcell" id="fcell">${facts.map((f) => `<p>${esc(f.text)}</p>`).join('')}</div></div>`
    : '<p class="facts-empty rise">Истории об этой песне ещё собираются.</p>')
    + `<button class="asklink rise" style="animation-delay:.06s"><span data-icon="Sparkles"></span>Что значит название «${esc(t.t)}»?</button>
    <dl class="roll">${rows.map(([k, v], i) => `<dt class="rise" style="animation-delay:${0.1 + i * 0.04}s">${k}</dt><dd class="rise" style="animation-delay:${0.1 + i * 0.04}s">${v}</dd>`).join('')}</dl>`;
  sheetBody.append(wrap);
  $('.asklink', wrap).addEventListener('click', () => openSheet('ask', { ask: `Что значит название «${t.t}»?` }));
  for (const b of $$('.roll .link', wrap)) b.addEventListener('click', () => toast(`Продюсер: ${b.textContent} — его песни в библиотеке`));
  for (const b of $$('.smp', wrap)) b.addEventListener('click', () => toast('Этой песни нет в фонотеке'));
  if (!facts.length) return;
  const cell = $('#fcell', wrap), strip = $$('#fstrip button', wrap), ps = $$('p', cell);
  let at = -1;
  function show(i, dir = 1) {
    i = (i + facts.length) % facts.length; if (i === at) return;
    const old = ps[at], next = ps[i];
    if (old && !still()) old.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dir * 18}px)` }], { duration: 170, easing: 'ease-in' });
    if (at >= 0 && !still()) next.animate([{ opacity: 0, transform: `translateX(${dir * 22}px)` }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 110, easing: 'cubic-bezier(.22,.9,.3,1)', fill: 'backwards' });
    ps.forEach((p, k) => p.classList.toggle('on', k === i));
    strip.forEach((b, k) => { b.classList.toggle('on', k === i); b.classList.toggle('read', k < i); });
    $('#fcat', wrap).textContent = facts[i].group + ' · ' + facts[i].cat; $('#fnum', wrap).textContent = `${i + 1} / ${facts.length}`;
    if (at >= 0) hap('Tick');
    at = i;
  }
  strip.forEach((b, k) => b.addEventListener('click', () => show(k, k > at ? 1 : -1)));
  let fx = null;
  cell.addEventListener('pointerdown', (e) => { fx = e.clientX; });
  cell.addEventListener('pointerup', (e) => {
    if (fx == null) return;
    const dx = e.clientX - fx, r = cell.getBoundingClientRect(); fx = null;
    if (Math.abs(dx) > 36 * zoom) show(at + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 8) { const back = e.clientX - r.left < r.width * 0.3; show(at + (back ? -1 : 1), back ? -1 : 1); }
  });
  paintIcons(wrap); show(0);
}

/* ---------------- Далее: the queue ---------------- */
const ROW = 60;
let qEls = new Map(), qDrag = null;
function buildQueue() {
  const t = cur();
  sheetBody.innerHTML = `<div class="qcap"><span class="cap">Сейчас</span></div>
    <div class="qrow now" style="position:relative"><img src="${t.cover}" alt=""><span class="qt"><b>${esc(t.t)}</b><small>${esc(t.a)}</small></span><span class="eq"><i></i><i></i><i></i></span></div>
    <div class="qcap" style="margin-top:8px"><span class="cap" id="qNextCap"></span></div><div class="qlist" id="qList"></div>
    <p class="qfoot"><span data-icon="Sparkles"></span>Когда очередь кончится, Автоплейлист продолжит похожим.</p>`;
  qEls = new Map();
  sheetBody.onscroll = () => drawQueue();
  const now = $('.qrow.now', sheetBody); let nx = null;                  // the playing song cannot be swiped away
  now.addEventListener('pointerdown', (e) => { nx = e.clientX; });
  now.addEventListener('pointermove', (e) => { if (nx != null && Math.abs(e.clientX - nx) > 24 * zoom) { nx = null; hap('Reject'); now.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-14px)' }, { transform: 'translateX(0)' }], { duration: 360, easing: 'cubic-bezier(.34,1.56,.64,1)' }); toast('Играющую песню убрать нельзя'); } });
  drawQueue(true);
}
const upNext = () => st.q.slice(st.qi + 1);
function drawQueue(reset) {
  const list = $('#qList'); if (!list) return;
  const up = upNext();
  if (reset) { const t = cur(), now = $('.qrow.now', sheetBody); $('img', now).src = t.cover; $('b', now).textContent = t.t; $('small', now).textContent = t.a; }
  $('#qNextCap').textContent = up.length ? `Далее · ${up.length}` : 'Дальше пусто';
  $('#sheetAside').textContent = up.length ? fmt(up.reduce((a, x) => a + T[x.ti].d, 0)).replace(/^(\d+):(\d+)$/, (m, a) => (a >= 60 ? `${Math.floor(a / 60)} ч ${a % 60} мин` : `${a} мин`)) : '';
  list.style.height = up.length * ROW + 'px';
  const top = sheetBody.scrollTop - list.offsetTop, first = Math.max(0, Math.floor(top / ROW) - 4), last = Math.min(up.length - 1, Math.ceil((top + sheetBody.clientHeight) / ROW) + 4);
  const keep = new Set();
  for (let i = first; i <= last; i++) {
    const item = up[i]; keep.add(item.k);
    let row = qEls.get(item.k);
    if (!row) { row = queueRow(item); qEls.set(item.k, row); list.append(row); if (!reset && !still()) row.animate([{ opacity: 0 }, { opacity: 1 }], 200); }
    if (!(qDrag && qDrag.item === item)) row.style.transform = `translateY(${i * ROW}px)`;
  }
  for (const [k, row] of qEls) if (!keep.has(k) && !(qDrag && qDrag.item.k === k)) { row.remove(); qEls.delete(k); }
}
function queueRow(item) {
  const t = T[item.ti], row = document.createElement('div');
  row.className = 'qrow';
  row.innerHTML = `<img src="${t.cover}" alt="" draggable="false"><span class="qt"><b>${esc(t.t)}</b><small>${esc(t.a)}</small></span><span class="qd">${fmt(t.d)}</span><span class="handle" role="button" aria-label="Переставить">${icon('Drag')}</span><span class="bin">${icon('Trash')}</span>`;
  const idx = () => upNext().indexOf(item);
  /* reorder by the handle: lift, a tick for every neighbour passed, drop */
  const handle = $('.handle', row);
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); cap(handle, e.pointerId);
    qDrag = { item, y0: pt(e).y, from: idx(), at: idx() }; row.classList.add('drag'); hap('Lift');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!qDrag || qDrag.item !== item) return;
    const dy = pt(e).y - qDrag.y0, n = upNext().length;
    const y = clamp(qDrag.from * ROW + dy, -10, (n - 1) * ROW + 10);
    row.style.transform = `translateY(${y}px) scale(1.02)`;
    const to = clamp(Math.round(y / ROW), 0, n - 1);
    if (to !== qDrag.at) { const base = st.qi + 1; st.q.splice(base + to, 0, st.q.splice(base + qDrag.at, 1)[0]); qDrag.at = to; hap('Tick'); drawQueue(); }
  });
  const drop = () => { if (!qDrag || qDrag.item !== item) return; qDrag = null; row.classList.remove('drag'); hap('Drop'); drawQueue(); refill(); showTray(); };
  handle.addEventListener('pointerup', drop); handle.addEventListener('pointercancel', drop);
  /* swipe away: past the threshold it goes; a toast gives it back */
  let sw = null;
  row.addEventListener('pointerdown', (e) => { if (e.target.closest('.handle')) return; sw = { id: e.pointerId, x0: pt(e).x, y0: pt(e).y, on: false, over: false }; });
  row.addEventListener('pointermove', (e) => {
    if (!sw || sw.id !== e.pointerId) return;
    const dx = pt(e).x - sw.x0, dy = pt(e).y - sw.y0;
    if (!sw.on) { if (Math.abs(dx) < 10 || Math.abs(dy) > Math.abs(dx)) return; sw.on = true; cap(row, e.pointerId); row.classList.add('swipe'); }
    const x = dx < 0 ? dx : rubber(dx, 60);
    row.style.transform = `translate(${x}px,${idx() * ROW}px)`;
    const over = x < -110; if (over !== sw.over) { sw.over = over; row.classList.toggle('over', over); hap(over ? 'Threshold' : 'ThresholdOff'); }
  });
  const swUp = (e) => {
    if (!sw || sw.id !== e.pointerId) return;
    const was = sw; sw = null; row.classList.remove('swipe', 'over');
    if (!was.on) { if (e.type === 'pointerup' && !e.target.closest('.handle')) { const i = st.qi + 1 + idx(); closeSheet(); jump(i); } return; }
    if (was.over && e.type === 'pointerup') {
      const i = st.qi + 1 + idx(); st.q.splice(i, 1);
      row.style.transition = 'transform .22s ease-in, opacity .22s ease-in'; row.style.transform = `translate(-110%,${(i - st.qi - 1) * ROW}px)`; row.style.opacity = 0;
      setTimeout(() => { row.remove(); qEls.delete(item.k); }, 230);
      qEls.delete(item.k); drawQueue(); refill(); showTray();
      toast(`Убрано: ${t.t}`, 'Вернуть', () => { st.q.splice(Math.min(i, st.q.length), 0, item); qEls.delete(item.k); row.remove(); drawQueue(); refill(); showTray(); });
    } else drawQueue();
  };
  row.addEventListener('pointerup', swUp); row.addEventListener('pointercancel', swUp);
  return row;
}

/* ---------------- Спросить ----------------
   No song in the head: the listener came from it. The questions are written large, and the one that is chosen
   travels up and becomes the listener's line. While the answer is made, the field rolls up into its own round
   button, which holds the Richbox (mishanaer, unchanged) and stops the answer on a tap; one line beside it says
   what is being done. When the answer has come the button unrolls into the field again. */
function buildAsk(opt) {
  const t = cur(), quote = opt.quote ? [].concat(opt.quote) : null;
  let qs = quote ? ['Что здесь имеется в виду?', 'Есть ли тут отсылка?', 'Как это связано со всей песней?'] : [`Что значит название «${t.t}»?`, 'О чём эта песня?', 'Что послушать после?'];
  sheetBody.innerHTML = (quote ? `<div class="quote rise"><small>${quote.length > 1 ? 'Строчки' : 'Строчка'} из текста</small>${quote.map((l) => `<p>${esc(l)}</p>`).join('')}</div>` : '')
    + '<div id="thread"></div><div class="asks" id="asks"></div>';
  sheetFoot.innerHTML = `<div class="dock"><span class="status" id="askStatus" role="status"></span><form class="composer" id="composer"><input aria-label="Вопрос о песне" placeholder="Спросить о песне…" autocomplete="off"><button class="send" aria-label="Отправить"><span class="arrow">${icon('ArrowUp')}</span><span class="rbs"></span></button></form></div>`;
  const thread = $('#thread'), asks = $('#asks'), comp = $('#composer'), input = $('input', comp), status = $('#askStatus');
  const rb = createRichbox($('.rbs', comp), 24, 'empty');
  const fullW = () => comp.parentElement.clientWidth;
  const fold = new Spring(0, { k: 300, c: 23, m: 1, eps: 0.002 }, (v) => {            // 0 a field, 1 a round button
    comp.style.width = Math.max(44, lerp(fullW(), 50, v)).toFixed(1) + 'px';
    input.style.opacity = clamp(1 - v * 2.4).toFixed(3);
    comp.classList.toggle('folded', v > 0.5);
  });
  let busy = false, timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, still() ? Math.min(ms, 120) : ms));
  const say = (text) => {
    if (still() || !status.textContent) { status.textContent = text; return; }
    status.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140 }).onfinish = () => { status.textContent = text; status.animate([{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.22,.9,.3,1)' }); };
  };
  function drawAsks() {
    asks.innerHTML = qs.map((q, i) => `<button class="askline rise" style="animation-delay:${i * 0.05}s"><span>${esc(q)}</span>${icon('ArrowUp')}</button>`).join('');
    asks.style.display = qs.length ? '' : 'none';
    for (const b of $$('.askline', asks)) b.addEventListener('click', () => send(b.firstElementChild.textContent, b));
  }
  function unroll(note) {
    later(() => { fold.set(0); say(''); status.classList.remove('work'); }, note ? 700 : 520);
    later(() => { rb.setState('empty'); input.placeholder = 'Спросить ещё…'; busy = false; drawAsks(); }, note ? 1000 : 820);
  }
  function send(q, line) {
    if (busy || !q.trim()) return; busy = true;
    qs = qs.filter((x) => x !== q);
    const turn = document.createElement('div'); turn.className = 'turn';
    turn.innerHTML = `<div class="mine">${esc(q)}</div>`;
    thread.append(turn);
    const mine = turn.firstElementChild;
    if (line && !still()) {                                   // the chosen question travels into the listener's line
      const a = line.firstElementChild.getBoundingClientRect();
      const h = asks.offsetHeight;
      asks.animate([{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 300, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).onfinish = () => { asks.style.display = 'none'; asks.getAnimations().forEach((x) => x.cancel()); };
      const ghost = document.createElement('div');
      ghost.className = 'askghost'; ghost.textContent = q;
      ghost.style.cssText = `left:${a.left}px;top:${a.top}px;width:${a.width}px;transform-origin:0 0;font-size:${19 * zoom}px;color:${getComputedStyle(line).color}`;
      document.body.append(ghost);
      mine.style.visibility = 'hidden';
      requestAnimationFrame(() => {
        const b = mine.getBoundingClientRect();
        ghost.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${b.left + 14 * zoom - a.left}px,${b.top + 9 * zoom - a.top}px) scale(${15 / 19})`, opacity: 1, offset: 0.85 }, { transform: `translate(${b.left + 14 * zoom - a.left}px,${b.top + 9 * zoom - a.top}px) scale(${15 / 19})`, opacity: 0 }], { duration: 480, easing: 'cubic-bezier(.3,1.25,.4,1)' }).onfinish = () => ghost.remove();
        setTimeout(() => { mine.style.visibility = ''; mine.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' }); }, 330);
      });
    } else { asks.style.display = 'none'; rise(mine, 0, 8); }
    sheetBody.scrollTop = sheetBody.scrollHeight;
    input.blur(); fold.set(1); rb.setState('waiting'); status.classList.add('work');
    const steps = ['Читаю факты о песне', quote ? 'Сверяю со строчкой' : 'Сверяю с текстом', 'Собираю ответ'];
    steps.forEach((name, i) => later(() => say(name + '…'), 260 + i * 1300));
    later(() => {
      if (!turn.isConnected) return;
      // the mock never passes a random fact off as an answer: only «как записывали» has a real fact behind it
      const body = /послушать/.test(q) ? `Рядом по звуку в твоей библиотеке — ${esc(DATA.extra.slice(0, 2).map((x) => x.t + ' (' + x.a + ')').join(' и '))}.`
        : 'Здесь будет ответ ассистента: один абзац простыми словами, по фактам о песне и её тексту.';
      turn.insertAdjacentHTML('beforeend', `<p class="answer">${body}<br><br><span class="demo">Это сценарий макета: настоящий ответ придёт из приложения.</span></p>`);
      sheetBody.scrollTop = sheetBody.scrollHeight;
      rb.setState('done'); status.classList.remove('work'); say('Готово');
      unroll(false);
    }, 260 + steps.length * 1300);
  }
  function stop() {
    timers.forEach(clearTimeout); timers = [];
    rb.setState('cancelled'); status.classList.remove('work'); say('Остановлено'); hap('ToggleOff');
    unroll(true);
  }
  comp.addEventListener('submit', (e) => { e.preventDefault(); if (busy) return; const q = input.value; input.value = ''; send(q); });
  $('.send', comp).addEventListener('click', (e) => { if (busy && comp.classList.contains('folded')) { e.preventDefault(); stop(); } });
  drawAsks();
  if (opt.ask) { asks.style.display = 'none'; setTimeout(() => send(opt.ask), 320); }
}

/* ================= «В плейлист»: the button becomes the panel and goes back into the button ================= */
const menuEl = $('#menu'), menuIn = $('#menuIn'), mscrim = $('#mscrim');
const PLAYLISTS = [{ name: 'Вечерний свет', n: 12, c: [0, 1, 2, 3] }, { name: 'Чуть громче', n: 34, c: [4, 5, 6, 7] }, { name: 'В дорогу', n: 58, c: [8, 9, 10, 11] }];
let menuOpen = false, mRect = null;
const mm = new Spring(0, MENU, (v) => {
  if (!mRect) return;
  const t = Math.max(0, v), q = 1 - t, r = lerp(24, 20, clamp(t));
  menuEl.style.clipPath = `inset(${(mRect.t * q).toFixed(1)}px ${(mRect.r * q).toFixed(1)}px ${(mRect.b * q).toFixed(1)}px ${(mRect.l * q).toFixed(1)}px round ${r.toFixed(1)}px)`;
  menuIn.style.opacity = clamp((t - 0.4) / 0.4).toFixed(3);
  mscrim.style.opacity = (clamp(t) * 0.3).toFixed(3);
  menuEl.style.opacity = clamp(t * 6).toFixed(3);
});
function openMenu() {
  const t = cur();
  if (st.added.has(t.id)) { const name = st.added.get(t.id); st.added.delete(t.id); el.addBtn.classList.remove('added'); hap('ToggleOff'); toast(`Убрано из «${name}»`); return; }
  menuIn.innerHTML = `<span class="cap">В плейлист</span>` + PLAYLISTS.map((p, i) => `<button class="prow" role="menuitem" data-i="${i}"><span class="mos">${p.c.map((k) => `<img src="${(DATA.extra[k % Math.max(1, DATA.extra.length)] || T[k % T.length]).cover}" alt="">`).join('')}</span><b>${p.name}</b><span class="cnt">${p.n}</span></button>`).join('')
    + `<hr><form class="newpl"><input placeholder="Новый плейлист" aria-label="Название нового плейлиста"><button class="pill">Создать</button></form>`;
  menuEl.classList.add('live'); mscrim.classList.add('on'); el.addBtn.classList.add('open');
  const b0 = box(el.addBtn), mh = menuEl.offsetHeight, mw = menuEl.offsetWidth;
  menuEl.style.left = clamp(b0.x + 4 - 10, 10, M.W - mw - 10) + 'px';                 // the button sits in the panel's lower left corner
  menuEl.style.top = Math.max(40, b0.y + b0.h - 4 + 10 - mh) + 'px';
  const b = box(el.addBtn), m = box(menuEl);
  mRect = { t: b.y + 4 - m.y, l: b.x + 4 - m.x, r: m.w - (b.x + b.w - 4 - m.x), b: m.h - (b.y + b.h - 4 - m.y) };
  menuOpen = true; mm.done = null; mm.set(1);
  if (!still()) $$('.prow,.newpl', menuIn).forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateY(9px)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: 110 + i * 30, easing: 'cubic-bezier(.22,.9,.3,1)', fill: 'backwards' }));
  for (const row of $$('.prow', menuIn)) row.addEventListener('click', () => addTo(row, PLAYLISTS[+row.dataset.i]));
  $('.newpl', menuIn).addEventListener('submit', (e) => { e.preventDefault(); const name = $('input', e.target).value.trim() || 'Новый плейлист'; closeMenu(); markAdded(name); });
}
function closeMenu() {
  if (!menuOpen) return; menuOpen = false;
  el.addBtn.classList.remove('open'); mscrim.classList.remove('on');
  mm.done = () => { menuEl.classList.remove('live'); };
  mm.set(0);
}
function markAdded(name) {
  const t = cur(); st.added.set(t.id, name); el.addBtn.classList.add('added'); hap('Confirm');
  toast(`Добавлено в «${name}»`, 'Отменить', () => { st.added.delete(t.id); if (cur() === t) el.addBtn.classList.remove('added'); });
}
/* the cover's copy lifts, then flies an arc into the playlist's thumbnail, which swells to take it */
function addTo(row, pl) {
  const mos = $('.mos', row), cnt = $('.cnt', row), a = box(el.stage), b = box(mos);
  const land = () => { mos.classList.add('swell'); setTimeout(() => mos.classList.remove('swell'), 200); cnt.textContent = '✓'; cnt.classList.add('ok'); pl.n++; setTimeout(() => { closeMenu(); markAdded(pl.name); }, 420); };
  if (still()) return land();
  const fly = document.createElement('div'), inner = document.createElement('div');
  fly.className = 'flyer'; fly.style.cssText = `width:${a.w}px;height:${a.h}px;overflow:visible;box-shadow:none`;
  inner.style.cssText = 'width:100%;height:100%;border-radius:10px;overflow:hidden;transform-origin:0 0';
  inner.innerHTML = `<img src="${cur().cover}" alt="">`; fly.append(inner); phone.append(fly);
  const s = b.w / a.w, lift = 180, dur = 640;
  fly.animate([{ transform: `translate(${a.x}px,${a.y}px)` }, { transform: `translate(${a.x}px,${a.y}px)`, offset: lift / (lift + dur), easing: 'cubic-bezier(.3,0,.2,1)' }, { transform: `translate(${b.x}px,${a.y}px)` }], { duration: lift + dur, fill: 'forwards' });
  inner.animate([{ transform: 'translateY(0) scale(1)', opacity: 1 }, { transform: 'translateY(-14px) scale(1.04)', opacity: 1, offset: lift / (lift + dur), easing: 'cubic-bezier(.6,0,.9,.5)' }, { transform: `translateY(${b.y - a.y}px) scale(${s})`, opacity: 1, offset: 0.94 }, { transform: `translateY(${b.y - a.y}px) scale(${s * 0.6})`, opacity: 0 }], { duration: lift + dur, fill: 'forwards' }).onfinish = () => fly.remove();
  press.set(0.965); setTimeout(() => press.set(1), 260);
  setTimeout(land, lift + dur - 90);
}
el.addBtn.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()));
mscrim.addEventListener('click', closeMenu);
