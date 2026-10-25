import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { usePlayer } from "./engine";
import { glyph } from "./glyphs";
import { stageQuery, type Stage, type TrackSound } from "./sound";
import css from "./SoundWindow.module.css";

/** The song's stage, live (design/code/screens/player.md, «Сцена»): a floor seen from where
 *  the listener sits, the band on it in rows, each part a glass plate with its glyph and name
 *  standing over its spot on the floor.
 *  - Front to back is a stage plot (voice in front, then guitars, keys, the rest, the bass,
 *    the drums at the back): the profile cannot tell near from far reliably, and most of a mix
 *    sits in the middle, so a literal map piled every part in one spot (the first try).
 *  - Left and right are measured: a part's spot is where it sits right now (the server's live
 *    frames, 10 a second; the owner checked pan by ear, it holds).
 *  - The room is the measured echo: dry, the back wall stands right behind the drums; «как в
 *    зале», the floor runs far back into haze.
 *  - A part that plays lights up in its own colour: its plate fills with light, its spot glows
 *    on the floor and tints the haze behind it, a hit sends a ring across the floor, like water.
 *    The owner (2026-10-25): the first strips of light, as long as the part's stereo width, said
 *    nothing he could hear; the glow under the names looked cheap and unclear; quiet parts were
 *    not seen at all. So the light is measured against the part's own loud level, not against
 *    the loudest stem, and a part that only comes in now and then lights as clearly as the voice.
 *  - A part stands on the stage only around the time it plays (his rule): it comes up LEAD
 *    seconds before it comes in, so its name can be read, warming as the entry nears; it stays
 *    HOLD seconds after it stops; a pause shorter than MERGE keeps it standing instead of
 *    blinking. The timeline is known ahead, so all of it is a function of the playhead.
 *  - The pointer turns the camera a little. Paused, the band holds the moment under the
 *    playhead and the loop stops: nothing moves at rest. */
const ORDER = ["vocals", "guitar", "piano", "other", "bass", "drums"];
const BASE: Record<string, { key: string; label: string }> = {
  vocals: { key: "voice", label: "голос" }, drums: { key: "drums", label: "барабаны" }, bass: { key: "bass", label: "бас" },
  guitar: { key: "guitar", label: "гитара" }, piano: { key: "piano", label: "клавишные" }, other: { key: "synth_other", label: "синты" },
};
/** Each part's light: one lightness and chroma (OKLCH .76–.92 / .07–.14), so none shouts over
 *  the rest, with hues away from the three scales' (78, 222, 322); the voice gets the warm white
 *  of a follow spot. A colour per part tells them apart at a glance, wherever they stand. */
type RGB = readonly [number, number, number];
const HUE: Record<string, RGB> = {
  vocals: [255, 223, 177], guitar: [254, 164, 124], piano: [135, 227, 196],
  other: [195, 176, 253], bass: [115, 182, 250], drums: [245, 137, 182],
};
const ROOM: Record<string, number> = { dry: 1.15, little: 1.7, noticeable: 2.5, hall: 3.8 };
export const ROOM_WORD: Record<string, string> = { dry: "близко к уху", little: "небольшая комната", noticeable: "просторная комната", hall: "зал" };

const GATE = -38; // dB under the loudest stem frame: below it, silence or another part's bleed
const MIN_ON = 6; // s a part plays in the whole song to stand on the stage: 4–5 s blips were bleed
const LEAD = 3, HOLD = 2.5, MERGE = 4; // s
const FADE_IN = 1.5, FADE_OUT = 0.9; // s: fully readable 1.5 s before it comes in

/** A part's life over the song, in frames and in seconds (wins: [up from, down from]). */
type Life = { lit: Float32Array; act: Float32Array; wins: [number, number][]; ons: number[]; gate: number; pan: number };
type Src = { stem: string; key: string; label: string; rgb: RGB; z: number; pan: number; x: number; life: Life | null;
  vis: number; glow: number; warm: number; prev: number; prevAt: number; tw: number; tf: string; path: { p: Path2D; fill: boolean }[] };

