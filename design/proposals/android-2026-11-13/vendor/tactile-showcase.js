"use strict";
/* The gallery: one card per component. Data is invented; colours stand in for the server palette. */

const el = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const fmt = s => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const ease = () => cssVar("--spring") || "ease-out";

/* ---------- covers, drawn once ---------- */
const hexA = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
function drawCover(pal, k, n = 400) {
  const c = document.createElement("canvas"); c.width = c.height = n; const g = c.getContext("2d");
  g.fillStyle = pal[2]; g.fillRect(0, 0, n, n);
  const blob = (x, y, r, col, a) => { const gr = g.createRadialGradient(x * n, y * n, 0, x * n, y * n, r * n); gr.addColorStop(0, hexA(col, a)); gr.addColorStop(1, hexA(col, 0)); g.fillStyle = gr; g.fillRect(0, 0, n, n); };
  blob(.28, .22, .85, pal[0], .8); blob(.85, .85, .75, pal[1], .75);
  g.lineWidth = n * .012; g.strokeStyle = "rgba(255,255,255,.22)"; g.fillStyle = "rgba(255,255,255,.9)";
  if (k === 0) for (let r = .08; r < .7; r += .07) { g.beginPath(); g.arc(n * .5, n * .62, r * n, 0, Math.PI * 2); g.stroke(); }
  if (k === 1) { g.save(); g.rotate(-.5); for (let x = -n; x < n * 2; x += n * .07) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, n * 2); g.stroke(); } g.restore(); }
  if (k === 2) { g.fillStyle = hexA(pal[1], .95); g.beginPath(); g.arc(n * .5, n * .45, n * .24, 0, Math.PI * 2); g.fill(); g.fillStyle = pal[2]; g.fillRect(0, n * .62, n, n); blob(.5, .9, .5, pal[0], .5); }
  if (k === 3) { g.globalCompositeOperation = "screen"; [[.38, .42, pal[0]], [.62, .42, pal[1]], [.5, .62, "#ffffff"]].forEach(([x, y, col]) => { g.fillStyle = hexA(col, .55); g.beginPath(); g.arc(x * n, y * n, n * .22, 0, Math.PI * 2); g.fill(); }); g.globalCompositeOperation = "source-over"; }
  if (k === 4) { for (let y = .14; y < .95; y += .09) for (let x = .14; x < .95; x += .09) { g.globalAlpha = .25 + .6 * Math.abs(Math.sin(x * 7 + y * 5)); g.beginPath(); g.arc(x * n, y * n, n * .012, 0, Math.PI * 2); g.fill(); } g.globalAlpha = 1; }
  if (k === 5) { g.fillStyle = hexA(pal[0], .9); g.beginPath(); g.ellipse(n * .5, n, n * .36, n * .62, 0, Math.PI, 0); g.fill(); }
  if (k === 6) { const sky = g.createLinearGradient(0, 0, 0, n); sky.addColorStop(0, hexA(pal[1], .9)); sky.addColorStop(.7, hexA(pal[0], .6)); sky.addColorStop(1, pal[2]); g.fillStyle = sky; g.fillRect(0, 0, n, n); g.fillStyle = "#fff"; g.beginPath(); g.arc(n * .5, n * .66, n * .09, 0, Math.PI * 2); g.fill(); g.fillStyle = pal[2]; g.fillRect(0, n * .68, n, n); }
  const img = g.getImageData(0, 0, n, n), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = (Math.random() - .5) * 16; d[i] += v; d[i + 1] += v; d[i + 2] += v; }
  g.putImageData(img, 0, 0);
  return c;
}
function blurred(src, out = 256) {   // the product gets this baked by the server
  const b = document.createElement("canvas"); b.width = b.height = out; const g = b.getContext("2d");
  if ("filter" in CanvasRenderingContext2D.prototype) { g.filter = "blur(16px) saturate(1.2)"; g.drawImage(src, -48, -48, out + 96, out + 96); }
  else { let c = document.createElement("canvas"); c.width = c.height = 16; c.getContext("2d").drawImage(src, 0, 0, 16, 16);
    for (let s = 32; s <= out; s *= 2) { const n = document.createElement("canvas"); n.width = n.height = s; const x = n.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, s, s); c = n; } g.drawImage(c, 0, 0); }
  return b.toDataURL("image/jpeg", .9);
}
const T = [
  ["Тёплый шум", "Лес и Город", 243, ["#ff8a5c", "#ffd36e", "#2a1720"], 2],
  ["Медленный свет", "Оранжерея", 201, ["#ff6fa8", "#ffb38a", "#2b1028"], 3],
  ["Ночные трамваи", "Кварталы", 256, ["#9b8cff", "#5ad1ff", "#141228"], 4],
  ["Глина", "Мастерская", 178, ["#e0b070", "#e86f4a", "#1f1610"], 5],
  ["Круги на воде", "Лес и Город", 222, ["#58e0c2", "#5b7cff", "#0d1630"], 0],
  ["Косой дождь", "Кварталы", 205, ["#a7f0ff", "#7d8bff", "#101a2e"], 1],
].map(([t, a, d, pal, k]) => { const c = drawCover(pal, k); return { t, a, d, pal, cover: c.toDataURL("image/jpeg", .86), blur: blurred(c) }; });
const ALBUM_ART = drawCover(["#7fd6ff", "#c6b6ff", "#0c1426"], 6).toDataURL("image/jpeg", .86);

/* play / pause morph paths (graphics-shapes Morph on Android) */
const PLAY_Q = [[[7, 4], [13.5, 7.75], [13.5, 16.25], [7, 20]], [[13.5, 7.75], [20, 12], [20, 12], [13.5, 16.25]]];
const PAUSE_Q = [[[6, 5], [10.5, 5], [10.5, 19], [6, 19]], [[13.5, 5], [18, 5], [18, 19], [13.5, 19]]];
const quad = (k, t) => "M" + PLAY_Q[k].map((p, i) => `${lerp(p[0], PAUSE_Q[k][i][0], t).toFixed(2)} ${lerp(p[1], PAUSE_Q[k][i][1], t).toFixed(2)}`).join(" L") + " Z";
const ICON = '<svg viewBox="0 0 24 24"><path/><path/></svg>';
function morpher(svgs, opts = {}) {
  return createSpring({ value: 0, stiffness: opts.stiffness || 520, damping: opts.damping || 26, precision: 0.001, name: "morph", onUpdate: v => {
    const t = Math.max(-0.08, Math.min(1.08, v));
    svgs.forEach(s => { const [l, r] = s.querySelectorAll("path"); l.setAttribute("d", quad(0, t)); r.setAttribute("d", quad(1, t)); });
  } });
}

