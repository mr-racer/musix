import { queryOptions } from "@tanstack/react-query";
import { create } from "zustand";
import { authed, type Schemas } from "../api/client";

/** The sound of a track in the player (design/code/screens/player.md, «Звук»): the server's
 *  profile (`/tracks/{id}/sound`, the sound engine) turned into what the screen shows. */
export type TrackSound = Schemas["TrackSound"];
export type Scale = "tech" | "space" | "odd";
export const SCALES: readonly Scale[] = ["tech", "space", "odd"];

/** null = not analysed yet (the server queues it), with the reason it gives. */
export const soundQuery = (trackId: string) =>
  queryOptions({
    queryKey: ["sound", trackId],
    queryFn: async (): Promise<TrackSound | null> => {
      const r = await authed(new Request(`/api/v2/tracks/${trackId}/sound`));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`sound ${r.status}`);
      return (await r.json()) as TrackSound;
    },
    staleTime: 10 * 60_000,
    retry: false,
  });

/** The live stage: for every 1/fps of the song, each stem's loudness and place.
 *  `gzip(int8[frames][stems][level, pan])`: level in half-dB under the loudest stem frame
 *  (0..-120), pan -100..100 (server contexts/sound/router.py). */
export type Stage = { fps: number; stems: string[]; frames: number; data: Int8Array };
export const stageQuery = (trackId: string) =>
  queryOptions({
    queryKey: ["sound-stage", trackId],
    queryFn: async (): Promise<Stage | null> => {
      const r = await authed(new Request(`/api/v2/tracks/${trackId}/sound/stage`));
      if (r.status === 404 || !r.body) return null;
      if (!r.ok) throw new Error(`stage ${r.status}`);
      const stems = (r.headers.get("X-Stage-Stems") ?? "vocals,drums,bass,guitar,piano,other").split(",");
      const fps = Number(r.headers.get("X-Stage-Fps") ?? 10);
      const raw = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      const data = new Int8Array(raw);
      return { fps, stems, frames: Math.floor(data.length / (stems.length * 2)), data };
    },
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: false,
  });

/** What the ring shows. The stored scales are absolute (fixed formulas, never the library's
 *  percentiles), but «техничность» lives in 36–62 for nine songs in ten, so on a ring it was
 *  always half full. The display maps each scale through fixed bounds, constants too. */
const SHOW: Record<Scale, [number, number]> = { tech: [25, 70], space: [10, 90], odd: [0, 70] };
export type Shown = Record<Scale, number | null>;
export function shown(r: Schemas["SoundRatings"]): Shown {
  const at = (v: number | null | undefined, [lo, hi]: [number, number]) =>
    v == null ? null : Math.round(Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * 100);
  return { tech: at(r.tech, SHOW.tech), space: at(r.space, SHOW.space), odd: at(r.odd, SHOW.odd) };
}

/** The number in the ring: the strongest scale weighs half (songs are rich each in their own
 *  way, as the technicality score itself is built). A mono file has no «простор». */
export function score(v: Shown): number {
  const xs = SCALES.map((k) => v[k]).filter((x): x is number => x != null).sort((a, b) => b - a);
  if (!xs.length) return 0;
  return Math.round(xs.length === 3 ? 0.5 * xs[0]! + 0.3 * xs[1]! + 0.2 * xs[2]! : 0.6 * xs[0]! + 0.4 * (xs[1] ?? 0));
}

export const NAME: Record<Scale, string> = { tech: "Техничность", space: "Простор", odd: "Необычность" };
/** For someone who knows nothing about music (the owner, 2026-10-25: «ПОНЯТНЫМ языком»). */
export const PLAIN: Record<Scale, string> = {
  tech: "Сколько труда в звуке: слои, обработка, непростая игра, музыка меняется по ходу песни.",
  space: "Насколько звук окружает тебя: широкий, с эхом, будто играет вокруг, а не в одной точке.",
  odd: "Насколько песня звучит непривычно: странные звуки, неожиданные повороты, резкие решения.",
};
const FACET: Record<string, string> = {
  layers: "много слоёв", sound_work: "много обработки", playing: "непростая игра", development: "музыка развивается",
  width: "широкая стереосцена", spread: "инструменты разведены по сторонам", echo: "много эха",
  sounds: "непривычные звуки", mix_extremes: "резкое сведение", form: "необычное построение", style: "экспериментальный стиль",
};
/** The one or two facets that carry this song's scale, in plain words; none below 40. */
export function strongest(s: TrackSound, k: Scale): string | null {
  const f = Object.entries(s.ratings.facets[k] ?? {}).filter(([, v]) => v >= 40).sort((a, b) => b[1] - a[1]).slice(0, 2);
  return f.length ? f.map(([n]) => FACET[n] ?? n).join(" и ") : null;
}

