/* The frame loop, the events, the mock's switcher. */
let last = performance.now(), typing = 0;
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const idle = !busy && !app.classList.contains("answering");
  const pv = O.preview && idle ? KIND[O.preview] : null;
  const k1 = pv ? mix(O.k1, pv.c1, 0.6) : O.k1, k2 = pv ? mix(O.k2, pv.c2, 0.6) : O.k2, kc = 1 - Math.exp(-dt * 3);
  O.c1 = mix(O.c1, k1, kc); O.c2 = mix(O.c2, k2, kc);
  typing *= Math.exp(-dt * 1.5);
  O.e += (O.eT + (pv ? 0.05 : 0) + typing * 0.08 - O.e) * (1 - Math.exp(-dt * 1.6));
  O.t += dt * (1 + O.e * 0.25);
  O.pulse *= Math.exp(-dt * 3.2); O.rip += dt; O.dim += (O.dimT - O.dim) * (1 - Math.exp(-dt * 4));
  O.lean = mix(O.lean, O.leanT, 1 - Math.exp(-dt * 3));
  if (orbit.shown) placeChips(dt);
  if (S.v !== "a" && draw) {
    paintBg();
    draw({ t: O.t, r: L.R * L.dpr, c1: O.c1, c2: O.c2, e: O.e, mat: S.v === "c" ? 1 : 0, lean: O.lean, rip: O.rip, pulse: O.pulse, dim: O.dim });
  } else V1(O.e);
  $("#ask").style.setProperty("--caustic", (0.22 + O.e * 0.7).toFixed(2));
  requestAnimationFrame(frame);
}

$("#ask").addEventListener("submit", (e) => { e.preventDefault(); ask($("#q").value); });
$("#q").addEventListener("input", () => { $("#ask").classList.toggle("has", !!$("#q").value.trim()); typing = Math.min(1, typing + 0.35); pulse(0.04); O.leanT = [0, -0.85]; });
$("#q").addEventListener("blur", () => { O.leanT = [0, 0]; });
stage.addEventListener("pointermove", (e) => {
  if (document.activeElement === $("#q") && $("#q").value) return;
  const r = stage.getBoundingClientRect(), k = S.size === "win" ? 1 : +getComputedStyle(app).getPropertyValue("--k") || 1;
  const nx = clamp(((e.clientX - r.left) / k - L.cx) / (L.W / 2), -1, 1), ny = clamp(((e.clientY - r.top) / k - L.cy) / (L.H / 2), -1, 1);
  orbit.pxT = nx * 26; orbit.tiltT = ny * 0.14; O.leanT = [nx * 0.7, -ny * 0.7];
});
stage.addEventListener("pointerleave", () => { orbit.pxT = 0; orbit.tiltT = 0; O.leanT = [0, 0]; });
$("#orbhit").addEventListener("click", () => { if (app.classList.contains("answering")) reset(); else pulse(0.5); });

document.addEventListener("click", async (e) => {
  const t = e.target;
  const a = t.closest("[data-ask]"); if (a) { ask(a.dataset.ask); return; }
  const c = t.closest("[data-card]"); if (c) { const card = cards[+c.dataset.card]; ask(card.ask, { item: card.item || card }); return; }
  const p = t.closest("[data-play]"); if (p) { play(p.dataset.play); toast(`Играет «${T[p.dataset.play].t}»${p.dataset.from ? " с " + p.dataset.from : ""}`); return; }
  const sv = t.closest("[data-save]"); if (sv && !sv.classList.contains("saved")) { saveFly(sv); return; }
  const sc = t.closest("[data-scroll]"); if (sc) { $("#rail").scrollBy({ left: +sc.dataset.scroll * 628, behavior: "smooth" }); return; }
  const ts = t.closest("[data-toast]"); if (ts) { e.preventDefault(); toast(ts.dataset.toast); }
  const b = t.closest(".mockbar button"); if (!b) return;
  if (b.dataset.v) { S.v = b.dataset.v; app.dataset.v = S.v; }
  if (b.classList.contains("idea-t")) { S.ideas = !S.ideas; app.classList.toggle("ideas", S.ideas); }
  if (b.classList.contains("real-t")) S.real = !S.real;
  if (b.dataset.size) { S.size = b.dataset.size; sizeVp(); }
  if (b.dataset.run) { if (busy || app.classList.contains("answering") || app.classList.contains("working")) await reset(true); busy = false; ask(SCN[b.dataset.run].q); }
  save(); bar();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (app.classList.contains("answering") || app.classList.contains("working"))) reset(); });
function bar() {
  for (const b of $$(".mockbar [data-v]")) b.setAttribute("aria-pressed", String(b.dataset.v === S.v));
  for (const b of $$(".mockbar [data-size]")) b.setAttribute("aria-pressed", String(b.dataset.size === S.size));
  $(".mockbar .real-t").setAttribute("aria-pressed", String(S.real)); $(".mockbar .idea-t").setAttribute("aria-pressed", String(S.ideas));
}
const SIZES = { 14: [1512, 982], 16: [1728, 1117], 32: [2560, 1440] };
function sizeVp() {
  const vp = $(".vp");
  if (S.size === "win") { vp.removeAttribute("data-size"); return; }
  const [w, h] = SIZES[S.size]; vp.dataset.size = S.size;
  const k = Math.min((innerWidth - 24) / w, (innerHeight - 24) / h, 1);
  app.style.setProperty("--w", w + "px"); app.style.setProperty("--h", h + "px"); app.style.setProperty("--k", k.toFixed(4));
}
addEventListener("resize", () => { sizeVp(); layout(); });
new ResizeObserver(() => layout()).observe(page);

hydrate(); app.dataset.v = S.v; app.classList.toggle("nogl", !draw); app.classList.toggle("ideas", S.ideas);
renderFeed(); sizeVp(); layout(); bar();
const first = A.playlist.tracks.find((id) => T[id].t === "Stronger") || A.playlist.tracks[0]; play(first);
document.fonts?.ready.then(() => { measureChips(); });
requestAnimationFrame(frame);
