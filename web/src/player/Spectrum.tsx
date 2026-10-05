import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { authed } from "../api/client";
import { usePlayer } from "./engine";

/** The spectrum above the seek line (design/code/components.md): a filled curve with a crest
 *  line, lows on the left, highs on the right. It is drawn from the server's precomputed
 *  bands (16 of them at 30 frames a second, `MXS2`: server intel/envelope.py), in step with
 *  the playhead, never from an AnalyserNode.
 *
 *  The owner's ruling of 2026-10-05: lively, at the screen's own frame rate, two to three
 *  times taller than the first version, and shrinking when there is no room. So:
 *  - it draws on every animation frame while the music plays, easing between the data's
 *    frames, with a fast attack and a slower fall, both in milliseconds, not per frame;
 *  - every band is measured against its own loud level (blended with the track's), so the
 *    highs dance as much as the lows;
 *  - its height is `--spec-h`, which the player sets from the room above the line.
 *  Still one small canvas. The curve starts and ends on the line (two anchor points outside
 *  the bands), so it needs no fade at the ends: a mask or a second pass over the canvas would
 *  cost on every frame. The accent is re-read twice a second, and paused the curve falls to
 *  the line and the loop stops. 404 = not computed yet (the server queues it). */
type Spec = { fps: number; bands: number; frames: number; data: Uint8Array; lo: Float32Array };

const RANGE = 0.42; // of the 60 dB scale: what is drawn lies within ~25 dB under a band's loud level
const ATTACK_MS = 18, RELEASE_MS = 150;

