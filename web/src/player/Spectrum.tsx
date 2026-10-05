import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAuth } from "../api/auth";
import { usePlayer } from "./engine";

/** The spectrum above the seek line (design/code/components.md): a filled curve with a crest
 *  line, lows on the left, highs on the right. It is drawn from the server's precomputed
 *  16-band envelope (zlib of uint8 frames × 16 bands at 10 fps), in step with the playhead,
 *  never from an AnalyserNode. One small canvas, at most 30 frames a second, and only while
 *  the music plays: paused, it decays to the line and the loop stops. The fade at both ends
 *  is drawn into the canvas (a CSS mask would cost a pass on every frame), and the accent is
 *  re-read twice a second, not per frame. 404 = not computed yet
 *  (the server queues it): nothing is drawn meanwhile. */
const BANDS = 16;
const FLOOR = 0.3; // of the 60 dB range: quieter than that reads as silence
const STEP_MS = 33;

async function spectrum(trackId: string): Promise<Uint8Array | null> {
  const r = await fetch(`/api/v2/tracks/${trackId}/spectrum`, { headers: { authorization: `Bearer ${useAuth.getState().access}` } });
  if (r.status === 404) return null;
  if (!r.ok || !r.body) throw new Error(`spectrum ${r.status}`);
  const raw = await new Response(r.body.pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
  return new Uint8Array(raw);
}

export function Spectrum({ trackId, className }: { trackId: string; className?: string }) {
  const { data } = useQuery({
    queryKey: ["spectrum", trackId],
    queryFn: () => spectrum(trackId),
    staleTime: Infinity,
    retry: false,
    refetchInterval: (q) => (q.state.data === null ? 4000 : false), // computed on first ask
  });
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const frames = data ? Math.floor(data.length / BANDS) : 0;
    const level = new Float32Array(BANDS);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let w = 0, h = 0, raf = 0, last = 0;
    let acc = "", seen = 0, fill: CanvasGradient | null = null, fade: CanvasGradient | null = null;
    // the playhead between the store's updates (it moves about 4 times a second)
    let base = usePlayer.getState().positionMs, at = performance.now();

    const size = () => {
      const r = cv.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.round(r.width * d);
      h = Math.round(r.height * d);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      fill = fade = null;
    };
    const trace = (close: boolean) => {
      let px = 0, py = h - level[0]! * h * 0.94;
      ctx.beginPath();
      if (close) { ctx.moveTo(0, h); ctx.lineTo(px, py); } else ctx.moveTo(px, py);
      for (let i = 1; i < BANDS; i++) {
        const x = (i / (BANDS - 1)) * w, y = h - level[i]! * h * 0.94;
        ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
        px = x; py = y;
      }
      ctx.lineTo(w, py);
      if (close) { ctx.lineTo(w, h); ctx.closePath(); }
    };
    const draw = () => {
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);
      if (!acc || ++seen >= 15) { // the stage's accent; it eases over 0.6 s on a track change
        const now = getComputedStyle(cv).color;
        if (now !== acc) { acc = now; fill = null; }
        seen = 0;
      }
      if (!fill) {
        fill = ctx.createLinearGradient(0, 0, 0, h);
        fill.addColorStop(0, acc);
        fill.addColorStop(1, "transparent");
      }
      if (!fade) {
        fade = ctx.createLinearGradient(0, 0, w, 0);
        fade.addColorStop(0, "transparent"); fade.addColorStop(0.05, "#000"); fade.addColorStop(0.95, "#000"); fade.addColorStop(1, "transparent");
      }
      ctx.globalAlpha = 0.62;
      trace(true); ctx.fillStyle = fill; ctx.fill();
      ctx.globalAlpha = 0.9;
      trace(false); ctx.strokeStyle = acc; ctx.lineWidth = Math.max(1, h / 40); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "destination-in"; // both ends fade out
      ctx.fillStyle = fade; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
    };
    /** One step towards the bands under the playhead; returns the highest level. */
    const step = (playing: boolean, now: number): number => {
      const f = Math.min(frames - 1, Math.max(0, (playing ? base + (now - at) : base) / 100));
      const i0 = Math.floor(f), i1 = Math.min(frames - 1, i0 + 1), k = f - i0;
      let top = 0;
      for (let b = 0; b < BANDS; b++) {
        let v = 0;
        if (playing && data && frames) {
          const raw = (data[i0 * BANDS + b]! * (1 - k) + data[i1 * BANDS + b]! * k) / 255;
          v = Math.pow(Math.max(0, (raw - FLOOR) / (1 - FLOOR)), 1.25);
        }
        level[b] = level[b]! + (v - level[b]!) * (v > level[b]! ? 0.5 : 0.13); // fast attack, slow decay
        if (level[b]! > top) top = level[b]!;
      }
      return top;
    };
    const frame = (now: number) => {
      raf = 0;
      if (document.hidden) return;
      if (now - last >= STEP_MS) {
        last = now;
        const playing = usePlayer.getState().playing;
        const top = step(playing, now);
        draw();
        if (!playing && top < 0.02) return; // settled on the line: sleep until play
      }
      raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (!raf && !reduce && !document.hidden) raf = requestAnimationFrame(frame); };

    size();
    if (reduce && data && frames) { // no loop: the track's average spectrum, once
      for (let b = 0; b < BANDS; b++) {
        let sum = 0;
        for (let f = 0; f < frames; f += 10) sum += data[f * BANDS + b]!;
        level[b] = Math.pow(Math.max(0, (sum / Math.ceil(frames / 10) / 255 - FLOOR) / (1 - FLOOR)), 1.25);
      }
      draw();
    }
    const off = usePlayer.subscribe((s, p) => {
      if (s.positionMs !== p.positionMs) { base = s.positionMs; at = performance.now(); }
      if (s.playing !== p.playing) { at = performance.now(); kick(); }
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
