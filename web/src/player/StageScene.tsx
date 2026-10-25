import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { usePlayer } from "./engine";
import { glyph } from "./glyphs";
import { stageQuery, type Stage, type TrackSound } from "./sound";
import css from "./SoundWindow.module.css";

/** The song's stage, live (design/code/screens/player.md, «Сцена»): a floor seen from where
 *  the listener sits, the band on it in rows, each part a strip of light with its glyph.
 *  - Front to back is a stage plot (voice in front, then guitars, keys, the rest, the bass,
 *    the drums at the back): the profile cannot tell near from far reliably, and most of a mix
 *    sits in the middle, so a literal map piled every part in one spot (the first try).
 *  - Left and right are measured: a strip's middle is where its part sits right now (the
 *    server's live frames, 10 a second; the owner checked pan by ear, it holds) and its length
 *    is the part's stereo width, so a narrow voice is a spot and wide guitars a band.
 *  - The room is the measured echo: dry, the back wall stands right behind the drums; «как в
 *    зале», the floor runs far back into haze.
 *  - A louder part glows brighter and taller; a hit sends a ring across the floor, like water.
 *  - The pointer turns the camera a little. Paused, the band settles to its average and the
 *    loop stops: nothing moves at rest. */
const ORDER = ["vocals", "guitar", "piano", "other", "bass", "drums"];
const BASE: Record<string, { key: string; label: string }> = {
  vocals: { key: "voice", label: "голос" }, drums: { key: "drums", label: "барабаны" }, bass: { key: "bass", label: "бас" },
  guitar: { key: "guitar", label: "гитара" }, piano: { key: "piano", label: "клавишные" }, other: { key: "synth_other", label: "синты" },
};
const ROOM: Record<string, number> = { dry: 1.15, little: 1.7, noticeable: 2.5, hall: 3.8 };
export const ROOM_WORD: Record<string, string> = { dry: "близко к уху", little: "небольшая комната", noticeable: "просторная комната", hall: "зал" };

type Src = { stem: string; key: string; label: string; z: number; half: number; pan: number; avg: number;
  lv: number; x: number; prev: number; prevAt: number; path: { p: Path2D; fill: boolean }[] };

/** The accent at an alpha; the computed colour of `color: var(--pl-acc)` comes as rgb(). */
const alpha = (rgb: string, a: number) => (rgb.startsWith("rgb(") ? rgb.replace("rgb(", "rgba(").replace(")", `, ${a.toFixed(3)})`) : `rgba(255,255,255,${a.toFixed(3)})`);
/** The stage light: the accent lifted towards white, so it reads as light over a cover of the
 *  same hue (red pools vanished on Power's red). */
const light = (rgb: string) => {
  const m = rgb.match(/(\d+)\D+(\d+)\D+(\d+)/);
  if (!m) return "rgb(255, 240, 225)";
  const mix = (v: string) => Math.round(+v + (255 - +v) * 0.5);
  return `rgb(${mix(m[1]!)}, ${mix(m[2]!)}, ${mix(m[3]!)})`;
};
const LO = -42; // dB under the loudest stem frame where a part is silent here
const lin = (db: number) => Math.max(0, Math.min(1, (db - LO) / -LO)) ** 1.25;

function sources(s: TrackSound, st: Stage | null): Src[] {
  const out: Src[] = [];
  const stems = st?.stems ?? ORDER;
  for (const stem of ORDER) {
    const i = stems.indexOf(stem);
    if (i < 0) continue;
    const prof = stem === "drums" ? s.stems.filter((x) => ["kick", "snare", "hh", "cym", "toms"].includes(x.stem)) : s.stems.filter((x) => x.stem === stem);
    let avg = 0.55, pan = prof[0]?.pan ?? 0;
    if (st) {
      let sum = 0, n = 0, loud = 0, ps = 0, pn = 0;
      for (let f = 0; f < st.frames; f += 2) {
        const o = (f * stems.length + i) * 2, db = st.data[o]! / 2;
        sum += lin(db); n++;
        if (db > -30) { loud++; ps += st.data[o + 1]! / 100; pn++; }
      }
      if (loud < st.frames / 2 / 12) continue; // heard in less than a twelfth of the song: not on the stage
      avg = n ? sum / n : 0;
      if (pn) pan = ps / pn;
    } else if (!prof.length) continue;
    const b = BASE[stem]!;
    const named = stem === "drums" ? (s.drums ? { key: s.drums.key === "live" ? "drums_live" : "drum_machine", label: s.drums.label } : b)
      : prof[0] && !["synth_other", "voice", "vocal"].includes(prof[0].name.key) ? { key: prof[0].name.key, label: prof[0].name.label } : b;
    const width = prof.length ? Math.max(...prof.map((x) => x.width)) : 0.3;
    out.push({ stem, key: named.key, label: named.label, z: 0, half: 0.05 + 0.8 * width, pan, avg, lv: avg, x: pan, prev: avg, prevAt: 0,
      path: glyph(named.key).map((g) => ({ p: new Path2D(g.d), fill: !!g.fill })) });
  }
  // rows from the front edge to just behind the middle, evenly; drawn from the back
  out.forEach((x, i) => { x.z = out.length < 2 ? 0.4 : 0.05 + (i * 0.9) / (out.length - 1); });
  return out.reverse();
}

