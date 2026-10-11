/** The shrink-wrap on never-heard albums (design/code/screens/library.md): taking it off,
 *  and the two quiet sounds of the library (the film's crinkle, the achievement's «бульк»).
 *
 *  Taking it off is drawn on ONE canvas over the cover, never by DOM repaints per frame: a fold
 *  line travels the diagonal from the top right corner; the film keeps the far side, the flap
 *  is the near side reflected over the fold, with light along its crease and a shadow; what is
 *  left evaporates. The film element stays in React's hands (hidden while the canvas runs). */

let ac: AudioContext | null = null;
let crinkles: AudioBuffer[] | null = null;

/** The first sound used to cost a hitch (an audio context and its noise made on the spot):
 *  both are made at the first touch of the page. */
export function warmAudio(): AudioContext | null {
  try {
    ac ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ac.state === "suspended") void ac.resume();
    if (!crinkles) {
      const sr = ac.sampleRate;
      crinkles = [0, 1, 2].map(() => {
        const len = Math.floor(sr * 0.7), buf = ac!.createBuffer(1, len, sr), d = buf.getChannelData(0);
        let t = Math.floor(sr * 0.02);
        while (t < len) {
          const n = Math.floor(sr * (0.002 + Math.random() * 0.012)), amp = (0.25 + Math.random() * 0.75) * (t < sr * 0.12 ? 0.5 : 1);
          for (let j = 0; j < n && t + j < len; j++) d[t + j] = (Math.random() * 2 - 1) * amp * Math.exp(-j / (n * 0.35));
          t += n + Math.floor(sr * (0.003 + Math.random() * 0.028));
        }
        return buf;
      });
    }
    return ac;
  } catch {
    return null;
  }
}
if (typeof window !== "undefined") window.addEventListener("pointerdown", () => warmAudio(), { once: true, capture: true });

export function crinkle(): void {
  const a = warmAudio();
  if (!a || !crinkles) return;
  try {
    const src = a.createBufferSource(); src.buffer = crinkles[Math.floor(Math.random() * crinkles.length)]!;
    const hp = a.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1600;
    const g = a.createGain(), now = a.currentTime;
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.08, now + 0.03);
    g.gain.setValueAtTime(0.08, now + 0.45); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    src.connect(hp).connect(g).connect(a.destination); src.start(now);
  } catch { /* sound is a nicety */ }
}

/** «Бульк»: a drop into water, quiet, in the same frame as the sticker lands. */
export function bulk(): void {
  const a = warmAudio();
  if (!a) return;
  try {
    const t = a.currentTime + 0.005;
    const drop = (t0: number, f0: number, f1: number, dur: number, vol: number) => {
      const o = a.createOscillator(), g = a.createGain(); o.type = "sine";
      o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.55);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    };
    drop(t, 1250, 330, 0.2, 0.14); drop(t + 0.075, 1700, 560, 0.12, 0.05);
  } catch { /* sound is a nicety */ }
}

