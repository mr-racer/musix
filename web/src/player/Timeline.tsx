import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clock } from "../lib/format";
import { moments, useSoundUi, type TrackSound } from "./sound";
import css from "./Timeline.module.css";

/** The song's form on the seek line (design/code/screens/player.md, «Звук»):
 *  - the line is cut into the song's sections, a 3 px gap between them, the choruses a shade
 *    brighter; the played part fills each block in turn and keeps the gaps (the owner,
 *    2026-10-25: «блоки после полоски оставлять»);
 *  - the current section's name hangs under the line from a tick at its block's start and
 *    glides to the next block when the song gets there; under the pointer it shows the block
 *    being pointed at (he found the name over the clock «пришитым»);
 *  - moments worth hearing are dots over the line: a dot lights when its instrument is under
 *    the pointer, swells twice a few seconds before it comes, and says what it is on glass.
 *  Lives inside <SeekLine>, which seeks on a press anywhere on it. */
export function Timeline({ s, positionMs, durationMs, onSeek }: {
  s: TrackSound; positionMs: number; durationMs: number; onSeek: (ms: number) => void;
}) {
  const dur = durationMs / 1000 || s.sections.at(-1)?.end || 1;
  const t = positionMs / 1000;
  const secs = s.sections.filter((x) => x.start < dur);
  const ms = moments(s);
  const at = secs.findIndex((x) => t >= x.start && t < x.end);
  const cur = at < 0 ? secs.length - 1 : at;
  const [hover, setHover] = useState<number | null>(null);
  const lit = useSoundUi((x) => x.lit);
  const root = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLSpanElement>(null);
  const shownSec = hover ?? cur;
  const pct = (v: number) => `${(Math.min(dur, Math.max(0, v)) / dur) * 100}%`;

  // the name's place: its block's start, kept inside the line (a transform: no layout per frame)
  useLayoutEffect(() => {
    const r = root.current, el = tag.current, sec = secs[shownSec];
    if (!r || !el || !sec) return;
    const w = r.clientWidth, x = (sec.start / dur) * w;
    el.style.setProperty("--x", `${Math.max(0, Math.min(x, w - el.offsetWidth)).toFixed(1)}px`);
    el.style.setProperty("--tick", `${Math.max(0, x - Math.max(0, Math.min(x, w - el.offsetWidth))).toFixed(1)}px`);
  });

  // a few seconds before a moment its dot swells twice; once per moment per pass
  const next = ms.find((m) => m.t > t);
  const [soon, setSoon] = useState<number | null>(null);
  useEffect(() => {
    if (next && next.t - t <= 6 && next.t - t > 0 && soon !== next.t) setSoon(next.t);
  }, [next, t, soon]);

  const pointAt = (e: React.PointerEvent) => {
    const r = root.current!.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * dur;
    const i = secs.findIndex((s0) => x >= s0.start && x < s0.end);
    setHover(i < 0 ? null : i);
  };
  return (
    <div className={css.root} ref={root} data-timeline onPointerMove={pointAt} onPointerLeave={() => setHover(null)} aria-hidden>
      <div className={css.blocks}>
        {secs.map((x, i) => {
          const fill = Math.min(1, Math.max(0, (t - x.start) / (Math.min(x.end, dur) - x.start)));
          return (
            <span key={i} className={css.block} data-chorus={x.kind === "chorus" || undefined} data-on={i === shownSec && hover !== null ? "" : undefined}
              style={{ left: `calc(${pct(x.start)} + ${i ? 1.5 : 0}px)`, width: `calc(${pct(Math.min(x.end, dur))} - ${pct(x.start)} - ${i ? 3 : 1.5}px)` }}>
              <i style={{ transform: `scaleX(${fill.toFixed(4)})` }} />
            </span>
          );
        })}
      </div>
      <span ref={tag} className={css.tag}>
        <span key={shownSec + ":" + (secs[shownSec]?.label ?? "")} className={css.tagText}>{secs[shownSec]?.label}</span>
      </span>
      {ms.map((m) => (
        <button key={m.t} type="button" className={css.mark} style={{ left: pct(m.t) }} tabIndex={-1}
          data-past={m.t < t || undefined} data-lit={lit !== null && Math.abs(lit - m.t) < 0.05 ? "" : undefined} data-soon={soon === m.t ? "" : undefined}
          onPointerDown={(e) => e.stopPropagation()} onClick={() => onSeek(Math.max(0, m.t - 2) * 1000)}>
          <i />
          <span className={css.tip}><small>{clock(m.t * 1000)}</small>{m.label}</span>
        </button>
      ))}
    </div>
  );
}