export function StageScene({ trackId, s, active }: { trackId: string; s: TrackSound; active: boolean }) {
  const { data: st } = useQuery({ ...stageQuery(trackId), enabled: active && s.hasStage });
  const cv = useRef<HTMLCanvasElement>(null);
  const cam = useRef({ yaw: 0, pitch: 0, ty: 0, tp: 0, intro: 0 });

  useEffect(() => {
    const canvas = cv.current, g = canvas?.getContext("2d");
    if (!canvas || !g || !active) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const srcs = sources(s, st ?? null);
    const room = ROOM[s.echo.key] ?? 1.7;
    const head = glyph("listener").map((x) => new Path2D(x.d));
    const ripples: { x: number; z: number; half: number; t0: number; k: number }[] = [];
    let W = 0, H = 0, dpr = 1, u = 1, raf = 0, last = 0, acc = "", lit = "", seen = 99;
    let base = usePlayer.getState().positionMs, at = performance.now();
    const c = cam.current;
    c.intro = reduce ? 1 : 0;
    const t0 = performance.now();

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
      g.globalAlpha = a;
      g.translate(x - size / 2, y - size / 2); g.scale(size / 24, size / 24);
      g.strokeStyle = "#fff"; g.fillStyle = "#fff"; g.lineWidth = 1.7; g.lineCap = "round"; g.lineJoin = "round";
      for (const part of paths) {
        if (part instanceof Path2D) g.stroke(part);
        else if (part.fill) g.fill(part.p); else g.stroke(part.p);
      }
      g.restore();
    };
    const draw = (now: number) => {
      if (++seen > 30) { acc = getComputedStyle(canvas).color; lit = light(acc); seen = 0; }
      g.clearRect(0, 0, W, H);
      // the floor, a grid that fades into the room's depth, the back wall's haze
      const fl = proj(-1, 0), fr = proj(1, 0), br = proj(1, room), bl = proj(-1, room);
      const floor = g.createLinearGradient(0, bl.y, 0, fl.y);
      floor.addColorStop(0, "rgba(255,255,255,0)"); floor.addColorStop(1, "rgba(255,255,255,.055)");
      g.fillStyle = floor;
      g.beginPath(); g.moveTo(fl.x, fl.y); g.lineTo(fr.x, fr.y); g.lineTo(br.x, br.y); g.lineTo(bl.x, bl.y); g.closePath(); g.fill();
      g.lineWidth = dpr;
      for (let i = 0; i <= 8; i++) {
        const x = -1 + i * 0.25, a = proj(x, 0), b = proj(x, room);
        const lg = g.createLinearGradient(0, b.y, 0, a.y);
        lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(1, `rgba(255,255,255,${i === 4 ? 0.12 : 0.06})`);
        g.strokeStyle = lg; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      for (let z = 0; z <= room + 1e-6; z += room / Math.round(room * 4)) {
        const a = proj(-1, z), b = proj(1, z);
        g.strokeStyle = `rgba(255,255,255,${(0.07 * a.k).toFixed(3)})`;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      // the haze at the back: deeper rooms keep more of it
      const hr = (br.x - bl.x) * 0.75, hv = H * 0.22;
      g.save(); g.translate((bl.x + br.x) / 2, bl.y); g.scale(1, hv / hr);
      const haze = g.createRadialGradient(0, 0, 0, 0, 0, hr);
      haze.addColorStop(0, alpha(acc, 0.06 + 0.04 * room)); haze.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = haze; g.beginPath(); g.arc(0, 0, hr, 0, Math.PI * 2); g.fill();
      g.restore();

      // rings on the floor
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]!, life = 600 + 260 * room, t = (now - r.t0) / life;
        if (t >= 1) { ripples.splice(i, 1); continue; }
        const p = proj(r.x, r.z), rx = (r.half * W * 0.43 + (10 + 60 * t) * u) * p.k, ry = (5 + 16 * t) * u * p.k;
        g.strokeStyle = alpha(lit, (1 - t) ** 2 * 0.55 * r.k); g.lineWidth = 1.2 * dpr;
        g.beginPath(); g.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2); g.stroke();
      }
      // the band, from the back row to the front
      srcs.forEach((src, i) => {
        const show = Math.min(1, Math.max(0, c.intro * 1.6 - (srcs.length - 1 - i) * 0.1));
        if (show <= 0) return;
        const L = src.lv, p = proj(src.x, src.z);
        const half = Math.min(src.half, 1 - Math.abs(src.x) + 0.05);
        const rx = Math.max(7 * u, half * W * 0.43 * p.k), ry = (6 + 4 * L) * u * p.k;
        // the strip of light on the floor
        g.save(); g.translate(p.x, p.y); g.scale(1, ry / rx);
        const pool = g.createRadialGradient(0, 0, 0, 0, 0, rx);
        pool.addColorStop(0, alpha(lit, (0.3 + 0.6 * L) * show));
        pool.addColorStop(0.5, alpha(acc, (0.12 + 0.34 * L) * show));
        pool.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = pool; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill();
        g.restore();
        // the light rising from it: a soft glow, taller as the part gets louder
        const hgt = (14 + 40 * L) * u * p.k, gw = Math.max(10 * u, rx * 0.7);
        g.save(); g.translate(p.x, p.y); g.scale(1, hgt / gw);
        const glow = g.createRadialGradient(0, 0, 0, 0, 0, gw);
        glow.addColorStop(0, `rgba(255,255,255,${((0.05 + 0.2 * L) * show).toFixed(3)})`); glow.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = glow; g.beginPath(); g.arc(0, 0, gw, Math.PI, Math.PI * 2); g.fill();
        g.restore();
        // the glyph over its middle, the name beside it
        const gs = (13 + 9 * p.k) * u, gy = p.y - gs / 2 - (5 + 6 * p.k) * u;
        glyphAt(src.path, p.x, gy, gs, (0.6 + 0.4 * L) * show);
        g.globalAlpha = (0.5 + 0.35 * L) * show;
        g.fillStyle = "#fff";
        g.font = `500 ${Math.round(11 * u)}px Geist, Inter, system-ui, sans-serif`;
        const tw = g.measureText(src.label).width, right = p.x + gs * 0.7 + tw < W - 8 * u;
        g.textAlign = right ? "left" : "right";
        g.fillText(src.label, right ? p.x + gs * 0.7 : p.x - gs * 0.7, gy + 4 * u);
        g.globalAlpha = 1;
      });
      // the listener at the front, and which ear is which
      const me = proj(0, -0.12);
      glyphAt(head, me.x, Math.min(me.y, H - 12 * u), 19 * u, 0.5 * c.intro);
      g.globalAlpha = 0.4 * c.intro; g.fillStyle = "#fff"; g.font = `600 ${Math.round(10.5 * u)}px Geist, Inter, system-ui, sans-serif`;
      g.textAlign = "left"; g.fillText("Л", fl.x + 8 * u, fl.y - 6 * u);
      g.textAlign = "right"; g.fillText("П", fr.x - 8 * u, fr.y - 6 * u);
      g.globalAlpha = 1;
    };

    /** One step: the parts towards the frame under the playhead (or their average when
     *  paused), the camera towards the pointer; true while anything still moves. */
    const step = (now: number, dt: number): boolean => {
      const playing = usePlayer.getState().playing && !!st;
      let moving = false;
      const n = st?.stems.length ?? 6;
      const f = st ? Math.min(st.frames - 1.001, Math.max(0, ((base + (playing ? now - at : 0)) / 1000) * st.fps)) : 0;
      const i0 = Math.floor(f), k = f - i0;
      for (const src of srcs) {
        let target = src.avg, pan = src.pan;
        if (playing && st) {
          const si = st.stems.indexOf(src.stem), o0 = (i0 * n + si) * 2, o1 = ((i0 + 1) * n + si) * 2;
          const db = (st.data[o0]! * (1 - k) + st.data[o1]! * k) / 2;
          target = lin(db);
          if (db > -30) pan = (st.data[o0 + 1]! * (1 - k) + st.data[o1 + 1]! * k) / 100;
        }
        src.lv += (target - src.lv) * (1 - Math.exp(-dt / (target > src.lv ? 45 : 260)));
        src.x += (pan - src.x) * (1 - Math.exp(-dt / 420));
        // a hit: the part rose sharply within the last 120 ms
        if (playing && src.lv - src.prev > 0.16 && src.lv > 0.55 && ripples.length < 28) {
          ripples.push({ x: src.x, z: src.z, half: Math.min(src.half, 0.5), t0: now, k: src.lv });
          src.prev = src.lv;
        }
        if (now - src.prevAt > 120) { src.prev = src.lv; src.prevAt = now; }
        if (Math.abs(target - src.lv) > 0.004 || Math.abs(pan - src.x) > 0.004) moving = true;
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
    const off = usePlayer.subscribe((x, p) => {
      if (x.positionMs !== p.positionMs) { base = x.positionMs; at = performance.now(); }
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