/** Moments worth a mark. «Бит / бас возвращается», the bass coming in and a nameless «новая
 *  партия» happen in every song (the owner's rule for the изюминка), so they get no mark. */
const PLAIN_KINDS = new Set(["bass_back", "beat_back", "beat_out", "bass_in"]);
export function moments(s: TrackSound): Schemas["SoundMoment"][] {
  return s.moments.filter((m) => !PLAIN_KINDS.has(m.kind) && !m.label.includes("новая партия")).slice(0, 6);
}

/** The instruments the ear can follow: rare ones first, then the rest, the bass, the drums,
 *  a voice when the profile can say which. Each is a glyph on screen; its name comes on hover. */
const RARE = new Set(["brass", "winds", "sax", "woodwind", "piano", "electric_piano", "organ", "harpsichord", "harp", "sitar", "banjo",
  "mandolin", "ukulele", "accordion", "harmonica", "bagpipes", "theremin", "steelpan", "bells", "scratches"]);
const ORDER = ["strings", "acoustic_guitar", "electric_guitar", "slide_guitar", "guitar", "synthesizer", "synths", "lead",
  "bass_guitar", "double_bass", "synth_bass", "bass_808"];
export type Instrument = { key: string; label: string; at: number | null };
export function instruments(s: TrackSound): Instrument[] {
  let keys = s.instruments.map((x) => x.key);
  if (keys.includes("brass")) keys = keys.filter((k) => k !== "winds"); // «медные духовые» says it
  const label = new Map(s.instruments.map((x) => [x.key, x.label]));
  keys.sort((a, b) => Number(RARE.has(b)) - Number(RARE.has(a)) || ORDER.indexOf(a) - ORDER.indexOf(b));
  const out: Instrument[] = keys.map((k) => ({ key: k, label: label.get(k)!, at: null }));
  if (s.drums) out.push({ key: s.drums.key === "live" ? "drums_live" : "drum_machine", label: s.drums.label, at: null });
  if (s.vocals && !["voice", "vocal"].includes(s.vocals.key)) out.push({ key: s.vocals.key, label: s.vocals.label, at: null });
  // the first moment that names it: «вступают струнные» belongs to the strings
  const ms = moments(s);
  for (const it of out) {
    const word = it.label.split(" ").at(-1)!;
    it.at = ms.find((m) => m.label.includes(word))?.t ?? null;
  }
  return out.slice(0, 6);
}

/** The song's sound in two plain sentences, built from the profile's words (no model): the
 *  pulse, then the room. Parts are marked strong for the key words. */
export type Phrase = { text: string; strong?: boolean }[];
export function character(s: TrackSound): Phrase[] {
  const out: Phrase[] = [];
  const pace = s.pace?.key, feel = s.feel?.key;
  const drums = s.drums?.key === "live" ? "на живых барабанах" : s.drums?.key === "machine" ? "на драм-машине" : null;
  if (feel === "free" || feel === "no_pulse") out.push([{ text: feel === "free" ? "Свободный ритм" : "Без чёткого ритма", strong: true }, { text: ", без ударной сетки." }]);
  else if (pace) {
    const word = ({ slow: "Медленный", unhurried: "Неспешный", medium: "Ровный", brisk: "Бодрый", fast: "Быстрый" } as Record<string, string>)[pace] ?? s.pace!.label;
    const how = feel === "driving" ? "напористый" : feel === "swinging" ? "качающий" : null;
    out.push([{ text: how ? `${word}, ${how}` : word, strong: true }, { text: " ритм" }, ...(drums ? [{ text: " " }, { text: drums, strong: true }] : []), { text: "." }]);
  } else if (drums) out.push([{ text: "Ритм " }, { text: drums, strong: true }, { text: "." }]);
  const echo = ({ dry: "Сухой звук, близко к уху", little: "Немного эха", noticeable: "Заметное эхо", hall: "Много эха, как в зале" } as Record<string, string>)[s.echo.key];
  const width = s.width ? ({ narrow: "узкая, почти моно сцена", medium: "сцена средней ширины", wide: "широкая сцена", very_wide: "сцена от уха до уха" } as Record<string, string>)[s.width.key] : null;
  const room: Phrase = [];
  if (echo) room.push({ text: echo, strong: true });
  if (width) room.push({ text: echo ? ", " : "" }, { text: width, strong: true });
  if (room.length) out.push([...room, { text: "." }]);
  return out;
}

/** What the player shares between the ring, the instruments, the seek line and the window:
 *  the scale under the pointer (the ring's arc and the window's bar answer each other) and the
 *  moments lit by an instrument under the pointer. */
export const useSoundUi = create<{ scale: Scale | null; lit: number | null }>(() => ({ scale: null, lit: null }));
