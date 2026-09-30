import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAuth } from "../api/auth";
import css from "./Wave.module.css";

/** The spectrum wave (phase 4 §4): drawn from the precomputed energy envelope — zlib of
 *  uint8 frames × 4 bands at 10 fps — never from an AnalyserNode. 404 = not computed yet
 *  (the server queues it): the scrubber is a plain line meanwhile. */
async function envelope(trackId: string): Promise<Uint8Array | null> {
  const r = await fetch(`/api/v2/tracks/${trackId}/envelope`, { headers: { authorization: `Bearer ${useAuth.getState().access}` } });
  if (r.status === 404) return null;
  if (!r.ok || !r.body) throw new Error(`envelope ${r.status}`);
  const raw = await new Response(r.body.pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
  return new Uint8Array(raw);
}

const BARS = 96;

function heights(env: Uint8Array): number[] {
  const frames = Math.floor(env.length / 4);
  const out: number[] = [];
  for (let b = 0; b < BARS; b++) {
    const from = Math.floor((b * frames) / BARS), to = Math.max(from + 1, Math.floor(((b + 1) * frames) / BARS));
    let sum = 0;
    for (let f = from; f < to; f++) sum += env[f * 4]! * 0.4 + env[f * 4 + 1]! * 0.3 + env[f * 4 + 2]! * 0.2 + env[f * 4 + 3]! * 0.1;
    out.push(sum / (to - from) / 255);
  }
  const max = Math.max(0.05, ...out);
  return out.map((h) => 0.12 + 0.88 * (h / max));
}

export function Wave({ trackId, progress, onSeek }: { trackId: string; progress: number; onSeek: (fraction: number) => void }) {
  const { data } = useQuery({
    queryKey: ["envelope", trackId],
    queryFn: () => envelope(trackId),
    staleTime: Infinity,
    retry: false,
    refetchInterval: (q) => (q.state.data === null ? 4000 : false), // computed on first ask
  });
  const canvas = useRef<HTMLCanvasElement>(null);
  const bars = data ? heights(data) : null;

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    const style = getComputedStyle(c);
    const played = style.getPropertyValue("--played").trim() || "#f0a040";
    const rest = style.getPropertyValue("--rest").trim() || "rgba(255,255,255,.25)";
    if (!bars) {
      g.fillStyle = rest;
      g.fillRect(0, h / 2 - 1, w, 2);
      g.fillStyle = played;
      g.fillRect(0, h / 2 - 1, w * progress, 2);
      return;
    }
    const step = w / BARS, bw = Math.max(1.5, step * 0.55);
    bars.forEach((v, i) => {
      const bh = Math.max(2, v * h);
      g.fillStyle = i / BARS <= progress ? played : rest;
      g.beginPath();
      g.roundRect(i * step + (step - bw) / 2, (h - bh) / 2, bw, bh, bw / 2);
      g.fill();
    });
  });

  return (
    <canvas ref={canvas} className={css.wave} role="slider" aria-label="Позиция" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} tabIndex={0}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onSeek(Math.min(1, progress + 0.02));
        if (e.key === "ArrowLeft") onSeek(Math.max(0, progress - 0.02));
      }} />
  );
}
