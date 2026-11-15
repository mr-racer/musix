// States of the screen, the review panel, sizing, start.
function setScene(s, dev = 'Гостиная · ПК') {
  st.scene = s; phone.dataset.state = s; $('#rvState').value = s;
  el.empty.hidden = s !== 'empty';
  el.reason.hidden = s !== 'stream';
  el.reasonText.textContent = 'Из твоей волны: рядом с тем, что ты слушал вечером';
  el.shuffle.setAttribute('aria-disabled', s === 'stream');
  el.topMid.innerHTML = s === 'elsewhere' ? `<i class="dot"></i>${esc(dev)}` : (s === 'stream' ? '<i class="dot"></i>Поток' : '') + '<span class="badge">Lossless</span>';
  el.veil.innerHTML = s === 'loading' ? '<span class="loadchip lg on-art"><i class="spin"></i>Загружаю…</span>'
    : s === 'error' ? '<div><b>Не получилось загрузить песню</b>Проверь сеть — и попробуем ещё раз.<br><button class="pill" data-do="retry">Повторить</button></div>'
    : s === 'elsewhere' ? `<div><b>Играет на «${esc(dev)}»</b>Музыка идёт там. Вернуть её сюда — одно касание.<br><button class="pill" data-do="here">Слушать здесь</button></div>` : '';
  if (s === 'long') { const i = st.q.findIndex((x) => T[x.ti].t.length > 20); if (i >= 0 && i !== st.qi) { st.qi = i; st.pos = 12; refill(); } }
  el.lyList.dataset.for = '';
  showTrack();
  markCenter();
  phone.classList.toggle('playing', st.playing && !blocked());
  syncMotion();
}
el.veil.addEventListener('click', (e) => {
  const b = e.target.closest('[data-do]'); if (!b) return;
  hap('Confirm');
  if (b.dataset.do === 'retry') { setScene('loading'); setTimeout(() => { if (st.scene === 'loading') setScene('ready'); }, 1400); } else { setScene('ready'); toast('Играет на этом телефоне'); }
});
el.emptyPlay.addEventListener('click', () => { hap('ToggleOn'); setScene('stream'); setPlaying(true); });

function fit() {
  const narrow = innerWidth <= 760;
  let [W, H] = $('#rvSize').value.split(',').map(Number);
  if (narrow) { W = innerWidth; H = innerHeight; zoom = 1; } else zoom = Math.min(1, (innerHeight - 76) / H);
  phone.style.setProperty('--W', W + 'px'); phone.style.setProperty('--H', H + 'px');
  phone.dataset.size = W <= 380 ? '360' : W >= 440 ? '448' : '412';
  phone.style.transform = zoom < 1 ? `scale(${zoom})` : '';
  phone.style.marginBottom = zoom < 1 ? H * (zoom - 1) + 'px' : '';
  // the cover is as wide as the screen allows and shrinks only when the worst case below it would not fit
  const maxW = W - 24;                                          // 12 dp at the sides: the cover is the hero
  const keep = [el.title.textContent, el.title.className, el.reason.hidden, el.stage.style.transform];
  el.stage.style.transform = ''; el.player.classList.remove('closed');
  phone.style.setProperty('--cover', maxW + 'px'); phone.style.setProperty('--air', '0px'); phone.style.setProperty('--lines', 2);
  // measured on the usual case: a one-line title and two lines of the phrase. A long title or the reason of
  // «Поток» takes a line from the phrase instead of height from the cover, so the cover never changes size.
  el.title.textContent = 'Frozen'; el.title.className = 'title'; el.reason.hidden = true;
  const over = el.pl.scrollHeight - el.pl.clientHeight, spare = $('.grow', el.pl).offsetHeight;
  const cover = Math.round(over > 0 ? maxW - over - 14 : spare < 14 ? maxW - (14 - spare) : maxW);
  [el.title.textContent, el.title.className, el.reason.hidden, el.stage.style.transform] = keep;
  // room that is left goes into a third line of the phrase and into air around the title, not into one hole
  const lines = spare >= 40 ? 3 : 2, air = Math.round(clamp((spare - (lines === 3 ? 22 : 0) - 14) / 3, 0, 12));
  phone.style.setProperty('--cover', cover + 'px'); phone.style.setProperty('--air', air + 'px'); phone.style.setProperty('--lines', lines);
  M = { W, H, cover, step: cover + 26, seekW: el.seek.offsetWidth, lines };
  layoutNow(); drawSeek(true); if (secs[secI]) nameSection(secI, true);
  lensTo($(`[data-mode=${st.mode}]`, el.modes), true);
  if (st.mode === 'sound') buildSound(false);
  if (st.mode === 'text') lyricAt(true);
  showSlot();
  fold.a = null; if (fold.p.v > 0) { fold.measure(); fold.draw(fold.p.v); }
}

$('#rvTheme').addEventListener('change', (e) => { phone.dataset.theme = e.target.value; showTrack(); });
$('#rvSize').addEventListener('change', fit);
$('#rvState').addEventListener('change', (e) => setScene(e.target.value));
$('#rvQueue').addEventListener('change', (e) => {
  const n = +e.target.value, first = st.q[st.qi].ti;
  st.q = Array.from({ length: n }, (_, i) => ({ k: 'q' + keyN++, ti: (first + i) % T.length })); st.qi = 0;
  if (sh.kind) closeSheet();
  refill(); showTrack();
});
$('#rvTurn').addEventListener('change', (e) => setTurn(e.target.value));
$('#rvLyrics').addEventListener('change', (e) => { st.lyrics = e.target.value; el.lyList.dataset.for = ''; if (st.mode === 'text') { buildLyrics(); lyricAt(true); } else setMode('text'); });
$('#rvViz').addEventListener('change', (e) => { st.viz = e.target.value; if (st.mode === 'sound') buildSound(true); else if (snd()) setMode('sound'); });
$('#rvMotion').addEventListener('change', (e) => phone.classList.toggle('still', !e.target.checked));
$('#rvOpen').addEventListener('click', () => { fold.measure(); fold.to(fold.p.to < 0.5); });
$('#rvHints').addEventListener('click', () => { try { localStorage.removeItem('mx-player-hint'); } catch (e) { /* private mode */ } showHint(); });
document.addEventListener('keydown', (e) => { if (e.key === ' ' && !e.target.closest('input,button,select,[role=tab],[role=slider]')) { e.preventDefault(); togglePlay(true); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) amp.snap(0); else syncMotion(); });
addEventListener('resize', fit);

async function start() {
  await Promise.all(T.map(bake));                            // out-of-focus covers are drawn once, up front
  paintIcons();
  warmBackdrops();
el.sidePP.innerHTML = el.miniPlay.innerHTML = PAUSE;
fit();
setTurn('page');
refill();
setScene('ready');
setPlaying(true);
fold.draw(0);
showHint();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
}
start();