/* ---------- toasts inside a stage ---------- */
function toaster(host) {
  const list = [];
  const layout = () => list.forEach((t, i) => { t.el.style.zIndex = String(10 - i); t.el.style.transform = `translate(-50%, ${-i * 9}px) scale(${1 - i * .05})`; t.el.style.opacity = String(i === 0 ? 1 : .7 - i * .15); });
  return function toast(text, action, onAction) {
    const e = el(`<div class="toast${action ? "" : " solo"}"><span>${text}</span>${action ? `<button type="button">${action}</button>` : ""}</div>`);
    host.append(e); const item = { el: e, timer: 0 };
    item.close = () => { clearTimeout(item.timer); const i = list.indexOf(item); if (i < 0) return; list.splice(i, 1); layout(); e.style.pointerEvents = "none";
      e.animate([{ opacity: 1 }, { opacity: 0, transform: e.style.transform + " translateY(14px)" }], { duration: 190, easing: "ease-in" }).onfinish = () => e.remove(); };
    if (action) e.querySelector("button").addEventListener("click", () => { onAction && onAction(); item.close(); });
    let sy = null;
    e.addEventListener("pointerdown", ev => { sy = ev.clientY; clearTimeout(item.timer); try { e.setPointerCapture(ev.pointerId); } catch (_) {} });
    e.addEventListener("pointermove", ev => { if (sy !== null) e.style.translate = `0 ${Math.max(0, ev.clientY - sy)}px`; });
    e.addEventListener("pointerup", ev => { if (sy === null) return; const dy = ev.clientY - sy; sy = null; e.style.translate = ""; dy > 30 ? item.close() : (item.timer = setTimeout(item.close, 3500)); });
    e.addEventListener("pointercancel", () => { sy = null; e.style.translate = ""; item.timer = setTimeout(item.close, 3500); });
    list.unshift(item); while (list.length > 3) list[list.length - 1].close();
    e.style.transform = "translate(-50%, 24px) scale(.96)"; e.style.opacity = "0"; e.getBoundingClientRect(); layout();
    item.timer = setTimeout(item.close, 3500);
  };
}

/* =====================================================================
   The cards
   ===================================================================== */