async function load(trackId: string): Promise<Spec | null> {
  // `v=2`: the first format was served under the same path with a year of immutable caching
  const r = await authed(new Request(`/api/v2/tracks/${trackId}/spectrum?v=2`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`spectrum ${r.status}`);
  const blob = new Uint8Array(await r.arrayBuffer());
  if (blob.length < 8 || String.fromCharCode(blob[0]!, blob[1]!, blob[2]!, blob[3]!) !== "MXS2") return null;
  const fps = blob[4]!, bands = blob[5]!;
  const packed = new Blob([blob.subarray(6)]).stream().pipeThrough(new DecompressionStream("deflate"));
  const data = new Uint8Array(await new Response(packed).arrayBuffer());
  const frames = Math.floor(data.length / bands);
  // band after band, each as its first value and the differences between neighbouring frames
  for (let b = 0; b < bands; b++) {
    let acc = 0;
    for (let i = b * frames, end = i + frames; i < end; i++) { acc = (acc + data[i]!) & 255; data[i] = acc; }
  }
  // each band's loud level: its 97th percentile over the track
  const loud = new Float32Array(bands), hist = new Uint32Array(256);
  let top = 0;
  for (let b = 0; b < bands; b++) {
    hist.fill(0);
    for (let i = b * frames, end = i + frames; i < end; i++) hist[data[i]!]!++;
    let left = frames * 0.03, v = 255;
    while (v > 0 && (left -= hist[v]!) > 0) v--;
    loud[b] = v / 255;
    if (loud[b]! > top) top = loud[b]!;
  }
  // a band is drawn against its own loud level, pulled a third of the way to the track's:
  // every band moves, and the curve still shows which ones carry the song
  const lo = new Float32Array(bands);
  for (let b = 0; b < bands; b++) lo[b] = loud[b]! * 0.65 + top * 0.35 - RANGE;
  return { fps, bands, frames, data, lo };
}

/** Shared with the player, which fetches the neighbours' spectra ahead of a skip. */
export const spectrumQuery = (trackId: string) =>
  queryOptions({ queryKey: ["spectrum", 2, trackId], queryFn: () => load(trackId), staleTime: Infinity, gcTime: 10 * 60_000, retry: false });

export function Spectrum({ trackId, className }: { trackId: string; className?: string }) {
  const { data } = useQuery({
    ...spectrumQuery(trackId),
    // computed on the first ask: about a second on the server
    refetchInterval: (q) => (q.state.data === null && q.state.dataUpdateCount < 20 ? 1500 : false),
  });
  const canvas = useRef<HTMLCanvasElement>(null);
  const levels = useRef(new Float32Array(16)); // survives a track change: the curve never restarts from flat

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const spec = data ?? null;
    const n = spec?.bands ?? levels.current.length;
    if (levels.current.length !== n) levels.current = new Float32Array(n);
    const level = levels.current;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0;
    let acc = "", seen = 0, fill: CanvasGradient | null = null;
    // the playhead between the store's updates (it moves about 4 times a second)
    let base = usePlayer.getState().positionMs, at = performance.now();

    const size = () => {
      const r = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.round(r.width * dpr);
      h = Math.round(r.height * dpr);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      fill = null;
    };
    /** The curve: from the line at the left edge, through the bands (spread over the middle
     *  92 % of the width), back to the line at the right edge. */
    const trace = () => {
      const top = 2 * dpr, span = h - top - dpr, base = h - dpr, x0 = w * 0.04, dx = (w * 0.92) / (n - 1);
      let px = 0, py = base;
      ctx.beginPath();
      ctx.moveTo(0, base);
      for (let i = 0; i <= n; i++) {
        const x = i < n ? x0 + i * dx : w, y = i < n ? base - level[i]! * span : base;
        ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
        px = x; py = y;
      }
      ctx.lineTo(w, base);
    };
    const draw = () => {
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);
      if (!acc || ++seen >= 30) { // the stage's accent; it eases over 0.6 s on a track change
        const now = getComputedStyle(cv).color;
        if (now !== acc) { acc = now; fill = null; }
        seen = 0;
      }
      if (!fill) {
        fill = ctx.createLinearGradient(0, 0, 0, h);
        fill.addColorStop(0, acc);
        fill.addColorStop(1, "transparent");
      }
      trace(); // one path: filled, then stroked
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = fill; ctx.fill();
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = acc; ctx.lineWidth = 1.5 * dpr; ctx.lineJoin = "round"; ctx.stroke();
      ctx.globalAlpha = 1;
    };
    /** One step towards the bands under the playhead; returns the highest level. */
    const step = (playing: boolean, now: number, dt: number): number => {
      const rise = 1 - Math.exp(-dt / ATTACK_MS), fall = 1 - Math.exp(-dt / RELEASE_MS);
      let i0 = 0, i1 = 0, k = 0;
      if (playing && spec?.frames) {
        const f = Math.min(spec.frames - 1, Math.max(0, ((base + (now - at)) / 1000) * spec.fps));
        i0 = Math.floor(f); i1 = Math.min(spec.frames - 1, i0 + 1); k = f - i0;
      }
      let top = 0;
      for (let b = 0; b < n; b++) {
        let v = 0;
        if (playing && spec?.frames) {
          const o = b * spec.frames;
          const raw = (spec.data[o + i0]! * (1 - k) + spec.data[o + i1]! * k) / 255;
          v = Math.min(1, Math.max(0, (raw - spec.lo[b]!) / RANGE));
          v = v * v * (3 - 2 * v); // more contrast between a hit and the quiet around it
        }
        level[b] = level[b]! + (v - level[b]!) * (v > level[b]! ? rise : fall);
        if (level[b]! > top) top = level[b]!;
      }
      return top;
    };
    const frame = (now: number) => {
      raf = 0;
      if (document.hidden) return;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      const st = usePlayer.getState();
      const top = step(st.playing, now, dt);
      draw();
      // between two tracks the engine pauses for a moment while the next one buffers: not a rest
      if (!st.playing && !st.buffering && top < 0.01) { last = 0; return; } // settled on the line: sleep until play
      raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (!raf && !reduce && !document.hidden) raf = requestAnimationFrame(frame); };

    size();
    if (reduce) { // no loop: the track's average spectrum, once
      for (let b = 0; b < n; b++) {
        let sum = 0, count = 0;
        if (spec?.frames) for (let f = 0; f < spec.frames; f += 30) { sum += spec.data[b * spec.frames + f]!; count++; }
        level[b] = spec && count ? Math.min(1, Math.max(0, (sum / count / 255 - spec.lo[b]!) / RANGE)) : 0;
      }
      draw();
    }
    const off = usePlayer.subscribe((s, p) => {
      if (s.positionMs !== p.positionMs) { base = s.positionMs; at = performance.now(); }
      if (s.playing !== p.playing || s.buffering !== p.buffering) { at = performance.now(); kick(); }
    });
    const ro = new ResizeObserver(() => { size(); draw(); });
    ro.observe(cv);
    document.addEventListener("visibilitychange", kick);
    kick();
    return () => {
      off();
      ro.disconnect();
      document.removeEventListener("visibilitychange", kick);
      cancelAnimationFrame(raf);
    };
  }, [data, trackId]);

  return <canvas ref={canvas} className={className} aria-hidden />;
}

/** The seek line: a thin track, the played part in the accent. Click or drag seeks; the
 *  arrows move 5 s. The fill is a transform, so moving it costs no layout. */
export function SeekLine({ progress, durationMs, onSeek, className, children }: {
  progress: number;
  durationMs: number;
  onSeek: (fraction: number) => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  return (
    <div className={className} role="slider" tabIndex={0} aria-label="Позиция в треке" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}
      style={{ ["--p" as string]: progress.toFixed(4) }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e); }}
      onPointerMove={(e) => { if (e.buttons === 1) at(e); }}
      onKeyDown={(e) => {
        if (!durationMs) return;
        if (e.key === "ArrowRight") onSeek(Math.min(0.999, progress + 5000 / durationMs));
        if (e.key === "ArrowLeft") onSeek(Math.max(0, progress - 5000 / durationMs));
      }}>
      {children}
      <i />
    </div>
  );
}
