import { useEffect, useRef } from "react";
import { image } from "../lib/images";
import { usePlayer } from "../player/engine";
import css from "./Sky.module.css";

/** The home's living sky (design/code/screens/home.md): v1's top half «мягко амбиент
 *  делала», here drawn on a canvas a tenth of the screen's size and stretched, so the
 *  light is soft by nature and the frame costs almost nothing. Three spots of sky in real
 *  colours for the hour and the weather, the sun or the moon, and two quieter spots in the
 *  taste's colours, which take the playing cover's colours while music plays: the room is
 *  lit by what sounds. Rain and snow fall on a second canvas in front of the page and know
 *  the edges of what stands on it (`data-sky-edge`): a drop breaks on the headline, the
 *  search field, the albums' plate and the island; a flake stays where it fell on the
 *  field, the plate or the island, and the snow there grows as a height field. */

export type Weather = "clear" | "cloudy" | "rain" | "snow";
type Tod = "morning" | "day" | "evening" | "night";
type RGB = [number, number, number];
type Sky = { c: RGB[]; sun: { c: RGB; x: number; y: number; r: number; a: number } | null; bright: number; veil: number; speed: number };

const SKY: Record<Tod, Record<Weather, Sky>> = {
  morning: {
    clear: { c: [[255, 214, 150], [170, 205, 245], [255, 170, 160]], sun: { c: [255, 238, 200], x: 0.1, y: 0.22, r: 0.55, a: 0.6 }, bright: 1.18, veil: 0, speed: 1 },
    cloudy: { c: [[205, 212, 225], [175, 185, 205], [225, 215, 205]], sun: { c: [245, 245, 245], x: 0.3, y: 0.1, r: 0.6, a: 0.22 }, bright: 0.9, veil: 0.1, speed: 0.6 },
    rain: { c: [[150, 165, 190], [120, 135, 160], [170, 180, 195]], sun: null, bright: 0.75, veil: 0.14, speed: 0.8 },
    snow: { c: [[222, 226, 236], [198, 206, 222], [236, 232, 238]], sun: null, bright: 0.95, veil: 0.08, speed: 0.45 },
  },
  day: {
    clear: { c: [[140, 190, 250], [200, 225, 255], [255, 250, 235]], sun: { c: [255, 255, 240], x: 0.55, y: -0.15, r: 0.5, a: 0.5 }, bright: 1.1, veil: 0, speed: 1 },
    cloudy: { c: [[175, 185, 200], [150, 160, 180], [200, 205, 215]], sun: null, bright: 0.85, veil: 0.12, speed: 0.6 },
    rain: { c: [[110, 125, 150], [90, 105, 130], [140, 150, 170]], sun: null, bright: 0.7, veil: 0.16, speed: 0.8 },
    snow: { c: [[205, 212, 225], [185, 195, 212], [230, 232, 240]], sun: null, bright: 0.9, veil: 0.08, speed: 0.45 },
  },
  evening: {
    clear: { c: [[255, 140, 60], [255, 80, 110], [120, 70, 160]], sun: { c: [255, 205, 130], x: 0.14, y: 0.48, r: 0.5, a: 0.62 }, bright: 1, veil: 0, speed: 1 },
    cloudy: { c: [[200, 120, 100], [120, 90, 130], [90, 80, 120]], sun: { c: [255, 170, 110], x: 0.14, y: 0.5, r: 0.35, a: 0.25 }, bright: 0.8, veil: 0.1, speed: 0.6 },
    rain: { c: [[120, 90, 110], [80, 75, 110], [60, 60, 90]], sun: null, bright: 0.65, veil: 0.14, speed: 0.8 },
    snow: { c: [[190, 150, 170], [140, 120, 160], [100, 95, 135]], sun: null, bright: 0.8, veil: 0.08, speed: 0.45 },
  },
  night: {
    clear: { c: [[20, 35, 80], [40, 50, 110], [60, 45, 90]], sun: { c: [200, 215, 240], x: 0.82, y: 0.08, r: 0.16, a: 0.4 }, bright: 0.6, veil: 0, speed: 0.8 },
    cloudy: { c: [[25, 30, 45], [35, 40, 60], [40, 40, 55]], sun: null, bright: 0.5, veil: 0.08, speed: 0.5 },
    rain: { c: [[20, 28, 48], [30, 38, 60], [28, 30, 50]], sun: null, bright: 0.5, veil: 0.1, speed: 0.7 },
    snow: { c: [[40, 48, 70], [55, 62, 88], [60, 58, 80]], sun: null, bright: 0.55, veil: 0.06, speed: 0.4 },
  },
};
/** how much of the taste's own colour the sky lets through, by hour: at night they would be acid */
const TASTE: Record<Tod, { sat: number; lum: number }> = { morning: { sat: 0.5, lum: 0.95 }, day: { sat: 0.5, lum: 1 }, evening: { sat: 0.6, lum: 0.9 }, night: { sat: 0.28, lum: 0.5 } };
const SPOTS = [{ x: 0.15, y: 0.16, r: 0.5, fx: 0.13, fy: 0.07, ph: 0 }, { x: 0.5, y: 0.04, r: 0.55, fx: 0.09, fy: 0.11, ph: 1.7 }, { x: 0.86, y: 0.2, r: 0.5, fx: 0.11, fy: 0.06, ph: 3.1 }];
const TSPOTS = [{ x: 0.32, y: 0.46, r: 0.3, fx: 0.1, fy: 0.08, ph: 0.9 }, { x: 0.72, y: 0.4, r: 0.3, fx: 0.08, fy: 0.12, ph: 2.4 }];