const CARDS = [
/* ---------------- take ---------------- */
{ id: "haptics", tag: "take", name: "Вибрация: словарь",
  what: "Не компонент, а основа: девять типов, каждый 1:1 с HapticFeedbackType в Compose. Потрогайте каждый, и проведите пальцем по полосе — так ощущается тик.",
  where: [["Android", "все жесты из карточек ниже, через один слой Haptics в core/designsystem"], ["Web", "не нужно: телефон закрывает Android, на компьютере вибрации нет"]],
  haptic: "Тишина для обычных тапов, листания, ввода цифр и всего, что случилось без пальца (скачалось, ответил ассистент). Тики не чаще 45 мс, один и тот же тип не повторяется в 120 мс. Уважаем системную настройку «Отклик на касание».",
  cost: "Ноль: без анимаций.", src: "Compose UI 1.8+, своё",
  demo(s) {
    const NAMES = { tick: "Тик", toggleOn: "Включить", toggleOff: "Выключить", threshold: "Порог пройден", thresholdOff: "Порог отпущен", lift: "Поднять", drop: "Отпустить", confirm: "Готово", reject: "Нельзя" };
    const box = el(`<div class="col"><div class="hpal"></div><div class="ticks">${"<i></i>".repeat(10)}<span>ведите пальцем — тик на каждой черте</span></div></div>`);
    Object.keys(NAMES).forEach(k => { const b = el(`<button type="button"><b>${NAMES[k]}</b><small>${HAPTICS[k].android}</small></button>`); b.addEventListener("click", () => haptic(k)); box.firstElementChild.append(b); });
    const strip = box.querySelector(".ticks"), cells = [...strip.querySelectorAll("i")]; let down = false, last = -1;
    const at = x => { const r = strip.getBoundingClientRect(); return Math.max(0, Math.min(9, Math.floor((x - r.left) / r.width * 10))); };
    const mark = i => { if (i === last) return; if (last >= 0) haptic("tick"); last = i; cells.forEach((c, k) => c.classList.toggle("on", k === i)); };
    strip.addEventListener("pointerdown", e => { down = true; last = -1; try { strip.setPointerCapture(e.pointerId); } catch (_) {} mark(at(e.clientX)); });
    strip.addEventListener("pointermove", e => { if (down) mark(at(e.clientX)); });
    const up = () => { down = false; cells.forEach(c => c.classList.remove("on")); };
    strip.addEventListener("pointerup", up); strip.addEventListener("pointercancel", up);
    s.append(box);
  } },

{ id: "richbox", tag: "take", name: "Richbox — статус скачивания",
  what: "Один значок, десять состояний: не скачано, в очереди, прогресс заливкой, готово, ошибка. Переход всегда идёт с текущего кадра — прерванная анимация не дёргается.",
  where: [["Android", "скачивание песни и альбома на телефон (офлайн — новая фича): в строках, на развороте альбома, в «На телефоне»"], ["Web", "загрузка и импорт: прогресс каждого файла (этап 7, требование фазы 5)"], ["Оба", "статус шага ассистента — см. «Шаги ассистента»"]],
  haptic: "Тап «скачать» — ToggleOn, «отменить» — ToggleOff. Готово и ошибка — без вибрации: это случилось без пальца.",
  cost: "Анимация только 350–550 мс при смене состояния. «В очереди» поворачивается раз в 1,3 с и между поворотами спит.", src: "mishanaer/richbox, MIT · порт Richbox.kt готов",
  demo(s) {
    const box = el(`<div class="col"><div class="list"></div><div class="btnrow states"></div></div>`);
    const list = box.querySelector(".list");
    T.slice(0, 4).forEach((t, i) => {
      const r = el(`<div class="row"><img src="${t.cover}" alt=""><div class="t"><b>${t.t}</b><small>${i === 2 ? "упадёт с ошибкой" : t.a}</small></div><span class="d">${fmt(t.d)}</span><button class="rbbtn" aria-label="Скачать"></button></div>`);
      list.append(r);
      const st = { s: i === 1 ? "done" : "dashed", fail: i === 2, timers: [] };
      const rb = createRichbox(r.querySelector(".rbbtn"), 22, st.s);
      const set = v => { st.s = v; rb.setState(v); };
      const clear = () => { st.timers.forEach(clearTimeout); st.timers = []; };
      r.querySelector(".rbbtn").addEventListener("click", () => {
        if (st.s === "done") { haptic("toggleOff"); set("cancelled"); st.timers.push(setTimeout(() => set("dashed"), 700)); return; }
        if (st.s === "waiting" || st.s.startsWith("progress")) { clear(); haptic("toggleOff"); set("cancelled"); st.timers.push(setTimeout(() => set("dashed"), 800)); return; }
        haptic("toggleOn"); clear(); set("waiting");
        const seq = st.fail ? ["progress-25", "progress-50", "error"] : ["progress-25", "progress-50", "progress-75", "done"];
        seq.forEach((v, k) => st.timers.push(setTimeout(() => { if (v === "error") st.fail = false; set(v); }, 1100 + k * 650)));
      });
    });
    const big = el(`<div style="display:flex;align-items:center;gap:14px"><span class="bigrb"></span><small style="color:var(--mx-subtle);font-size:12px">все состояния:</small></div>`);
    const rbBig = createRichbox(big.querySelector(".bigrb"), 40, "dashed");
    const names = ["Не скачано", "В очереди", "Пусто", "25 %", "50 %", "75 %", "Готово", "Отменено", "Ошибка", "Внимание"];
    const row = box.querySelector(".states"); row.before(big);
    RB_STATES.forEach((st, i) => { const b = el(`<button class="sbtn" type="button">${names[i]}</button>`); b.addEventListener("click", () => { rbBig.setState(st); row.querySelectorAll(".sbtn").forEach(x => x.setAttribute("aria-pressed", String(x === b))); }); row.append(b); });
    s.append(box);
  } },

{ id: "sheet", tag: "take", name: "Мини-плеер → плеер",
  what: "Потяните мини-плеер вверх или тапните. Обложка летит из мини-плеера и растёт, шторка пружинит и учитывает скорость пальца: короткий быстрый свайп тоже закрывает.",
  where: [["Android", "главный переход плеера: SharedTransitionLayout + AnchoredDraggable"], ["Web", "не нужно: у web свой одобренный «перелёт обложки»"]],
  haptic: "Прошли точку, после которой экран откроется или закроется, — GestureThresholdActivate; вернули палец назад — GestureThresholdDeactivate. Сам тап — тихо.",
  cost: "Только transform и opacity. Пока шторка стоит — ни одного цикла. Фон — готовая размытая картинка.", src: "Compose foundation + animation, своё",
  demo(s) {
    const t = T[0];
    const f = el(`<div class="frame">
      <div class="fake">${"<i></i>".repeat(14)}</div>
      <div class="mini" role="button" tabindex="0" aria-label="Открыть плеер"><img src="${t.cover}" alt=""><div style="min-width:0"><b>${t.t}</b><small>${t.a}</small></div><button class="ibtn mplay" aria-label="Играть">${ICON.replace("<svg", '<svg width="24" height="24" fill="currentColor"')}</button><span class="bar"><i style="transform:scaleX(.18)"></i></span></div>
      <section class="player" aria-hidden="true"><div class="pback"><div class="bg" style="background-image:url(${t.blur})"></div></div>
        <div class="pin"><span class="grabber"></span><div class="coverstage"><div class="cover" style="transform:none"><img src="${t.cover}" alt=""></div></div>
          <div class="ptitle"><h2>${t.t}</h2><a href="#" onclick="return false">${t.a}</a></div>
          <div class="controls"><button class="playbtn" aria-label="Играть">${ICON}</button></div></div></section></div>`);
    s.style.padding = "16px 10px"; s.append(f);
    const mini = f.querySelector(".mini"), miniArt = mini.querySelector("img"), player = f.querySelector(".player"), pback = f.querySelector(".pback"), pin = f.querySelector(".pin"), stage = f.querySelector(".coverstage"), cover = f.querySelector(".cover");
    const m = morpher([mini.querySelector("svg"), f.querySelector(".playbtn svg")]); let on = false;
    const toggle = e => { e && e.stopPropagation(); on = !on; m.to(on ? 1 : 0); f.querySelector(".playbtn").style.borderRadius = on ? "24px" : ""; haptic(on ? "toggleOn" : "toggleOff"); };
    mini.querySelector(".mplay").addEventListener("click", toggle); mini.querySelector(".mplay").addEventListener("pointerdown", e => e.stopPropagation());
    f.querySelector(".playbtn").addEventListener("click", toggle);
    let y0 = 0, C, M;
    const measure = () => { C = { left: stage.offsetLeft, top: stage.offsetTop, w: stage.offsetWidth }; M = { left: mini.offsetLeft + miniArt.offsetLeft, top: mini.offsetTop + miniArt.offsetTop, w: miniArt.offsetWidth }; };
    const render = y => {
      y0 = y; const H = f.clientHeight, p = clamp01(1 - y / H); if (!C) measure();
      const tr = `translate3d(0, ${y.toFixed(1)}px, 0)`; pback.style.transform = tr; pin.style.transform = tr;
      const sc = lerp(M.w / C.w, 1, p);
      stage.style.transform = `translate3d(${(lerp(M.left, C.left, p) - C.left).toFixed(1)}px, ${(lerp(M.top, C.top, p) - (C.top + y)).toFixed(1)}px, 0) scale(${sc.toFixed(4)})`;
      cover.style.borderRadius = `${lerp(9 / (M.w / C.w), 14, p).toFixed(1)}px`;
      pin.style.setProperty("--f", clamp01((p - .4) / .45).toFixed(3));
      mini.style.opacity = clamp01(1 - p * 3).toFixed(3); mini.style.pointerEvents = p > .3 ? "none" : "";
      miniArt.style.visibility = p > .002 ? "hidden" : "visible"; player.style.visibility = p < .002 ? "hidden" : "visible";
    };
    const sp = createSpring({ value: 2000, stiffness: 400, damping: 38, precision: .5, name: "playerSheet", onUpdate: render });
    const open = (v = 0) => { measure(); sp.to(0, { velocity: v }); }, close = (v = 0) => sp.to(f.clientHeight, { velocity: v });
    requestAnimationFrame(() => { measure(); sp.set(f.clientHeight); });
    const vy = tracker(); let base = 0, passed = false;
    dragGesture(pin, {
      canStart: e => !e.target.closest("button, a"),
      onStart: st => { base = y0; vy.reset(); passed = false; },
      onMove: (st, dx, dy) => { if (st.axis !== "y") return; let y = base + dy; if (y < 0) y = -Math.pow(-y, .7); sp.set(y); vy.add(y); const o = y > f.clientHeight * .22; if (o !== passed) { passed = o; haptic(o ? "threshold" : "thresholdOff"); } },
      onEnd: st => { if (st.axis !== "y") return; const v = vy.vel(); (y0 > f.clientHeight * .22 || v > 700) && v > -300 ? close(v) : open(v); },
    });
    let mp = false;
    dragGesture(mini, {
      onStart: () => { measure(); vy.reset(); mp = false; },
      onMove: (st, dx, dy) => { if (st.axis !== "y") return; const H = f.clientHeight, y = Math.min(H, H + dy); sp.set(y); vy.add(y); const o = y < H * .8; if (o !== mp) { mp = o; haptic(o ? "threshold" : "thresholdOff"); } },
      onEnd: st => { if (st.axis !== "y") return; const v = vy.vel(); y0 < f.clientHeight * .8 || v < -500 ? open(v) : close(v); },
      onTap: () => open(),
    });
  } },

{ id: "morph", tag: "take", name: "Play ↔ пауза меняет форму",
  what: "Треугольник перетекает в две полоски, круг становится скруглённым квадратом, при нажатии кнопка проседает. Маленькая иконка повторяет большую.",
  where: [["Android", "плеер и мини-плеер (graphics-shapes: RoundedPolygon + Morph)"], ["Web", "кнопка плеера и ▶ на карточках альбомов — SVG-интерполяция, без библиотек"]],
  haptic: "ToggleOn на «играть», ToggleOff на «пауза».", cost: "Одна пружина ~400 мс на нажатие, потом тишина.", src: "своё, математика из прототипа",
  demo(s) {
    const box = el(`<div class="col"><div class="morph"><button class="playbtn" aria-label="Играть">${ICON}</button><span class="tiny">${ICON}</span></div><div class="btnrow"><button class="sbtn slow" type="button" aria-pressed="false">Замедлить ×4</button></div></div>`);
    let m = morpher([...box.querySelectorAll("svg")]), on = false, slow = false;
    box.querySelector(".playbtn").addEventListener("click", () => { on = !on; m.to(on ? 1 : 0); box.querySelector(".morph").classList.toggle("playing", on); haptic(on ? "toggleOn" : "toggleOff"); });
    box.querySelector(".slow").addEventListener("click", e => { slow = !slow; e.currentTarget.setAttribute("aria-pressed", String(slow)); m.stiffness = slow ? 33 : 520; m.damping = slow ? 6.5 : 26; box.querySelector(".playbtn").style.transitionDuration = slow ? "1.6s" : ""; });
    s.append(box);
  } },

{ id: "swipe", tag: "take", name: "Обложка: листать и пауза",
  what: "Листайте обложку влево и вправо — она наклоняется и улетает на пружине с вашей скоростью. Тап — пауза: обложка размывается и чуть растёт, появляется стеклянная пауза.",
  where: [["Android", "плеер на телефоне: «предыдущая / следующая на обложке» — вы этого просили; пауза тапом по обложке — фирменное движение"], ["Web", "не нужно: на компьютере обложка наклоняется за курсором"]],
  haptic: "Палец прошёл порог смены песни — ThresholdActivate, вернулся — Deactivate. Пауза / игра — ToggleOff / ToggleOn.",
  cost: "transform + opacity. Размытие — заранее готовая картинка (на сервере уже печётся), а не blur-фильтр в кадре.", src: "Compose HorizontalPager + graphicsLayer, своё",
  demo(s) {
    const box = el(`<div class="col swipe paused"><div class="coverstage"><div class="cover"><img class="a" alt=""><img class="blurred b" alt=""><span class="dim"></span><span class="pausemark lg"><svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg></span></div></div><div class="meta"><b></b><small></small></div></div>`);
    s.append(box);
    const stage = box.querySelector(".coverstage"), cover = box.querySelector(".cover");
    let i = 0, x = 0, sc = 1.03, playing = false;
    const show = () => { const t = T[i]; box.querySelector(".a").src = t.cover; box.querySelector(".b").src = t.blur; swapTxt(box.querySelector("b"), t.t); swapTxt(box.querySelector("small"), t.a); };
    const draw = () => { const W = stage.clientWidth || 250, k = x / W; cover.style.transform = `translateX(${x.toFixed(1)}px) rotateY(${(k * 26).toFixed(2)}deg) scale(${(sc * (1 - Math.min(.1, Math.abs(k) * .12))).toFixed(4)})`; };
    const xs = createSpring({ value: 0, stiffness: 300, damping: 28, precision: .3, name: "coverSwipe", onUpdate: v => { x = v; draw(); } });
    const ss = createSpring({ value: 1.03, stiffness: 260, damping: 20, precision: .0005, name: "coverPause", onUpdate: v => { sc = v; draw(); } });
    const go = (dir, v = 0) => { const W = stage.clientWidth + 80; xs.to(-dir * W, { velocity: v, onRest: () => { xs.onRest = null; i = (i + dir + T.length) % T.length; show(); xs.set(dir * W); xs.to(0); } }); };
    const vx = tracker(); let crossed = 0;
    dragGesture(stage, {
      onStart: st => { vx.reset(); crossed = 0; if (st.axis !== "x") st.axis = "none"; },
      onMove: (st, dx) => { if (st.axis !== "x") return; xs.set(dx); vx.add(dx); const W = stage.clientWidth, c = dx < -W * .28 ? -1 : dx > W * .28 ? 1 : 0; if (c !== crossed) { haptic(c ? "threshold" : "thresholdOff"); crossed = c; } },
      onEnd: (st, dx) => { if (st.axis !== "x") return; const v = vx.vel(), W = stage.clientWidth; if (dx < -W * .28 || v < -650) go(1, v); else if (dx > W * .28 || v > 650) go(-1, v); else xs.to(0, { velocity: v }); },
      onTap: () => { playing = !playing; box.classList.toggle("paused", !playing); ss.to(playing ? 1 : 1.03); haptic(playing ? "toggleOn" : "toggleOff"); },
    });
    stage.style.touchAction = "pan-y";
    show();
  } },

{ id: "queue", tag: "take", name: "Очередь: переставить и смахнуть",
  what: "Тяните за ⠿ — строка поднимается, соседи расступаются. Смахните строку влево — уберётся, с кнопкой «Вернуть». Песню, которая играет (первая), убрать нельзя.",
  where: [["Android", "очередь и плейлисты (Calvin-LL/Reorderable 3.1)"], ["Web", "перестановка мышью в плейлисте; смахивание не нужно"]],
  haptic: "Поднять — LongPress, прошёл соседа — SegmentTick, отпустил — GestureEnd. Смахивание за порог — ThresholdActivate. Попытка убрать играющую — Reject.",
  cost: "Двигаются только строки, которые меняют место; transform на композиторе.", src: "Reorderable, Apache-2.0",
  demo(s) {
    s.style.display = "block"; s.style.padding = "8px 4px 30px";
    const q = T.slice(0, 5); const body = el(`<div class="q"></div>`); const host = el(`<div class="toasts"></div>`); s.append(body, host);
    const toast = toaster(host), ROW = 58;
    const render = () => { body.innerHTML = ""; q.forEach((t, i) => { const r = el(`<div class="qrow${i === 0 ? " now" : ""}"><div class="del">Убрать</div><div class="in"><img src="${t.cover}" alt=""><div style="min-width:0"><b>${t.t}</b><small>${i === 0 ? "играет" : t.a}</small></div><span class="handle" aria-label="Переставить"><svg class="i"><use href="#i-grip"/></svg></span></div></div>`); body.append(r); wire(r, i); }); };
    function wire(r, i) {
      const inn = r.querySelector(".in"), handle = r.querySelector(".handle"), del = r.querySelector(".del");
      handle.addEventListener("pointerdown", e => {
        e.preventDefault(); const rows = [...body.children], y0 = e.clientY; let target = i;
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
        r.classList.add("lift"); haptic("lift"); inn.style.transition = "transform 160ms var(--mx-ease-standard)"; inn.style.transform = "scale(1.03)";
        rows.forEach((o, k) => { if (k !== i) o.style.transition = "transform 280ms var(--spring)"; });
        const move = ev => { const dy = ev.clientY - y0; inn.style.transition = "none"; inn.style.transform = `translateY(${dy}px) scale(1.03)`;
          const t = Math.max(0, Math.min(rows.length - 1, Math.round(i + dy / ROW)));
          if (t !== target) { target = t; haptic("tick"); rows.forEach((o, k) => { if (k === i) return; o.style.transform = `translateY(${(k > i && k <= t) ? -ROW : (k < i && k >= t) ? ROW : 0}px)`; }); } };
        const up = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up);
          inn.style.transition = "transform 320ms var(--spring)"; inn.style.transform = `translateY(${(target - i) * ROW}px)`; haptic("drop");
          setTimeout(() => { const [m] = q.splice(i, 1); q.splice(target, 0, m); render(); }, 330); };
        handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
      });
      let sx = null, sy = 0, sw = false, over = false;
      inn.addEventListener("pointerdown", e => { if (e.target.closest(".handle")) return; sx = e.clientX; sy = e.clientY; sw = false; over = false; });
      inn.addEventListener("pointermove", e => {
        if (sx === null) return; const dx = e.clientX - sx, dy = e.clientY - sy;
        if (!sw) { if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.4) { sw = true; try { inn.setPointerCapture(e.pointerId); } catch (_) {} } else if (Math.abs(dy) > 8) { sx = null; return; } else return; }
        const xx = Math.min(0, dx); inn.style.transition = "none"; inn.style.transform = `translateX(${xx}px)`; del.style.transition = "none"; del.style.opacity = clamp01(-xx / 70).toFixed(2);
        const o = -xx > r.offsetWidth * .38; if (o !== over) { over = o; haptic(o ? "threshold" : "thresholdOff"); }
      });
      const end = () => {
        if (sx === null) return; sx = null; if (!sw) return;
        if (over && i === 0) { haptic("reject"); toast("Сейчас играет — не убрать"); }
        if (over && i !== 0) {
          inn.style.transition = "transform 200ms ease-in"; inn.style.transform = `translateX(${-r.offsetWidth}px)`;
          r.animate([{ height: ROW + "px" }, { height: "0px" }], { duration: 220, delay: 160, easing: "ease-in", fill: "forwards" }).onfinish = () => {
            const [gone] = q.splice(i, 1); render(); toast(`Убрали «${gone.t}»`, "Вернуть", () => { q.splice(Math.min(i, q.length), 0, gone); render(); }); };
        } else { inn.style.transition = "transform 380ms var(--spring)"; inn.style.transform = ""; del.style.transition = "opacity 200ms"; del.style.opacity = "0"; }
      };
      inn.addEventListener("pointerup", end); inn.addEventListener("pointercancel", end);
    }
    render();
  } },