const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const mix = (a: RGB, b: RGB, k: number): RGB =>
  [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
const WHITE: RGB = [255, 255, 255];
const ease = (v: number) => { const x = Math.min(1, Math.max(0, v)); return x * x * (3 - 2 * x); };
/** The computed colour of `color: var(--pl-acc)` comes as rgb(). */
const parse = (s: string): RGB => { const m = s.match(/(\d+)\D+(\d+)\D+(\d+)/); return m ? [+m[1]!, +m[2]!, +m[3]!] : [255, 240, 225]; };

/** Where a part plays and how bright, from the live frames:
 *  - it plays over its gate: GATE, or 24 dB under its own loud level (p90) for a loud part,
 *    whose bleed into the other stems sits about there;
 *  - its light is the level between its gate and its loud level, held for 0.3 s so drums glow
 *    steadily instead of flickering between hits, never under .3 while it plays;
 *  - gaps under a second are closed (beats, breaths), blips under 0.3 s dropped. */
function life(st: Stage, i: number): Life | null {
  const n = st.stems.length, F = st.frames, fps = st.fps;
  const db = new Float32Array(F), over: number[] = [];
  let ps = 0, pn = 0;
  for (let f = 0; f < F; f++) {
    const o = (f * n + i) * 2, d = st.data[o]! / 2;
    db[f] = d;
    if (d > GATE) { over.push(d); ps += st.data[o + 1]! / 100; pn++; }
  }
  if (over.length < fps * MIN_ON) return null;
  over.sort((a, b) => a - b);
  const loud = over[Math.floor(over.length * 0.9)]!, gate = Math.max(GATE, loud - 24), span = Math.max(10, loud - gate);
  const segs: [number, number][] = [];
  for (let f = 0; f < F; f++) {
    if (db[f]! <= gate) continue;
    const s = segs.at(-1);
    if (s && f - s[1] < fps) s[1] = f + 1; else segs.push([f, f + 1]);
  }
  const kept = segs.filter(([a, b]) => b - a >= fps * 0.3);
  if (kept.reduce((t, [a, b]) => t + b - a, 0) < fps * MIN_ON) return null;
  const act = new Float32Array(F), lit = new Float32Array(F), wins: [number, number][] = [];
  for (let f = 0; f < F; f++) act[f] = Math.min(1, Math.max(0, (db[f]! - gate) / span));
  for (const [a, b] of kept) {
    for (let f = a; f < b; f++) {
      let m = 0;
      for (let j = Math.max(0, f - 3); j <= Math.min(F - 1, f + 1); j++) m = Math.max(m, act[j]!);
      lit[f] = Math.max(0.3, m);
    }
    // only a second of playing calls a part onto the stage: a 0.3 s blip of keys in Power brought
    // them up for four seconds, unlit, and took them away again. A blip lights a part already there
    if (b - a < fps) continue;
    const w = wins.at(-1), w0 = a / fps - LEAD, w1 = b / fps + HOLD;
    if (w && w0 - w[1] < MERGE) w[1] = w1; else wins.push([w0, w1]);
  }
  if (!wins.length) return null;
  return { lit, act, wins, ons: kept.filter(([a, b]) => b - a >= fps).map(([a]) => a / fps), gate, pan: pn ? ps / pn : 0 };
}
/** 0..1: on the stage at second t (a soft rise from its window's start, a soft fall after it). */
const shownAt = (wins: [number, number][], t: number) => {
  for (const [a, b] of wins) if (t >= a && t < b + FADE_OUT) return ease((t - a) / FADE_IN) * (1 - ease((t - b) / FADE_OUT));
  return 0;
};
/** 0..1 as the part's next entry nears, over LEAD. */
const nearing = (ons: number[], t: number) => {
  for (const o of ons) if (o >= t) return o - t < LEAD ? ease(1 - (o - t) / LEAD) : 0;
  return 0;
};

function sources(s: TrackSound, st: Stage | null): Src[] {
  const out: Src[] = [];
  const stems = st?.stems ?? ORDER;
  for (const stem of ORDER) {
    const i = stems.indexOf(stem);
    if (i < 0) continue;
    const prof = stem === "drums" ? s.stems.filter((x) => ["kick", "snare", "hh", "cym", "toms"].includes(x.stem)) : s.stems.filter((x) => x.stem === stem);
    const lf = st ? life(st, i) : null;
    if (st ? !lf : !prof.length) continue;
    const b = BASE[stem]!;
    const named = stem === "drums" ? (s.drums ? { key: s.drums.key === "live" ? "drums_live" : "drum_machine", label: s.drums.label } : b)
      : prof[0] && !["synth_other", "voice", "vocal"].includes(prof[0].name.key) ? { key: prof[0].name.key, label: prof[0].name.label } : b;
    const pan = lf ? lf.pan : prof[0]?.pan ?? 0;
    out.push({ stem, key: named.key, label: named.label, rgb: HUE[stem]!, z: 0, pan, x: pan, life: lf, vis: 1, glow: 0.45, warm: 0,
      prev: 0, prevAt: 0, tw: 0, tf: "", path: glyph(named.key).map((g) => ({ p: new Path2D(g.d), fill: !!g.fill })) });
  }
  // rows from the front edge to just behind the middle, evenly; drawn from the back. A part
  // keeps its row while it is off the stage: places never shuffle
  out.forEach((x, i) => { x.z = out.length < 2 ? 0.4 : 0.05 + (i * 0.9) / (out.length - 1); });
  return out.reverse();
}

export function StageScene({ trackId, s, active }: { trackId: string; s: TrackSound; active: boolean }) {
  const { data: st } = useQuery({ ...stageQuery(trackId), enabled: active && s.hasStage });
  const cv = useRef<HTMLCanvasElement>(null);
  const cam = useRef({ yaw: 0, pitch: 0, ty: 0, tp: 0, intro: 0, t0: 0, opened: "" });
  // a closed window forgets its opening: the next one unfolds the floor again
  useEffect(() => { if (!active) cam.current.opened = ""; }, [active]);

  useEffect(() => {
    const canvas = cv.current, g = canvas?.getContext("2d");
    if (!canvas || !g || !active) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // while the live frames load, the floor alone: the profile's parts swapped for the live
    // ones a moment later read as a jump
    const srcs = s.hasStage && !st ? [] : sources(s, st ?? null);
    const room = ROOM[s.echo.key] ?? 1.7;
    const head = glyph("listener").map((x) => new Path2D(x.d));
    const ripples: { x: number; z: number; t0: number; k: number; rgb: RGB }[] = [];
    let W = 0, H = 0, dpr = 1, u = 1, raf = 0, last = 0, seen = 99, font = "system-ui, sans-serif";
    let acc: RGB = [255, 240, 225], lit: RGB = acc;
    let base = usePlayer.getState().positionMs, at = performance.now();
    const c = cam.current;
    // the floor unfolds once per opening, not again when the live frames arrive
    if (c.opened !== trackId) { c.intro = reduce ? 1 : 0; c.t0 = performance.now(); c.opened = trackId; }
    const t0 = c.t0;
    const songAt = (now: number, playing: boolean) => (base + (playing ? now - at : 0)) / 1000;

    // the parts rise to what stands at the playhead (the first steps bring them in); without live
    // frames or with reduced motion, all of them, softly lit, for good
    if (st && !reduce) {
      const f = Math.min(st.frames - 1, Math.max(0, Math.round(songAt(performance.now(), false) * st.fps)));
      for (const src of srcs) if (src.life) { src.vis = 0; src.glow = src.life.lit[f]!; }
    }

    // the layout size, not the box on screen: the window grows out of the ring with a transform,
    // and a canvas measured mid-growth was a sixth of its size and drew blurred
    const size = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.round(w * dpr); H = Math.round(h * dpr);
      u = (w / 500) * dpr; // one design pixel at the scene's 500 px
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    };
    /** A floor point: x from -1 (left ear) to 1, z from 0 (the front edge) back; the band
     *  stands in z 0..1, the room runs on to `room`. A stage view, not a camera's: the band's
     *  rows keep an even step on screen (true perspective squeezed the back rows into one
     *  line), the floor still narrows towards the back, and behind the band it runs off to the
     *  horizon as a real floor does. As the window opens, the floor unfolds from the front edge. */
    const proj = (x: number, z: number) => {
      const e = 1 - (1 - c.intro) ** 3, tilt = c.pitch * 0.04;
      const fy = H * (0.9 + tilt * 0.3), yb = fy - H * (0.6 + tilt) * e, hy = fy - H * (0.82 + tilt) * e;
      const y = z <= 1 ? fy - (fy - yb) * Math.max(0, z) ** 0.9 + (z < 0 ? -z * H * 0.3 : 0) : yb - (yb - hy) * (1 - 1 / (1 + 0.9 * (z - 1)));
      const k = 1 / (1 + 0.75 * Math.max(0, z));
      return { x: W / 2 + x * W * 0.43 * k - c.yaw * W * 0.045 * k, y, k };
    };
    const glyphAt = (paths: { p: Path2D; fill: boolean }[] | Path2D[], x: number, y: number, size: number, a: number) => {
      g.save();
      g.globalAlpha *= a;
      g.translate(x - size / 2, y - size / 2); g.scale(size / 24, size / 24);
      g.strokeStyle = "#fff"; g.fillStyle = "#fff"; g.lineWidth = 1.7; g.lineCap = "round"; g.lineJoin = "round";
      for (const part of paths) {
        if (part instanceof Path2D) g.stroke(part);
        else if (part.fill) g.fill(part.p); else g.stroke(part.p);
      }
      g.restore();
    };
    const pill = (x: number, y: number, w: number, h: number) => { g.beginPath(); g.roundRect(x, y, w, h, h / 2); };
    /** A soft light lying on the floor: a flattened round glow. */
    const pool = (x: number, y: number, rx: number, flat: number, stops: [number, string][]) => {
      g.save(); g.translate(x, y); g.scale(1, flat);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      for (const [o, col] of stops) gr.addColorStop(o, col);
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill();
      g.restore();
    };

    const draw = (now: number) => {
      if (++seen > 30) {
        const cs = getComputedStyle(canvas);
        acc = parse(cs.color); lit = mix(acc, WHITE, 0.5); font = cs.fontFamily || font; seen = 0;
      }
      g.clearRect(0, 0, W, H);
      // the floor, tinted by the cover's light, a grid that fades into the room's depth
      const fl = proj(-1, 0), fr = proj(1, 0), br = proj(1, room), bl = proj(-1, room);
      const floor = g.createLinearGradient(0, bl.y, 0, fl.y);
      floor.addColorStop(0, rgba(lit, 0)); floor.addColorStop(0.55, rgba(lit, 0.035)); floor.addColorStop(1, rgba(lit, 0.075));
      g.fillStyle = floor;
      g.beginPath(); g.moveTo(fl.x, fl.y); g.lineTo(fr.x, fr.y); g.lineTo(br.x, br.y); g.lineTo(bl.x, bl.y); g.closePath(); g.fill();
      g.lineWidth = dpr;
      const ink = mix(lit, WHITE, 0.55);
      for (let i = 0; i <= 8; i++) {
        const x = -1 + i * 0.25, a = proj(x, 0), b = proj(x, room);
        const lg = g.createLinearGradient(0, b.y, 0, a.y);
        lg.addColorStop(0, rgba(ink, 0)); lg.addColorStop(1, rgba(ink, i === 4 ? 0.13 : 0.065));
        g.strokeStyle = lg; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      for (let z = 0; z <= room + 1e-6; z += room / Math.round(room * 4)) {
        const a = proj(-1, z), b = proj(1, z);
        g.strokeStyle = rgba(ink, 0.075 * a.k);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      // the haze at the back: deeper rooms keep more of it
      const hr = (br.x - bl.x) * 0.75;
      pool((bl.x + br.x) / 2, bl.y, hr, (H * 0.22) / hr, [[0, rgba(acc, 0.06 + 0.04 * room)], [1, rgba(acc, 0)]]);

      // light, added to what is under it: the playing parts tint the haze over their place,
      // rings run out from hits, each part's light lies on the floor where it stands
      g.globalCompositeOperation = "lighter";
      for (const src of srcs) {
        const a = src.glow * src.vis;
        if (a < 0.01) continue;
        // small and faint: added over a light cover, a wide one washed the back into a white blot
        const p = proj(src.x * 0.8, room);
        pool(p.x, p.y, W * 0.17, 0.4, [[0, rgba(src.rgb, 0.075 * a)], [0.6, rgba(src.rgb, 0.03 * a)], [1, rgba(src.rgb, 0)]]);
      }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]!, t = (now - r.t0) / (600 + 260 * room);
        if (t >= 1) { ripples.splice(i, 1); continue; }
        const p = proj(r.x, r.z), rx = (16 + 70 * t) * u * p.k;
        g.strokeStyle = rgba(r.rgb, (1 - t) ** 2 * 0.6 * r.k); g.lineWidth = 1.2 * dpr;
        g.beginPath(); g.ellipse(p.x, p.y, rx, rx * 0.3, 0, 0, Math.PI * 2); g.stroke();
      }
      for (const src of srcs) {
        if (src.vis < 0.005) continue;
        const p = proj(src.x, src.z), a = src.glow * src.vis;
        pool(p.x, p.y, 30 * u * p.k, 0.3, [[0, rgba(src.rgb, 0.55 * a + 0.12 * src.warm * src.vis)], [0.4, rgba(src.rgb, 0.2 * a)], [1, rgba(src.rgb, 0)]]);
      }
      g.globalCompositeOperation = "source-over";

      // the band, from the back row to the front: a spot on the floor, a thread of light up to
      // the plate, the plate with its glyph and name
      const gap = Math.abs(proj(0, 0).y - proj(0, 1).y) / Math.max(1, srcs.length - 1);
      srcs.forEach((src, i) => {
        const show = Math.min(1, Math.max(0, c.intro * 1.6 - (srcs.length - 1 - i) * 0.1)) * src.vis;
        if (show <= 0.005) return;
        const p = proj(src.x, src.z), L = src.glow, warm = src.warm * (1 - L);
        const col = mix(WHITE, src.rgb, Math.min(1, L * 1.4 + warm));
        const sc = 0.84 + 0.16 * p.k, h = 25 * u * sc, gs = 14 * u * sc, pad = 8 * u * sc;
        const f = `500 ${(11.5 * u * sc).toFixed(1)}px ${font}`;
        if (src.tf !== f) { g.font = f; src.tw = g.measureText(src.label).width; src.tf = f; }
        const pw = pad + gs + 6 * u * sc + src.tw + 12 * u * sc;
        // the plate rises into its place as it comes and sinks as it goes
        const lift = Math.max(h * 0.75, Math.min(gap * 0.55, (20 + 14 * p.k) * u)) + h / 2;
        const cy = p.y - lift + (1 - show) * 8 * u, cx = Math.min(W - pw / 2 - 6 * u, Math.max(pw / 2 + 6 * u, p.x));
        g.globalAlpha = show * (0.85 + 0.15 * p.k);
        // the spot: where the part stands, a point even while it waits
        pool(p.x, p.y, 4.5 * u * p.k, 0.45, [[0, rgba(mix(col, WHITE, 0.5), 0.5 + 0.5 * L)], [1, rgba(col, 0)]]);
        // the thread from the spot to the plate
        const top = cy + h / 2, tx = Math.min(cx + pw / 2 - h / 2, Math.max(cx - pw / 2 + h / 2, p.x));
        const th = g.createLinearGradient(0, p.y, 0, top);
        th.addColorStop(0, rgba(col, 0.05)); th.addColorStop(1, rgba(col, 0.22 + 0.5 * L));
        g.strokeStyle = th; g.lineWidth = Math.max(1, u);
        g.beginPath(); g.moveTo(p.x, p.y - 2 * u); g.lineTo(tx, top); g.stroke();

        g.save();
        g.translate(cx, cy); const zs = 0.94 + 0.06 * show; g.scale(zs, zs);
        const x0 = -pw / 2, y0 = -h / 2, gx = x0 + pad + gs / 2;
        // glass: a dark frosted body over a soft shadow, the part's light inside it
        g.shadowColor = "rgba(0,0,0,.32)"; g.shadowBlur = 12 * u; g.shadowOffsetY = 3 * u;
        g.fillStyle = "rgba(16,14,24,.5)"; pill(x0, y0, pw, h); g.fill();
        g.shadowOffsetY = 0;
        if (L > 0.02) {
          g.shadowColor = rgba(src.rgb, 0.7 * L); g.shadowBlur = (10 + 14 * L) * u;
          const inner = g.createRadialGradient(gx, 0, 0, gx, 0, pw);
          inner.addColorStop(0, rgba(src.rgb, 0.62 * L)); inner.addColorStop(0.55, rgba(src.rgb, 0.3 * L)); inner.addColorStop(1, rgba(src.rgb, 0.16 * L));
          g.fillStyle = inner; pill(x0, y0, pw, h); g.fill();
        }
        g.shadowColor = "transparent"; g.shadowBlur = 0;
        // the rim: light catching the top edge, in the part's colour as it plays or nears
        const rim = g.createLinearGradient(0, y0, 0, y0 + h);
        rim.addColorStop(0, rgba(mix(WHITE, src.rgb, Math.min(1, L + warm)), 0.3 + 0.45 * L + 0.35 * warm));
        rim.addColorStop(1, rgba(mix(WHITE, src.rgb, L), 0.06 + 0.2 * L));
        g.strokeStyle = rim; g.lineWidth = Math.max(1, 0.9 * u);
        pill(x0 + 0.5, y0 + 0.5, pw - 1, h - 1); g.stroke();
        // glyph and name: dimmer while the part waits, full white as it plays
        glyphAt(src.path, gx, 0, gs, 0.62 + 0.38 * Math.max(L, warm));
        g.globalAlpha *= 0.64 + 0.36 * Math.max(L, warm);
        g.fillStyle = "#fff"; g.font = f; g.textAlign = "left"; g.textBaseline = "middle";
        g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = 3 * u;
        g.fillText(src.label, x0 + pad + gs + 6 * u * sc, 0.5 * u);
        g.restore();
        g.globalAlpha = 1;
      });
      // the listener at the front, and which ear is which
      const me = proj(0, -0.12);
      g.globalAlpha = 1;
      glyphAt(head, me.x, Math.min(me.y, H - 12 * u), 19 * u, 0.5 * c.intro);
      g.globalAlpha = 0.4 * c.intro; g.fillStyle = "#fff"; g.font = `600 ${Math.round(10.5 * u)}px ${font}`; g.textBaseline = "alphabetic";
      g.textAlign = "left"; g.fillText("Л", fl.x + 8 * u, fl.y - 6 * u);
      g.textAlign = "right"; g.fillText("П", fr.x - 8 * u, fr.y - 6 * u);
      g.globalAlpha = 1;
    };

    /** One step: each part's place on the stage and its light towards the playhead (held when
     *  paused), the camera towards the pointer; true while anything still moves. */
    const step = (now: number, dt: number): boolean => {
      const playing = usePlayer.getState().playing && !!st;
      let moving = false;
      const t = songAt(now, playing);
      const n = st?.stems.length ?? 6;
      const f = st ? Math.min(st.frames - 1.001, Math.max(0, t * st.fps)) : 0;
      const i0 = Math.floor(f), k = f - i0;
      for (const src of srcs) {
        const lf = src.life;
        if (!lf || !st || reduce) continue;
        const want = shownAt(lf.wins, t), warm = nearing(lf.ons, t);
        const target = lf.lit[i0]! * (1 - k) + lf.lit[i0 + 1]! * k;
        // a seek blends in a fifth of a second; the rise and fall over the playhead are in `want`
        src.vis += (want - src.vis) * (1 - Math.exp(-dt / 140));
        src.warm += (warm - src.warm) * (1 - Math.exp(-dt / 140));
        // the light answers at once and lets go slowly
        src.glow += (target - src.glow) * (1 - Math.exp(-dt / (target > src.glow ? 70 : 420)));
        const si = st.stems.indexOf(src.stem), o0 = (i0 * n + si) * 2, o1 = ((i0 + 1) * n + si) * 2;
        if (playing && (st.data[o0]! * (1 - k) + st.data[o1]! * k) / 2 > lf.gate) src.pan = (st.data[o0 + 1]! * (1 - k) + st.data[o1 + 1]! * k) / 100;
        src.x += (src.pan - src.x) * (1 - Math.exp(-dt / 420));
        // a hit: the part rose sharply within the last 120 ms
        const a = lf.act[i0]! * (1 - k) + lf.act[i0 + 1]! * k;
        if (playing && a - src.prev > 0.22 && a > 0.6 && src.vis > 0.5 && ripples.length < 28) {
          ripples.push({ x: src.x, z: src.z, t0: now, k: a, rgb: src.rgb });
          src.prev = a;
        }
        if (now - src.prevAt > 120) { src.prev = a; src.prevAt = now; }
        if (Math.abs(want - src.vis) > 0.002 || Math.abs(warm - src.warm) > 0.002 || Math.abs(target - src.glow) > 0.004 || Math.abs(src.pan - src.x) > 0.004) moving = true;
      }
      c.yaw += (c.ty - c.yaw) * (1 - Math.exp(-dt / 240));
      c.pitch += (c.tp - c.pitch) * (1 - Math.exp(-dt / 240));
      if (Math.abs(c.ty - c.yaw) > 0.002 || Math.abs(c.tp - c.pitch) > 0.002) moving = true;
      if (c.intro < 1) { c.intro = Math.min(1, (now - t0) / 1000); moving = true; }
      return moving || playing || ripples.length > 0;
    };
    const frame = (now: number) => {
      raf = 0;
      if (document.hidden) return;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      const go = step(now, dt);
      draw(now);
      if (go) raf = requestAnimationFrame(frame); else last = 0;
    };
    const kick = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); };
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      c.ty = ((e.clientX - r.left) / r.width - 0.5) * 2;
      c.tp = ((e.clientY - r.top) / r.height - 0.5) * 2;
      kick();
    };
    const leave = () => { c.ty = 0; c.tp = 0; kick(); };

    size();
    if (reduce) draw(performance.now());
    else {
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerleave", leave);
      kick();
    }
    // a seek while paused moves the band to the new moment too
    const off = usePlayer.subscribe((x, p) => {
      if (x.positionMs !== p.positionMs) { base = x.positionMs; at = performance.now(); if (!reduce) kick(); }
      if (x.playing !== p.playing) { at = performance.now(); if (!reduce) kick(); }
    });
    const ro = new ResizeObserver(() => { size(); draw(performance.now()); });
    ro.observe(canvas);
    document.addEventListener("visibilitychange", kick);
    return () => {
      off(); ro.disconnect(); cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", kick);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
    };
  }, [st, s, active]);

  return (
    <div className={css.scene}>
      <canvas ref={cv} className={css.canvas} aria-label="Сцена: где звучит каждая партия" role="img" />
      <span className={css.sceneTop}><span>Сцена</span><span>{ROOM_WORD[s.echo.key] ?? ""}</span></span>
    </div>
  );
}
