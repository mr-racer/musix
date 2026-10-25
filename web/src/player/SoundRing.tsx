import { useEffect, useLayoutEffect, useRef } from "react";
import { NAME, SCALES, score, useSoundUi, type Scale, type Shown } from "./sound";
import css from "./SoundRing.module.css";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const COLOR: Record<Scale, string> = { tech: "var(--mx-sound-tech)", space: "var(--mx-sound-space)", odd: "var(--mx-sound-odd)" };

/** Where an arc lies: three of them clockwise from the top, each a third of the circle minus
 *  a gap, «техничность», «простор», «необычность». */
function arc(c: number, r: number, i: number, gap: number): { d: string; mid: number } {
  const a0 = -90 + i * 120 + gap / 2, a1 = a0 + 120 - gap;
  const p = (a: number) => [c + r * Math.cos((a * Math.PI) / 180), c + r * Math.sin((a * Math.PI) / 180)] as const;
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return { d: `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`, mid: ((a0 + a1) / 2) * (Math.PI / 180) };
}

/** The sound ring (design/code/screens/player.md, «Звук»): three arcs in three hues, the score
 *  in the middle and its caption under the ring, outside it (inside, a long name ran over the
 *  circle: the owner, 2026-10-25).
 *  - The arcs and the number move from where they are now: a new song re-targets them, it
 *    never empties the ring first. One tween drives both, written straight to the SVG.
 *  - Under the pointer the ring grows a little and its arcs part; the arc under the pointer
 *    thickens, the others step back, and the number rolls to that scale while the caption
 *    names it in its hue. The window's bars and the ring answer each other (useSoundUi).
 *  - A press gives; a click opens the sound window out of the ring. */
export function SoundRing({ values, size = 64, stroke, onOpen, caption = "звук", className }: {
  values: Shown; size?: number; stroke?: number; onOpen?: (el: HTMLElement) => void; caption?: string | null; className?: string;
}) {
  const sw = stroke ?? Math.max(4, Math.round(size / 12.5));
  const c = size / 2, r = c - sw / 2 - 2, gap = size < 48 ? 22 : 15;
  const fills = useRef<(SVGPathElement | null)[]>([]);
  const num = useRef<HTMLSpanElement>(null);
  const now = useRef<Record<Scale, number> & { n: number }>({ tech: 0, space: 0, odd: 0, n: 0 });
  const focus = useSoundUi((s) => s.scale);
  const total = score(values);

  // the tween: from the values on screen to the new ones, critically damped (no overshoot)
  useLayoutEffect(() => {
    const from = { ...now.current }, to = { tech: values.tech ?? 0, space: values.space ?? 0, odd: values.odd ?? 0, n: total };
    const write = (v: typeof from) => {
      SCALES.forEach((k, i) => {
        const el = fills.current[i];
        if (!el) return;
        el.style.strokeDasharray = `${v[k].toFixed(2)} 200`;
        el.style.opacity = v[k] < 0.5 ? "0" : "";
      });
      if (num.current && !useSoundUi.getState().scale) num.current.textContent = String(Math.round(v.n));
      now.current = v;
    };
    if (reduced()) { write(to); return; }
    let raf = 0;
    const t0 = performance.now(), dur = 900;
    const tick = (t: number) => {
      const x = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - x, 4); // ease-out, quartic: no overshoot
      write({ tech: from.tech + (to.tech - from.tech) * e, space: from.space + (to.space - from.space) * e, odd: from.odd + (to.odd - from.odd) * e, n: from.n + (to.n - from.n) * e });
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [values.tech, values.space, values.odd, total]);

  // the number rolls to the focused scale's value and back: the old figure lifts away, the new
  // one rises into its place
  const shownNum = focus ? values[focus] : null;
  const first = useRef(true);
  useEffect(() => {
    const el = num.current;
    if (first.current) { first.current = false; return; }
    if (!el) return;
    const next = focus ? (shownNum == null ? "—" : String(shownNum)) : String(total);
    if (el.textContent === next) return;
    if (reduced()) { el.textContent = next; return; }
    el.getAnimations().forEach((a) => a.cancel());
    el.animate([{ transform: "translateY(0)", opacity: 1, filter: "blur(0)" }, { transform: "translateY(-38%)", opacity: 0, filter: "blur(2px)" }], { duration: 120, easing: "cubic-bezier(.4,0,1,1)" })
      .onfinish = () => {
        el.textContent = next;
        el.animate([{ transform: "translateY(38%)", opacity: 0, filter: "blur(2px)" }, { transform: "translateY(0)", opacity: 1, filter: "blur(0)" }], { duration: 260, easing: "cubic-bezier(.2,.9,.3,1)" });
      };
  }, [focus, shownNum, total]);

  const set = (k: Scale | null) => useSoundUi.setState({ scale: k });
  const label = `Звук ${total} из 100: ${SCALES.map((k) => `${NAME[k].toLowerCase()} ${values[k] ?? "не измерить, запись моно"}`).join(", ")}`;
  return (
    <div className={css.wrap + (className ? " " + className : "")} data-focus={focus ?? undefined}>
      <button type="button" className={css.ring} style={{ width: size, height: size, ["--sw" as string]: sw }} aria-label={label} title={onOpen ? "Звук песни" : undefined}
        onClick={(e) => onOpen?.(e.currentTarget)} onPointerLeave={() => set(null)} onBlur={() => set(null)} tabIndex={onOpen ? 0 : -1}>
        <svg viewBox={`0 0 ${size} ${size}`} aria-hidden>
          {SCALES.map((k, i) => {
            const a = arc(c, r, i, gap), out = Math.max(1.2, size / 40);
            const on = focus === k, off = focus !== null && !on;
            return (
              <g key={k} className={css.arc} data-on={on || undefined} data-off={off || undefined}
                style={{ ["--dx" as string]: `${(Math.cos(a.mid) * out).toFixed(2)}px`, ["--dy" as string]: `${(Math.sin(a.mid) * out).toFixed(2)}px`, color: COLOR[k] }}>
                <path className={css.track + (values[k] == null ? " " + css.mono : "")} d={a.d} strokeWidth={sw} />
                <path ref={(el) => { fills.current[i] = el; }} className={css.fill} d={a.d} pathLength={100} strokeWidth={sw} style={{ strokeDasharray: "0 200" }} />
                <path className={css.hit} d={a.d} strokeWidth={sw + 12} onPointerEnter={() => set(k)} />
              </g>
            );
          })}
        </svg>
        <span className={css.num} style={{ fontSize: Math.round(size * 0.34) }}><span ref={num}>0</span></span>
      </button>
      {caption !== null && (
        <span className={css.cap} aria-hidden>
          <span className={css.capIdle}>{caption}</span>
          {SCALES.map((k) => <span key={k} className={css.capScale} data-k={k} style={{ color: COLOR[k] }}>{NAME[k].toLowerCase()}</span>)}
        </span>
      )}
    </div>
  );
}