{ id: "fluid", tag: "take", name: "Текучая подсветка",
  what: "Подсветка перетекает между пунктами вслед за пальцем или курсором, а не прыгает. Сегменты: ведите пальцем. Меню: наведите курсор или ведите пальцем, отпустите на нужном.",
  where: [["Web", "меню «В плейлист», переключатель сортировки в библиотеке (вы просили «мягче»), вкладки — принцип «отвечает на наведение до клика»"], ["Android", "сегменты (Альбомы / Плейлисты / На телефоне)"]],
  haptic: "Сегменты: SegmentTick, когда палец переехал на соседний. Меню — без вибрации (на компьютере её нет, на телефоне меню редкость).",
  cost: "Одна CSS-пружина на transform при смене пункта.", src: "идея и пружины Fluid Functionalism (MIT), код свой",
  demo(s) {
    const box = el(`<div class="col"><div class="seg" role="tablist" style="width:100%"><span class="hl" aria-hidden="true"></span><button role="tab" aria-selected="true">Часто</button><button role="tab" aria-selected="false">Недавно</button><button role="tab" aria-selected="false">А–Я</button><button role="tab" aria-selected="false">Год</button></div>
      <div class="fmenu"><div class="cap">В плейлист</div><span class="fh"></span>${T.slice(0, 4).map((t, i) => `<button type="button"><img src="${t.cover}" alt=""><span>${["Вечер", "Дорога", "Фокус", "Субботнее"][i]}</span><small>${[42, 118, 27, 63][i]}</small></button>`).join("")}</div></div>`);
    s.append(box);
    const seg = box.querySelector(".seg"), hl = seg.querySelector(".hl"), btns = [...seg.querySelectorAll("button")];
    let sel = 0, over = 0, down = false, moved = false, x0 = 0;
    const place = i => { hl.style.width = btns[i].offsetWidth + "px"; hl.style.transform = `translateX(${btns[i].offsetLeft}px)`; };
    const idx = x => { const r = seg.getBoundingClientRect(); return Math.max(0, Math.min(btns.length - 1, Math.floor((x - r.left - 3) / ((r.width - 6) / btns.length)))); };
    const select = i => { sel = i; btns.forEach((b, k) => b.setAttribute("aria-selected", String(k === i))); place(i); };
    seg.addEventListener("pointerdown", e => { down = true; moved = false; x0 = e.clientX; over = idx(e.clientX); try { seg.setPointerCapture(e.pointerId); } catch (_) {} });
    seg.addEventListener("pointermove", e => { if (!down) return; if (!moved && Math.abs(e.clientX - x0) > 6) { moved = true; seg.classList.add("dragging"); } if (!moved) return; const i = idx(e.clientX); if (i !== over) { over = i; place(i); haptic("tick"); } });
    const up = e => { if (!down) return; down = false; seg.classList.remove("dragging"); select(e.type === "pointercancel" ? sel : idx(e.clientX)); };
    seg.addEventListener("pointerup", up); seg.addEventListener("pointercancel", up);
    new ResizeObserver(() => { hl.style.transition = "none"; place(sel); hl.getBoundingClientRect(); hl.style.transition = ""; }).observe(seg);
    const menu = box.querySelector(".fmenu"), fh = menu.querySelector(".fh"), items = [...menu.querySelectorAll("button")];
    let first = true, pressed = false;
    const hover = it => { if (!it) { menu.classList.remove("on"); first = true; return; } if (first) { fh.style.transition = "opacity 180ms"; first = false; } else fh.style.transition = ""; fh.style.transform = `translateY(${it.offsetTop}px)`; menu.classList.add("on"); };
    const itemAt = (x, y) => items.find(b => { const r = b.getBoundingClientRect(); return y >= r.top && y < r.bottom && x >= r.left && x <= r.right; });
    menu.addEventListener("pointermove", e => { if (e.pointerType === "mouse" || pressed) hover(itemAt(e.clientX, e.clientY)); });
    menu.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") hover(null); });
    menu.addEventListener("pointerdown", e => { pressed = true; try { menu.setPointerCapture(e.pointerId); } catch (_) {} hover(itemAt(e.clientX, e.clientY)); });
    const mup = e => { if (!pressed) return; pressed = false; const it = itemAt(e.clientX, e.clientY); if (it && e.type === "pointerup") { it.animate([{ transform: "scale(.98)" }, { transform: "none" }], { duration: 300, easing: ease() }); } if (e.pointerType !== "mouse") setTimeout(() => hover(null), 260); };
    menu.addEventListener("pointerup", mup); menu.addEventListener("pointercancel", mup);
    select(0);
  } },

