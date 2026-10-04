import { useEffect, useRef } from "react";
import css from "./Combustion.module.css";

/** Огонёк / вода: v1's `CoverCombustion`, ported as it was. A one-shot canvas particle burst
 *  that wraps the album cover in 3D: a BACK canvas behind the art and a FRONT canvas over its
 *  rim share one rAF loop. Fire: soft additive flame particles (a hot white-yellow core
 *  cooling to deep red at the tip) rise from the bottom behind the cover and climb its side
 *  edges, with drifting embers and faint smoke above the crest. Water: a splash crown off the
 *  top edge, rivulets running down the front rims that stretch with speed and burst into
 *  droplets at the bottom, plus a cool mist behind. Sprites are pre-rendered radial gradients
 *  (no per-frame filters), DPR is capped at 2, and everything dies within 2.7 s. Mount it
 *  with a fresh `key` per press, inside the cover's box. */
type Kind = "fire" | "water";
type P = {
  type: "flame" | "ember" | "haze" | "drop" | "splash";
  front: boolean; bx: number; y: number; vx: number; vy: number; r: number;
  life: number; age: number; swayF: number; swayA: number; ph: number; grow?: number;
};
type Stops = [number, string][];

export function Combustion({ kind }: { kind: Kind }) {
  const backRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // reduced motion: the CSS aura alone acknowledges the gesture
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const backCv = backRef.current, frontCv = frontRef.current;
    const wrap = frontCv?.parentElement?.parentElement; // the cover's box
    const bctx = backCv?.getContext("2d"), fctx = frontCv?.getContext("2d");
    if (!backCv || !frontCv || !wrap || !bctx || !fctx) return;

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const rect = frontCv.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    if (W < 10 || H < 10) return;
    for (const [cv, ctx] of [[backCv, bctx], [frontCv, fctx]] as const) {
      cv.width = Math.max(1, Math.round(W * DPR));
      cv.height = Math.max(1, Math.round(H * DPR));
      ctx.scale(DPR, DPR);
    }

    // the cover box in canvas coordinates (the canvases overflow the cover on all sides);
    // every speed and radius scales off the cover size S
    const wr = wrap.getBoundingClientRect();
    const CL = wr.left - rect.left, CT = wr.top - rect.top;
    const CR = CL + wr.width, CB = CT + wr.height;
    const S = wr.width;

    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const TAU = Math.PI * 2;
    const sprite = (stops: Stops) => {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const x = c.getContext("2d")!;
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      for (const [o, col] of stops) g.addColorStop(o, col);
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
      return c;
    };
    // colour ramp: index 0 = hottest / freshest, 2 = coolest / oldest
    const SPR = kind === "fire" ? {
      ramp: [
        sprite([[0, "rgba(255,251,214,0.95)"], [0.30, "rgba(255,206,84,0.60)"], [1, "rgba(255,140,0,0)"]]),
        sprite([[0, "rgba(255,168,60,0.85)"], [0.35, "rgba(255,104,0,0.50)"], [1, "rgba(255,60,0,0)"]]),
        sprite([[0, "rgba(255,92,24,0.80)"], [0.40, "rgba(219,42,0,0.45)"], [1, "rgba(150,20,0,0)"]]),
      ],
      ember: sprite([[0, "rgba(255,244,200,1)"], [0.30, "rgba(255,178,70,0.90)"], [1, "rgba(255,120,0,0)"]]),
      haze: sprite([[0, "rgba(46,40,38,0.32)"], [1, "rgba(46,40,38,0)"]]),
    } : {
      ramp: [
        sprite([[0, "rgba(236,252,255,0.95)"], [0.30, "rgba(158,224,255,0.60)"], [1, "rgba(80,170,255,0)"]]),
        sprite([[0, "rgba(148,214,255,0.85)"], [0.35, "rgba(70,158,255,0.50)"], [1, "rgba(30,100,255,0)"]]),
        sprite([[0, "rgba(84,160,255,0.72)"], [0.40, "rgba(32,92,230,0.42)"], [1, "rgba(12,52,180,0)"]]),
      ],
      ember: null,
      haze: sprite([[0, "rgba(142,202,255,0.22)"], [1, "rgba(142,202,255,0)"]]),
    };

    // particles: bx = base x (sway is added at draw time so it never drifts)
    const parts: P[] = [];
    const push = (p: P) => { if (parts.length < 420) parts.push(p); };

    const spawnFlame = (front: boolean) => {
      let bx: number, tall = false;
      if (front) {
        // front tongues hug the side rims; rare short licks at the bottom centre
        const r = Math.random();
        bx = r < 0.42 ? rnd(CL - 0.02 * S, CL + 0.09 * S)
          : r < 0.84 ? rnd(CR - 0.09 * S, CR + 0.02 * S)
          : rnd(CL + 0.28 * S, CR - 0.28 * S);
      } else {
        // back: the bottom wall (under-glow and an occasional crest above the top edge) plus
        // columns rising just outside the left and right rims: the "engulfed in 3D" read
        // comes from these side walls behind the art
        const r = Math.random();
        bx = r < 0.55 ? rnd(CL + 0.04 * S, CR - 0.04 * S)
          : r < 0.78 ? rnd(CL - 0.07 * S, CL + 0.02 * S)
          : rnd(CR - 0.02 * S, CR + 0.07 * S);
        tall = Math.random() < 0.28;
      }
      const centre = front && bx > CL + 0.2 * S && bx < CR - 0.2 * S;
      const k = (front ? 0.72 : 1) * (centre ? 0.55 : 1);
      push({
        type: "flame", front, bx,
        y: rnd(CB - 0.02 * S, CB + 0.05 * S),
        vx: 0,
        vy: -rnd(0.30, 0.62) * S * k * (tall ? 1.7 : 1),
        r: rnd(0.065, 0.125) * S * (front ? 0.75 : 1) * (centre ? 0.6 : 1),
        life: rnd(0.65, 1.2) * (tall ? 1.35 : 1) * (centre ? 0.6 : 1),
        age: 0, swayF: rnd(6, 11), swayA: rnd(0.03, 0.09) * S, ph: rnd(0, TAU),
      });
    };
    const spawnEmber = () => push({
      type: "ember", front: Math.random() < 0.5,
      bx: rnd(CL + 0.05 * S, CR - 0.05 * S), y: rnd(CB - 0.15 * S, CB),
      vx: rnd(-0.06, 0.06) * S, vy: -rnd(0.5, 0.95) * S,
      r: rnd(1.6, 3.2) * (S / 280),
      life: rnd(1.0, 1.7), age: 0, swayF: rnd(5, 9), swayA: rnd(0.02, 0.05) * S, ph: rnd(0, TAU),
    });
    const spawnSmoke = () => push({
      type: "haze", front: false,
      bx: rnd(CL + 0.1 * S, CR - 0.1 * S), y: rnd(CT - 0.05 * S, CT + 0.35 * S),
      vx: rnd(-0.03, 0.03) * S, vy: -rnd(0.10, 0.22) * S, grow: 0.10 * S,
      r: rnd(0.06, 0.11) * S, life: rnd(0.9, 1.5), age: 0,
      swayF: rnd(2, 4), swayA: rnd(0.01, 0.03) * S, ph: rnd(0, TAU),
    });
    const spawnCrown = (n: number) => {
      // the first "wave hits the top edge" splash: droplets arc up and out, then gravity
      // pulls them down past the sides. Centre ones go BEHIND the art (they crest over the
      // top rim), edge ones fall in front of it
      for (let i = 0; i < n; i++) {
        const bx = rnd(CL, CR);
        const edge = bx < CL + 0.22 * S || bx > CR - 0.22 * S;
        push({
          type: "drop", front: edge, bx,
          y: rnd(CT - 0.05 * S, CT + 0.01 * S),
          vx: rnd(-0.30, 0.30) * S * (edge ? 1 : 0.55),
          vy: -rnd(0.15, 0.55) * S,
          r: rnd(0.014, 0.038) * S, life: 3, age: 0,
          swayF: 0, swayA: 0, ph: 0,
        });
      }
    };
    const spawnRivulet = () => {
      // streams running down the FRONT face, clinging to the left and right rims so the art
      // stays readable; a few sheets down the middle
      const r = Math.random();
      const bx = r < 0.38 ? rnd(CL - 0.01 * S, CL + 0.06 * S)
        : r < 0.76 ? rnd(CR - 0.06 * S, CR + 0.01 * S)
        : rnd(CL + 0.1 * S, CR - 0.1 * S);
      push({
        type: "drop", front: true, bx,
        y: rnd(CT - 0.06 * S, CT + 0.02 * S),
        vx: rnd(-0.02, 0.02) * S, vy: rnd(0.05, 0.25) * S,
        r: rnd(0.016, 0.042) * S, life: 3, age: 0,
        swayF: rnd(7, 13), swayA: rnd(0.006, 0.018) * S, ph: rnd(0, TAU),
      });
    };
    const spawnSplash = (x: number, y: number) => {
      const n = 2 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) push({
        type: "splash", front: true, bx: x, y,
        vx: rnd(-0.35, 0.35) * S, vy: -rnd(0.05, 0.30) * S,
        r: rnd(0.007, 0.016) * S, life: rnd(0.25, 0.45), age: 0,
        swayF: 0, swayA: 0, ph: 0,
      });
    };
    const spawnMist = (n: number) => {
      for (let i = 0; i < n; i++) push({
        type: "haze", front: false,
        bx: rnd(CL, CR), y: rnd(CT + 0.15 * S, CB), grow: 0.04 * S,
        vx: rnd(-0.02, 0.02) * S, vy: -rnd(0.02, 0.06) * S,
        r: rnd(0.14, 0.28) * S, life: rnd(1.4, 2.0), age: 0,
        swayF: rnd(1, 3), swayA: rnd(0.01, 0.02) * S, ph: rnd(0, TAU),
      });
    };

    const TOTAL = 2.7, EMIT = kind === "fire" ? 1.5 : 1.15;
    const G = 2.6 * S, BUOY = 1.05 * S;
    let raf = 0, last = performance.now(), elapsed = 0;
    let accB = 0, accF = 0, accE = 0, accS = 0;
    if (kind === "water") { spawnCrown(26); spawnMist(8); }

    const step = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000);
      last = now; elapsed += dt;
      // global envelope: full strength, then a long cool-down fade
      const env = elapsed < 1.85 ? 1 : Math.max(0, 1 - (elapsed - 1.85) / 0.8);

      if (elapsed < EMIT) {
        const ease = 1 - elapsed / EMIT;
        if (kind === "fire") {
          accB += 95 * ease * dt; while (accB > 1) { spawnFlame(false); accB--; }
          accF += 48 * ease * dt; while (accF > 1) { spawnFlame(true); accF--; }
          accE += 7 * dt; while (accE > 1) { spawnEmber(); accE--; }
          if (elapsed > 0.45) { accS += 6 * dt; while (accS > 1) { spawnSmoke(); accS--; } }
        } else {
          accF += 55 * ease * dt; while (accF > 1) { spawnRivulet(); accF--; }
        }
      }

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]!;
        p.age += dt;
        if (p.age >= p.life) { parts.splice(i, 1); continue; }
        if (p.type === "flame") {
          p.vy = Math.max(p.vy - BUOY * dt, -1.5 * S);          // buoyancy
          p.vx = (p.vx + rnd(-1, 1) * 0.25 * S * dt) * 0.95;    // turbulent wander
        } else if (p.type === "ember") {
          p.vy -= 0.5 * S * dt;
        } else if (p.type === "haze") {
          p.r += (p.grow ?? 0) * dt;                             // smoke and mist billow
        } else if (p.type === "drop") {
          p.vy = Math.min(p.vy + G * dt, 1.6 * S);              // gravity with a terminal speed
          if (p.y > CB + 0.04 * S) {                             // hit the bottom rim
            spawnSplash(p.bx, CB + 0.03 * S);
            parts.splice(i, 1);
            continue;
          }
        } else {
          p.vy += G * dt;
        }
        p.bx += p.vx * dt;
        p.y += p.vy * dt;
      }

      bctx.clearRect(0, 0, W, H);
      fctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        const ctx = p.front ? fctx : bctx;
        const t = p.age / p.life;
        let img: HTMLCanvasElement | null, a: number, rr = p.r, elong = 1, swayK = 1;
        if (p.type === "flame") {
          img = SPR.ramp[t < 0.32 ? 0 : t < 0.68 ? 1 : 2]!;
          a = Math.min(1, t * 5) * Math.pow(1 - t, 1.15);
          rr = p.r * (0.6 + 0.4 * (1 - t));                     // taper toward the tip
          elong = 1.65;
          swayK = 0.35 + t;                                      // tips sway more than roots
        } else if (p.type === "ember") {
          img = SPR.ember;
          a = (0.55 + 0.45 * Math.sin(p.age * 26 + p.ph)) * Math.pow(1 - t, 0.8);
        } else if (p.type === "haze") {
          img = SPR.haze;
          a = Math.min(1, t * 4) * Math.pow(1 - t, 1.4);
        } else if (p.type === "drop") {
          const sp = Math.min(1, Math.abs(p.vy) / (1.2 * S));   // fast water = white foam
          img = SPR.ramp[sp > 0.55 ? 0 : sp > 0.25 ? 1 : 2]!;
          a = 0.9;
          elong = 1 + 1.6 * sp;                                  // stretch with speed
        } else {
          img = SPR.ramp[0]!;
          a = 0.9 * (1 - t);
        }
        if (!img) continue;
        ctx.globalAlpha = Math.max(0, Math.min(1, a * env));
        // additive glow for the hot and wet bodies; normal alpha for smoke and mist
        ctx.globalCompositeOperation = p.type === "haze" ? "source-over" : "lighter";
        const dx = p.bx + (p.swayA ? Math.sin(p.age * p.swayF + p.ph) * p.swayA * swayK : 0);
        ctx.drawImage(img, dx - rr, p.y - rr * elong, rr * 2, rr * 2 * elong);
      }

      if (elapsed < TOTAL && (elapsed < EMIT || parts.length)) {
        raf = requestAnimationFrame(step);
      } else {
        bctx.clearRect(0, 0, W, H);
        fctx.clearRect(0, 0, W, H);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [kind]);

  return (
    <>
      <div className={`${css.fx} ${css.back} ${css[kind]}`} aria-hidden>
        <span className={css.aura} />
        <canvas ref={backRef} className={css.canvas} />
      </div>
      <div className={`${css.fx} ${css.front} ${css[kind]}`} aria-hidden>
        <canvas ref={frontRef} className={css.canvas} />
      </div>
    </>
  );
}