export function hourTod(h = new Date().getHours()): Tod {
  return h < 5 ? "night" : h < 11 ? "morning" : h < 17 ? "day" : h < 22 ? "evening" : "night";
}
/** `#rrggbb` or the palette's `hsl(h, s%, l%)` accent → rgb. */
function rgb(c: string | null | undefined, fallback: RGB): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c ?? "");
  if (m) return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
  const h = /hsl\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%\)/.exec(c ?? "");
  if (!h) return fallback;
  const hh = +h[1]! / 360, ss = +h[2]! / 100, ll = +h[3]! / 100;
  const f = (n: number) => { const k = (n + hh * 12) % 12, a = ss * Math.min(ll, 1 - ll); return Math.round(255 * (ll - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
const tone = (c: RGB, sat: number, lum: number): RGB => {
  const g = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  return c.map((v) => Math.round((g + (v - g) * sat) * lum)) as RGB;
};

/* ── the precipitation's surfaces ─────────────────────────────────────────── */
type Kind = "text" | "find" | "plate" | "island";
type Edge = { kind: Kind; l: number; t: number; r: number; w: number };
type Cap = { kind: Kind; x0: number; n: number; cells: Float32Array; max: number };
const CW = 5; // the snow's cell, px
const LANDS: Record<Exclude<Kind, "text">, { rad: number; max: number }> = { find: { rad: 24, max: 7 }, plate: { rad: 20, max: 11 }, island: { rad: 16, max: 9 } };

function findEdges(): Edge[] {
  const out: Edge[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("[data-sky-edge]")) {
    const kind = el.dataset.skyEdge as Kind;
    if (!el.offsetWidth) continue;
    if (kind === "text") {
      const rg = document.createRange();
      rg.selectNodeContents(el);
      for (const r of rg.getClientRects()) if (r.width > 20) out.push({ kind, l: r.left, t: r.top, r: r.right, w: r.width });
    } else {
      const r = el.getBoundingClientRect();
      out.push({ kind, l: r.left, t: r.top, r: r.right, w: r.width });
    }
  }
  return out;
}

export function Sky({ weather, taste }: { weather: Weather; taste: string[] }) {
  const sky = useRef<HTMLCanvasElement>(null);
  const wx = useRef<HTMLCanvasElement>(null);
  const state = useRef({ weather, taste });
  state.current = { weather, taste };

  useEffect(() => {
    const cv = sky.current, wc = wx.current;
    const ax = cv?.getContext("2d"), wcx = wc?.getContext("2d");
    if (!cv || !wc || !ax || !wcx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0, last = 0, t0 = 0, tint = 0, edgeAt = 0;
    let edges: Edge[] = [];
    const caps: Partial<Record<Kind, Cap>> = {};
    let falls: { x: number; y: number; v: number; s: number }[] = [];
    let splash: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
    const FALL: RGB[] = [[224, 112, 58], [201, 194, 135], [86, 100, 179], [184, 90, 138]];

    const spot = (s: { x: number; y: number; fx: number; fy: number; ph: number }, at: number) => [
      s.x + 0.1 * Math.sin(at * s.fx * 9 + s.ph) + 0.04 * Math.sin(at * s.fy * 17 + s.ph * 2),
      s.y + 0.08 * Math.cos(at * s.fy * 8 + s.ph) + 0.03 * Math.sin(at * s.fx * 13),
    ] as const;

    const skyFrame = (dt: number) => {
      const tod = hourTod(), s = SKY[tod][state.current.weather], ts = TASTE[tod];
      t0 += dt * 0.00004 * s.speed;
      const W = Math.max(2, Math.round(window.innerWidth / 10)), H = Math.max(2, Math.round(window.innerHeight / 10));
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      const ps = usePlayer.getState();
      const playing = ps.playing && ps.index >= 0;
      tint += ((playing ? 1 : 0) - tint) * (1 - Math.exp(-dt / 1400));
      const pal = image(ps.queue[ps.index]?.coverImageId)?.palette;
      const taste = state.current.taste;
      const tc: RGB[] = [rgb(pal?.accent?.light ?? pal?.vibrant, FALL[0]!), rgb(pal?.vibrant ?? pal?.dominant, FALL[2]!)];
      ax.clearRect(0, 0, W, H);
      ax.globalCompositeOperation = "lighter";
      const draw = (x: number, y: number, r: number, c: RGB, a: number) => {
        const g = ax.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * W);
        g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${Math.min(1, a)})`);
        g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
        ax.fillStyle = g;
        ax.fillRect(0, 0, W, H);
      };
      SPOTS.forEach((sp, i) => { const [x, y] = spot(sp, t0); draw(x, y, sp.r, s.c[i]!, 0.36 * s.bright); });
      if (s.sun) draw(s.sun.x, s.sun.y, s.sun.r, s.sun.c, 0.8 * s.sun.a * s.bright);
      TSPOTS.forEach((sp, i) => {
        const [x, y] = spot(sp, t0);
        const base = rgb(taste[i * 2], FALL[i * 2]!);
        const c = base.map((v, k) => v + (tc[i]![k]! - v) * tint) as RGB;
        draw(x, y, sp.r, tone(c, ts.sat + 0.25 * tint, ts.lum), (0.2 + 0.14 * tint) * s.bright);
      });
      if (s.veil) { ax.globalCompositeOperation = "source-over"; ax.fillStyle = `rgba(165,170,180,${s.veil})`; ax.fillRect(0, 0, W, H); }
      // the sky lives in the top half: fade it out towards the floor
      ax.globalCompositeOperation = "destination-in";
      const m = ax.createLinearGradient(0, 0, 0, H);
      m.addColorStop(0, "rgba(0,0,0,1)"); m.addColorStop(0.3, "rgba(0,0,0,.85)"); m.addColorStop(0.52, "rgba(0,0,0,.35)"); m.addColorStop(0.74, "rgba(0,0,0,0)");
      ax.fillStyle = m;
      ax.fillRect(0, 0, W, H);
      ax.globalCompositeOperation = "source-over";
    };

    const snowAt = (e: Edge, x: number) => {
      const c = caps[e.kind];
      if (!c) return 0;
      const i = Math.floor((x - c.x0) / CW);
      return i >= 0 && i < c.n ? c.cells[i]! : 0;
    };
    const weatherFrame = (dt: number, now: number) => {
      const W = window.innerWidth, H = window.innerHeight;
      const snowing = state.current.weather === "snow", raining = state.current.weather === "rain";
      const lying = Object.values(caps).some((c) => c.cells.some((v) => v > 0.05));
      if (!(snowing || raining || falls.length || splash.length || lying)) { if (wc.width) wc.width = 0; return; }
      if (wc.width !== W || wc.height !== H) { wc.width = W; wc.height = H; }
      if (now - edgeAt > 400) {
        edgeAt = now;
        edges = findEdges();
        for (const e of edges) {
          if (e.kind === "text") continue;
          const L = LANDS[e.kind], x0 = e.l + L.rad, n = Math.max(1, Math.floor((e.w - 2 * L.rad) / CW));
          const c = caps[e.kind];
          if (!c || c.n !== n || Math.abs(c.x0 - x0) > 1) caps[e.kind] = { kind: e.kind, x0, n, cells: new Float32Array(n), max: L.max };
        }
      }
      wcx.clearRect(0, 0, W, H);
      const n = raining ? 110 : snowing ? 80 : 0;
      while (falls.length < n) falls.push({ x: Math.random() * W, y: -Math.random() * H, v: 0.5 + Math.random(), s: Math.random() });
      if (!raining && !snowing) falls = [];
      const hit = (d: { x: number; y: number }, ny: number) => {
        for (const e of edges) {
          if (d.x < e.l || d.x > e.r) continue;
          const top = e.t - (e.kind === "text" ? 0 : snowAt(e, d.x));
          if (d.y < top && ny >= top) return { e, top };
        }
        return null;
      };
      if (raining) {
        wcx.strokeStyle = "rgba(205,220,245,.55)"; wcx.lineWidth = 1; wcx.beginPath();
        for (const d of falls) {
          const l = 9 + d.v * 13, ny = d.y + dt * (0.5 + d.v * 0.55), h = hit(d, ny);
          if (h) {
            for (let k = 0; k < 4; k++) splash.push({ x: d.x, y: h.top - 1, vx: (Math.random() - 0.5) * 0.6, vy: -(0.3 + Math.random() * 0.5), life: 0 });
            d.y = -20 - Math.random() * 60; d.x = Math.random() * W;
            continue;
          }
          wcx.moveTo(d.x, d.y); wcx.lineTo(d.x - l * 0.16, d.y + l);
          d.y = ny; d.x -= dt * 0.05;
          if (d.y > H) { d.y = -20; d.x = Math.random() * W; }
        }
        wcx.stroke();
      } else if (snowing) {
        wcx.fillStyle = "rgba(255,255,255,.85)";
        for (const d of falls) {
          const r = 1 + d.s * 1.7, ny = d.y + dt * (0.028 + d.v * 0.035), h = hit(d, ny);
          if (h && h.e.kind !== "text") {
            const c = caps[h.e.kind];
            if (c) {
              const i = Math.floor((d.x - c.x0) / CW);
              const add = (j: number, v: number) => { if (j >= 0 && j < c.n) c.cells[j] = Math.min(c.max, c.cells[j]! + v); };
              add(i, 1.1); add(i - 1, 0.5); add(i + 1, 0.5); add(i - 2, 0.18); add(i + 2, 0.18);
            }
            d.y = -10 - Math.random() * 40; d.x = Math.random() * W;
            continue;
          }
          wcx.globalAlpha = 0.35 + d.s * 0.5; wcx.beginPath(); wcx.arc(d.x, d.y, r, 0, Math.PI * 2); wcx.fill();
          d.y = ny; d.x += Math.sin((d.y + d.s * 300) / 60) * 0.35;
          if (d.y > H) { d.y = -6; d.x = Math.random() * W; }
        }
        wcx.globalAlpha = 1;
      }
      if (splash.length) {
        wcx.fillStyle = "rgba(215,228,250,.8)";
        for (const q of splash) {
          q.life += dt; q.vy += dt * 0.0025; q.x += q.vx * dt; q.y += q.vy * dt;
          wcx.globalAlpha = Math.max(0, 1 - q.life / 520); wcx.beginPath(); wcx.arc(q.x, q.y, 1.5, 0, Math.PI * 2); wcx.fill();
        }
        wcx.globalAlpha = 1;
        splash = splash.filter((q) => q.life < 520);
      }
      // the snow lying where it fell: the height field, smoothed, thinning out towards the
      // ends of the surface, drawn three times (wider and fainter under), so no edge is hard
      for (const c of Object.values(caps)) {
        const e = edges.find((e) => e.kind === c.kind);
        if (!e) continue;
        if (!snowing) for (let i = 0; i < c.n; i++) c.cells[i] = Math.max(0, c.cells[i]! - dt * 0.0012);
        if (!c.cells.some((v) => v > 0.05)) continue;
        const taper = (i: number) => { const k = Math.min(i + 0.5, c.n - 0.5 - i) / 5; return k >= 1 ? 1 : k <= 0 ? 0 : k * k * (3 - 2 * k); };
        const hAt = (i: number) => ((c.cells[Math.max(0, i - 1)]! + 2 * c.cells[i]! + c.cells[Math.min(c.n - 1, i + 1)]!) / 4) * taper(i);
        const band = (grow: number, alpha: number) => {
          wcx.beginPath(); wcx.moveTo(c.x0, e.t + 3);
          for (let i = 0; i < c.n; i++) {
            const x = c.x0 + i * CW + CW / 2, h = hAt(i), y = e.t - h - grow * Math.min(1, h);
            if (i === 0) wcx.lineTo(x, y);
            else { const hm = (hAt(i - 1) + h) / 2; wcx.quadraticCurveTo(c.x0 + i * CW, e.t - hm - grow * Math.min(1, hm), x, y); }
          }
          wcx.lineTo(c.x0 + c.n * CW, e.t + 3); wcx.closePath();
          wcx.fillStyle = `rgba(248,250,255,${alpha})`; wcx.fill();
        };
        band(1.6, 0.28); band(0.6, 0.4); band(0, 0.86);
      }
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = last ? Math.min(50, now - last) : 16;
      last = now;
      skyFrame(dt);
      weatherFrame(dt, now);
      raf = requestAnimationFrame(frame);
    };
    if (reduce) { skyFrame(16); return; } // one still frame
    raf = requestAnimationFrame(frame);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, []);

  return (
    <>
      <div className={css.ground} aria-hidden>
        <canvas ref={sky} className={css.sky} />
        <div className={css.grain} />
        <div className={css.shade} />
      </div>
      <canvas ref={wx} className={css.weather} aria-hidden />
    </>
  );
}