const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const TEX = new Map<string, HTMLCanvasElement>();
/** The film's look, painted once per size: haze, two bands of light, the rim, the sticker. */
function filmTex(w: number, h: number, sticker: boolean): HTMLCanvasElement {
  const key = `${w}x${h}${sticker ? "s" : ""}`;
  const had = TEX.get(key);
  if (had) return had;
  const dpr = Math.min(2, devicePixelRatio || 1), c = document.createElement("canvas");
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const x = c.getContext("2d")!; x.scale(dpr, dpr);
  x.fillStyle = "rgba(255,255,255,.06)"; x.fillRect(0, 0, w, h);
  const dx = 0.927, dy = 0.375, L = w * dx + h * dy, g = x.createLinearGradient(w / 2 - (dx * L) / 2, h / 2 - (dy * L) / 2, w / 2 + (dx * L) / 2, h / 2 + (dy * L) / 2);
  ([[0, 0], [0.34, 0], [0.4, 0.12], [0.46, 0.03], [0.52, 0], [0.7, 0], [0.74, 0.07], [0.79, 0], [1, 0]] as const).forEach(([o, a]) => g.addColorStop(o, `rgba(255,255,255,${a})`));
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.strokeStyle = "rgba(255,255,255,.32)"; x.lineWidth = 1; x.strokeRect(0.5, 0.5, w - 1, h - 1);
  x.fillStyle = "rgba(255,255,255,.22)"; x.fillRect(1, 1, w - 2, 2);
  if (sticker) {
    x.save(); x.translate(12, 12); x.rotate((-4 * Math.PI) / 180);
    x.font = "600 11.5px Geist, Inter, system-ui, sans-serif";
    const bw = x.measureText("не слушал").width + 31, bh = 22;
    x.shadowColor = "rgba(0,0,0,.3)"; x.shadowBlur = 4; x.shadowOffsetY = 2; x.fillStyle = "#f4efe4";
    x.beginPath(); if (x.roundRect) x.roundRect(0, 0, bw, bh, 6); else x.rect(0, 0, bw, bh); x.fill(); x.shadowColor = "transparent";
    x.fillStyle = "#e2552f"; x.beginPath(); x.arc(11, bh / 2, 3, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#2a2620"; x.textBaseline = "middle"; x.fillText("не слушал", 20, bh / 2 + 0.5); x.restore();
  }
  TEX.set(key, c);
  return c;
}

/** The corner is pulled, the film peels back over itself, comes off and what is left
 *  evaporates. `film` is hidden at once (the canvas draws it); `done` runs as the cover is
 *  free (the caller then drops the film element and opens or plays). */
export function peel(host: HTMLElement, film: HTMLElement | null, done: () => void): void {
  if (!film || reduce()) { done(); return; }
  crinkle();
  const w = film.offsetWidth, h = film.offsetHeight, tex = filmTex(w, h, w > 120), dpr = tex.width / w;
  film.style.visibility = "hidden";
  const cv = document.createElement("canvas");
  cv.width = tex.width; cv.height = tex.height;
  Object.assign(cv.style, { position: "absolute", inset: "0", width: "100%", height: "100%", zIndex: "6", pointerEvents: "none" });
  host.appendChild(cv);
  const x = cv.getContext("2d")!; x.scale(dpr, dpr);
  const L = Math.hypot(w, h), ux = -w / L, uy = h / L;
  const v = (a: number, b: number, p: number) => (a - w) * ux + b * uy - p;
  const sq: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]];
  const clip = (poly: [number, number][], p: number, keep: boolean) => {
    const out: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const A = poly[i]!, B = poly[(i + 1) % poly.length]!, va = v(A[0], A[1], p), vb = v(B[0], B[1], p);
      const ia = keep ? va >= 0 : va < 0, ib = keep ? vb >= 0 : vb < 0;
      if (ia) out.push(A);
      if (ia !== ib) { const t = va / (va - vb); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); }
    }
    return out;
  };
  const path = (pts: [number, number][]) => { x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath(); };
  const ease = (t: number) => (t < 0.18 ? 0.08 * (1 - Math.pow(1 - t / 0.18, 3))
    : ((k) => 0.08 + (1.02 - 0.08) * (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2))((t - 0.18) / 0.82));
  const T0 = performance.now(), dur = 760;
  let gone = false;
  const frame = (now: number) => {
    const t = Math.min(1, (now - T0) / dur), p = ease(t) * L;
    x.clearRect(0, 0, w, h);
    const rest = clip(sq, p, true);
    if (rest.length > 2) { x.save(); path(rest); x.clip(); x.drawImage(tex, 0, 0, w, h); x.restore(); }
    const fl = clip(sq, p, false).map(([a, b]) => { const d = v(a, b, p); return [a - 2 * d * ux, b - 2 * d * uy] as [number, number]; });
    if (fl.length > 2 && p > 1) {
      const fx = w + ux * p, fy = uy * p, g = x.createLinearGradient(fx, fy, fx + ux * p, fy + uy * p);
      g.addColorStop(0, "rgba(255,255,255,.75)"); g.addColorStop(0.1, "rgba(238,240,247,.36)"); g.addColorStop(1, "rgba(214,218,230,.16)");
      x.save(); x.shadowColor = "rgba(0,0,0,.38)"; x.shadowBlur = 10; x.shadowOffsetX = -3; x.shadowOffsetY = 5; path(fl); x.fillStyle = g; x.fill(); x.restore();
    }
    if (t > 0.8 && !gone) {
      gone = true;
      cv.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate(-6px,-10px) scale(1.04)" }], { duration: 380, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" })
        .finished.then(() => cv.remove(), () => cv.remove());
    }
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  host.animate([{ transform: "none" }, { transform: "translateY(-2px) rotate(-.4deg)", offset: 0.15 }, { transform: "none" }], { duration: 520, easing: "cubic-bezier(.34,1.56,.64,1)" });
  setTimeout(done, 620);
}