/* ---------------- after a mock ---------------- */
{ id: "joipro", tag: "mock", name: "JoiPro — не «Pro», а событие",
  what: "Баннер-суперэллипс в цветах обложки: при нажатии он проседает, кнопка разбухает, внутри поднимается пыль — вспышкой при появлении и касании, потом холст засыпает.",
  where: [["Android", "главная: «Ещё не слушали» — неслушанный альбом (вам нравится геймификация неслушанного); статистика: новая ачивка"], ["Web", "те же места: главная и ачивки (Achievements.tsx). Промо-баннер Android в настройках уже одобрен — его не трогаем"]],
  haptic: "Кнопка на баннере — Confirm. Касание самого баннера — тихо.",
  cost: "Canvas с ~28 частицами только 1,5–2,5 с после появления или касания, затем 0 кадров. Блик по ободку (выключен) крутился бы постоянно.", src: "mishanaer/joipro, MIT · порт JoiPro.kt готов",
  demo(s) {
    const box = el(`<div class="col"><div class="jph" style="width:100%"></div><div class="btnrow"><button class="sbtn v" type="button" aria-pressed="true" data-v="album">Неслушанный альбом</button><button class="sbtn v" type="button" aria-pressed="false" data-v="ach">Ачивка</button><button class="sbtn sh" type="button" aria-pressed="false">Блик (запрещён правилом)</button></div></div>`);
    s.append(box);
    let jp, v = "album", shine = false; const toast = toaster(s.appendChild(el(`<div class="toasts"></div>`)));
    const mount = () => {
      jp = v === "album"
        ? createJoiPro(box.querySelector(".jph"), { kicker: "Ещё не слушали", title: "Полярный день", subtitle: "6 песен · 21 мин · лежит с марта", action: "Слушать", art: ALBUM_ART, colors: ["#3f6fb4", "#7a5fc4"], onAction: () => toast("Распаковали «Полярный день»") })
        : createJoiPro(box.querySelector(".jph"), { kicker: "Новая ачивка", title: "100 альбомов целиком", subtitle: "От первой песни до последней, без пропусков", action: "Смотреть", icon: '<svg class="i"><use href="#i-trophy"/></svg>', colors: ["#b8642e", "#d4a03a"], onAction: () => toast("Открыли статистику") });
      jp.setShine(shine);
    };
    box.querySelectorAll(".v").forEach(b => b.addEventListener("click", () => { v = b.dataset.v; box.querySelectorAll(".v").forEach(x => x.setAttribute("aria-pressed", String(x === b))); mount(); }));
    box.querySelector(".sh").addEventListener("click", e => { shine = !shine; e.currentTarget.setAttribute("aria-pressed", String(shine)); jp.setShine(shine); });
    mount();
  } },

{ id: "password", tag: "mock", name: "Password — код с сайта",
  what: "Цифры въезжают снизу, рамка переезжает к следующей ячейке, проверка идёт волной, ошибка трясёт ряд. Верный код — 123456, любой другой — ошибка.",
  where: [["Android", "привязка телефона: на сайте Настройки → Устройства показывают код, телефон его вводит — без логина и пароля на телефоне. Нужен серверный эндпоинт привязки"], ["Web", "только показ кода, ввод не нужен"]],
  haptic: "Цифры — тихо (клавиатура щёлкает сама). Верный код — Confirm, неверный — Reject.",
  cost: "Короткие WAAPI-анимации на ввод; «волна» проверки — 1,2 с CSS.", src: "mishanaer/password (из Smintfy/ui-snippet), MIT · порт Password.kt готов",
  demo(s) {
    const box = el(`<div class="col"><div class="pwh"></div><button class="sbtn" type="button">Сбросить</button></div>`); s.append(box);
    let pw = createPassword(box.querySelector(".pwh"), { onDone: () => {} });
    box.querySelector(".sbtn").addEventListener("click", () => pw.reset());
  } },

{ id: "multistep", tag: "mock", name: "MultiStep — шаги с плавной высотой",
  what: "Шаги мастера: содержимое въезжает с той стороны, куда идёте, высота блока плавно подстраивается под шаг — ничего не прыгает.",
  where: [["Android", "первый запуск: сервер → код с сайта (Password) → готово"], ["Web", "мастер первого запуска и импорта (routes/setup.tsx, этапы 7–8)"]],
  haptic: "Нет: «Дальше» и «Назад» — обычные тапы. Итог шага отмечает вложенный компонент (например, Confirm у Password).",
  cost: "Одна анимация высоты 380 мс на переход.", src: "Smintfy/ui-snippet MultiStep (MIT), код свой",
  demo(s) {
    const P = [
      `<h3>Где ваш сервер?</h3><p>Адрес, по которому MusiX открывается на компьютере.</p><div class="field" style="margin:12px 0 0"><input value="musix.local" aria-label="Адрес сервера"></div>`,
      `<h3>Что перенесётся</h3><p>С сервера на телефон:</p><ul><li>фонотека и плейлисты</li><li>очередь и огоньки</li><li>история для статистики</li><li>настройки звука</li></ul>`,
      `<h3>Готово</h3><p>Телефон подключён.</p>`,
    ];
    const box = el(`<div class="msd"><div class="dots"><i class="on"></i><i></i><i></i></div><div class="ms"></div><div class="row3"><button class="cta ghost back" type="button">← Назад</button><button class="cta next" type="button">Дальше</button></div></div>`);
    s.append(box); s.style.placeItems = "start stretch";
    const ms = box.querySelector(".ms"); let step = 0;
    const go = (n, dir) => {
      const h0 = ms.offsetHeight, old = ms.firstElementChild; step = n;
      [...box.querySelectorAll(".dots i")].forEach((d, k) => d.classList.toggle("on", k === n));
      const pane = el(`<div class="pane">${P[n]}</div>`); if (old) old.remove(); ms.append(pane);
      const h1 = ms.offsetHeight;
      if (old && !REDUCED) { ms.animate([{ height: h0 + "px" }, { height: h1 + "px" }], { duration: 380, easing: "cubic-bezier(.16,1,.3,1)" }); pane.animate([{ opacity: 0, transform: `translateX(${dir * 28}px)` }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(.16,1,.3,1)" }); }
      box.querySelector(".back").style.visibility = n ? "visible" : "hidden";
      box.querySelector(".next").textContent = n === 2 ? "Сначала" : "Дальше";
    };
    box.querySelector(".next").addEventListener("click", () => go(step === 2 ? 0 : step + 1, step === 2 ? -1 : 1));
    box.querySelector(".back").addEventListener("click", () => step && go(step - 1, -1));
    go(0, 1);
  } },

{ id: "steps", tag: "mock", name: "Шаги ассистента",
  what: "Ход ассистента виден по шагам: текущий переливается, готовый отмечается галочкой Richbox. Ответ появляется, когда шаги закончились.",
  where: [["Web", "окно ассистента («Хрусталь»): вместо одного «думает…» — его настоящие шаги (поиск, факты, подбор)"], ["Android", "экран ассистента, то же"]],
  haptic: "Нет: ответ приходит без пальца.", cost: "Перелив — CSS на одной строке текста, только пока шаг идёт.", src: "идея ThinkingSteps (Fluid Functionalism) + TextShimmer (ui-snippet), MIT",
  demo(s) {
    const box = el(`<div class="ai"><div class="bubble">Похожее по звуку на «Ночные трамваи»</div><div class="steps"></div><button class="sbtn again" type="button" style="justify-self:center">Ещё раз</button></div>`);
    s.append(box); s.style.placeItems = "start stretch";
    let timers = [];
    const run = () => {
      timers.forEach(clearTimeout); timers = [];
      const list = box.querySelector(".steps"); list.innerHTML = ""; box.querySelector(".answer")?.remove();
      const steps = ["Ищу в фонотеке похожее по звуку", "Сверяю продюсеров и год", "Собираю подборку"];
      const finish = () => { const p = list.lastElementChild; if (p) { p.classList.remove("cur"); p.classList.add("done"); p.rb.setState("done"); p.lastElementChild.textContent = p.lastElementChild.textContent.replace("…", ""); } };
      steps.forEach((t, i) => timers.push(setTimeout(() => { finish(); const e = el(`<div class="step cur"><span class="rbs"></span><span>${t}…</span></div>`); list.append(e); e.rb = createRichbox(e.querySelector(".rbs"), 16, "waiting"); e.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "ease-out" }); }, 300 + i * 1300)));
      timers.push(setTimeout(() => { finish(); const a = el(`<div class="answer">Три песни с тем же холодным синтезатором и медленной бочкой: «Косой дождь», «Круги на воде», «Тёплый шум».</div>`); box.querySelector(".again").before(a); a.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(.2,.9,.3,1)" }); }, 300 + steps.length * 1300));
    };
    box.querySelector(".again").addEventListener("click", run);
    new IntersectionObserver(([e], o) => { if (e.isIntersecting) { run(); o.disconnect(); } }, { threshold: .5 }).observe(box);
  } },

{ id: "toasts", tag: "mock", name: "Стопка тостов",
  what: "Несколько уведомлений не перекрывают друг друга, а складываются стопкой. Смахните вниз — закроется. У некоторых есть действие.",
  where: [["Web", "ui/toast.ts: сейчас один тост — стопка до трёх, swipe и пауза таймера под пальцем"], ["Android", "свой SnackbarHost со стопкой"]],
  haptic: "Нет: тост — ответ системы, не жест.", cost: "Только transform/opacity при появлении и уходе.", src: "идея Sonner (MIT), код свой",
  demo(s) {
    s.style.minHeight = "230px";
    const box = el(`<div class="btnrow" style="align-self:start"><button class="sbtn" type="button">В очередь</button><button class="sbtn" type="button">Скачать альбом</button><button class="sbtn" type="button">Убрать из плейлиста</button></div>`);
    s.append(box); const toast = toaster(s.appendChild(el(`<div class="toasts"></div>`)));
    const [a, b, c] = box.querySelectorAll("button");
    a.addEventListener("click", () => toast("«Глина» — следующей", "Отменить"));
    b.addEventListener("click", () => toast("Скачиваем «Полярный день»"));
    c.addEventListener("click", () => toast("Убрали из «Вечер»", "Вернуть"));
  } },

{ id: "wavy", tag: "mock", name: "Волнистый прогресс",
  what: "Сыгранная часть идёт волной, пока песня играет, и выпрямляется на паузе. Переключатель сравнивает с прямой линией 4 px из дизайн-кода. Ведите по линии — тик каждые 10 %.",
  where: [["Android", "только если одобрите: плеер на телефоне. В дизайн-коде сейчас прямая линия — менять её без вашего «да» нельзя"], ["Web", "нет: на компьютере над линией спектр"]],
  haptic: "Перемотка пальцем — SegmentTick на каждые 10 %.",
  cost: "Волна — одна CSS-анимация transform на композиторе, только пока играет. Позиция обновляется 4 раза в секунду. На Android — LinearWavyProgressIndicator (M3 1.5) или mahozad/wavy-slider.", src: "M3 Expressive / wavy-slider, Apache-2.0",
  demo(s) {
    const t = T[2];
    const box = el(`<div class="wv wavy paused" style="--acc:${t.pal[0]}"><div class="seek" role="slider" tabindex="0" aria-label="Позиция"><span class="track"></span><span class="played"><span class="line"></span><span class="wave"><i></i></span></span><span class="thumb"></span></div>
      <div class="times"><span class="tn">0:00</span><span class="tl">-0:00</span></div><div class="row2"><button class="playbtn" aria-label="Играть">${ICON}</button><div class="btnrow"><button class="sbtn w" type="button" aria-pressed="true">Волна</button><button class="sbtn l" type="button" aria-pressed="false">Прямая 4 px</button></div></div></div>`);
    s.append(box);
    let d = "M-2 10"; for (let xx = -2; xx <= 42; xx += 2) d += ` L${xx} ${(10 + 3.4 * Math.sin(xx / 40 * Math.PI * 2)).toFixed(2)}`;
    box.querySelector(".wave i").style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'><path d='${d}' fill='none' stroke='${t.pal[0]}' stroke-width='4'/></svg>`)}")`;
    let playing = false, base = 52, ts = 0, timer = 0;
    const pos = () => playing ? Math.min(t.d, base + (performance.now() - ts) / 1000) : base;
    const draw = () => { const p = pos(), f = clamp01(p / t.d); box.querySelector(".played").style.width = (f * 100).toFixed(2) + "%"; box.querySelector(".thumb").style.left = (f * 100).toFixed(2) + "%"; box.querySelector(".tn").textContent = fmt(p); box.querySelector(".tl").textContent = "-" + fmt(t.d - p); };
    const m = morpher([box.querySelector(".playbtn svg")]);
    box.querySelector(".playbtn").addEventListener("click", () => {
      base = pos(); ts = performance.now(); playing = !playing; m.to(playing ? 1 : 0);
      box.classList.toggle("playing", playing); box.classList.toggle("paused", !playing); haptic(playing ? "toggleOn" : "toggleOff");
      clearInterval(timer); if (playing) timer = setInterval(draw, 250);
    });
    const seek = box.querySelector(".seek"); let down = false, ten = -1;
    const at = x => { const r = seek.getBoundingClientRect(); return clamp01((x - r.left) / r.width); };
    const go = f => { base = f * t.d; ts = performance.now(); draw(); const k = Math.floor(f * 10); if (k !== ten) { if (ten >= 0) haptic("tick"); ten = k; } };
    seek.addEventListener("pointerdown", e => { down = true; ten = -1; seek.classList.add("drag"); try { seek.setPointerCapture(e.pointerId); } catch (_) {} go(at(e.clientX)); });
    seek.addEventListener("pointermove", e => { if (down) go(at(e.clientX)); });
    const up = () => { down = false; seek.classList.remove("drag"); }; seek.addEventListener("pointerup", up); seek.addEventListener("pointercancel", up);
    const w = box.querySelector(".w"), l = box.querySelector(".l");
    w.addEventListener("click", () => { box.classList.add("wavy"); w.setAttribute("aria-pressed", "true"); l.setAttribute("aria-pressed", "false"); });
    l.addEventListener("click", () => { box.classList.remove("wavy"); l.setAttribute("aria-pressed", "true"); w.setAttribute("aria-pressed", "false"); });
    draw();
  } },

{ id: "spark", tag: "mock", name: "Огонёк со всплеском",
  what: "Отскок иконки уже есть в продукте. Новое — короткий всплеск искр при включении, 16 частиц на ~0,6 с.",
  where: [["Android", "реакция «огонёк» в плеере и мини-плеере"], ["Web", "та же реакция; на компьютере — по клику"]],
  haptic: "Включить — ToggleOn, выключить — ToggleOff.", cost: "Canvas работает только пока живы искры (~0,6 с), потом 0.", src: "своё",
  demo(s) {
    const box = el(`<div class="reactdemo"><button class="ibtn react" aria-label="Огонёк" aria-pressed="false"><svg class="i"><use href="#i-flame"/></svg><canvas width="280" height="280"></canvas></button></div>`);
    s.append(box);
    const btn = box.querySelector("button"), cv = box.querySelector("canvas"), g = cv.getContext("2d"); let parts = [], raf = 0;
    const run = () => { g.clearRect(0, 0, 280, 280); parts.forEach(p => { p.vx *= .9; p.vy = p.vy * .9 + .1; p.x += p.vx; p.y += p.vy; p.life -= .03; }); parts = parts.filter(p => p.life > 0);
      parts.forEach(p => { g.globalAlpha = Math.max(0, p.life); g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, p.r * p.life + .6, 0, 7); g.fill(); }); g.globalAlpha = 1;
      if (parts.length) raf = requestAnimationFrame(run); else { raf = 0; live("burst", false); } };
    btn.addEventListener("click", () => {
      const on = !btn.classList.contains("on"); btn.classList.toggle("on", on); btn.setAttribute("aria-pressed", String(on)); haptic(on ? "toggleOn" : "toggleOff");
      if (REDUCED) return;
      btn.querySelector("svg").animate(on ? [{ transform: "none" }, { transform: "scale(1.45) rotate(8deg)", offset: .35 }, { transform: "none" }] : [{ transform: "none" }, { transform: "scale(.82)" }, { transform: "none" }], { duration: 520, easing: ease() });
      if (!on) return;
      const cols = ["#ff8a3c", "#ffd36e", "#ffffff", "#ff5e3a"];
      for (let i = 0; i < 16; i++) { const a = Math.random() * Math.PI * 2, sp = 2.5 + Math.random() * 4.5; parts.push({ x: 140, y: 140, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, r: 2.5 + Math.random() * 3, life: 1, c: cols[i % 4] }); }
      if (!raf) { live("burst", true); raf = requestAnimationFrame(run); }
    });
  } },
];

function swapTxt(e, text) { if (e.textContent === text) return; e.textContent = text; if (!REDUCED) e.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(.2,.9,.3,1)" }); }

/* ---------- render cards + decisions ---------- */
const KEY = "musix.tactile.decisions";
let decisions = {}; try { decisions = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) {}
const LABEL = { yes: "да, туда", move: "не туда", no: "не берём" };
function summary() {
  const lines = ["Решения по тактильным компонентам (витрина 2026-11-12):"];
  CARDS.forEach(c => { const d = decisions[c.id]; lines.push(`- ${c.name}: ${d ? LABEL[d.v] : "—"}${d && d.note ? ` — ${d.note}` : ""}`); });
  $("sum").value = lines.join("\n");
}
CARDS.forEach(c => {
  const card = el(`<article class="card" id="c-${c.id}">
    <header><h3>${c.name}</h3><span class="tag ${c.tag}">${c.tag === "take" ? "берём" : "после макета"}</span></header>
    <p class="what">${c.what}</p><div class="stage"></div>
    <dl class="facts"><dt>Куда предлагаю</dt><dd><ul>${c.where.map(([p, t]) => `<li><span class="plat">${p}</span>${t}</li>`).join("")}</ul></dd>
      <dt>Вибрация</dt><dd>${c.haptic}</dd><dt>Нагрузка</dt><dd>${c.cost}</dd><dt>Откуда</dt><dd>${c.src}</dd></dl>
    <div class="decide" role="group" aria-label="Решение"><button type="button" data-v="yes" aria-pressed="false">Да, туда</button><button type="button" data-v="move" aria-pressed="false">Не туда</button><button type="button" data-v="no" aria-pressed="false">Не берём</button></div>
    <input class="note" placeholder="Куда тогда, или комментарий" hidden></article>`);
  $(c.tag === "take" ? "take" : "mock").append(card);
  const note = card.querySelector(".note"), btns = card.querySelectorAll(".decide button");
  const paint = () => { const d = decisions[c.id]; btns.forEach(b => b.setAttribute("aria-pressed", String(!!d && d.v === b.dataset.v))); note.hidden = !d || d.v === "yes"; note.value = d?.note || ""; };
  btns.forEach(b => b.addEventListener("click", () => {
    const d = decisions[c.id]; if (d && d.v === b.dataset.v) delete decisions[c.id]; else decisions[c.id] = { v: b.dataset.v, note: d?.note || "" };
    localStorage.setItem(KEY, JSON.stringify(decisions)); paint(); summary();
    if (!note.hidden && b.dataset.v === "move") note.focus();
  }));
  note.addEventListener("input", () => { if (decisions[c.id]) { decisions[c.id].note = note.value; localStorage.setItem(KEY, JSON.stringify(decisions)); summary(); } });
  paint();
  try { c.demo(card.querySelector(".stage")); } catch (err) { card.querySelector(".stage").textContent = "Ошибка демо: " + err.message; console.error(err); }
});
summary();
$("copy").addEventListener("click", async () => {
  const ta = $("sum"); let ok = false;
  try { await navigator.clipboard.writeText(ta.value); ok = true; } catch (_) { ta.select(); try { ok = document.execCommand("copy"); } catch (_) {} }
  $("copy").textContent = ok ? "Скопировано" : "Выделено — скопируйте вручную"; setTimeout(() => $("copy").textContent = "Скопировать", 2000);
});

/* ---------- top switches ---------- */
const sw = (id, get, set) => $(id).addEventListener("click", () => { const v = !get(); set(v); $(id).setAttribute("aria-checked", String(v)); });
sw("swH", () => hapticState.on, v => { hapticState.on = v; if (v) haptic("toggleOn"); });
sw("swS", () => hapticState.show, v => { hapticState.show = v; });
let meterT = 0;
sw("swM", () => !$("meter").hidden, v => {
  $("meter").hidden = !v; clearInterval(meterT); if (!v) return;
  const draw = () => { const anims = document.getAnimations().filter(a => a.playState === "running").length; $("meter").textContent = `циклы rAF: ${LIVE.size}${LIVE.size ? " (" + [...new Set([...LIVE].map(n => n.replace(/\d+$/, "")))].join(", ") + ")" : ""}\nанимации: ${anims}\nвибраций: ${hapticState.count}`; };
  draw(); meterT = setInterval(draw, 400);
});
