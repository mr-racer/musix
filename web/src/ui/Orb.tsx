import { useEffect, useRef } from "react";
import { Icon } from "./icons";
import css from "./Orb.module.css";

/** The orb of «Поток», as v1 had it (`.fy-hybrid`): four drops of the taste's colours
 *  drift under a glass cap, a blurred ring turns around it, a halo leaves it under the
 *  pointer, the drops lean to the pointer. The drift and the turn run on the Web
 *  Animations API with playback rates, so a change of pace (the pointer, the music) never
 *  jumps the way v1's switched `animation-duration` did. The press is new: the orb gives
 *  and springs back, the liquid gulps, the halo bursts once, the ring hurries a moment. */

const DRIFT: Keyframe[][] = [
  [{ transform: "translate(-25%,-15%) scale(1)" }, { transform: "translate(35%,20%) scale(1.35)", offset: 0.33 }, { transform: "translate(5%,-30%) scale(.85)", offset: 0.66 }, { transform: "translate(-25%,-15%) scale(1)" }],
  [{ transform: "translate(30%,25%) scale(1.1)" }, { transform: "translate(-20%,-10%) scale(.9)", offset: 0.33 }, { transform: "translate(25%,30%) scale(1.3)", offset: 0.66 }, { transform: "translate(30%,25%) scale(1.1)" }],
  [{ transform: "translate(10%,30%) scale(.9)" }, { transform: "translate(-30%,-20%) scale(1.25)", offset: 0.5 }, { transform: "translate(10%,30%) scale(.9)" }],
  [{ transform: "translate(-30%,20%) scale(1.2)" }, { transform: "translate(30%,-25%) scale(.95)", offset: 0.5 }, { transform: "translate(-30%,20%) scale(1.2)" }],
];
const PERIOD = [7000, 9000, 11000, 8000];

export function Orb({ playing, pace = 1, size = 112, colors, onClick, label }: {
  playing: boolean;
  /** the wave's sound setting: calm slows the drift, energetic drives it */
  pace?: number;
  size?: number;
  colors: string[];
  onClick: () => void;
  label: string;
}) {
  const root = useRef<HTMLButtonElement>(null);
  const anims = useRef<{ drops: Animation[]; ring: Animation | null }>({ drops: [], ring: null });
  const hot = useRef(false);
  const burst = useRef(0);
  const live = useRef({ playing, pace });
  live.current = { playing, pace };

  const flow = (k = 1) => {
    const { playing, pace } = live.current;
    const r = (playing ? 2.2 : hot.current ? 2 : 1) * pace * k;
    for (const a of anims.current.drops) a.updatePlaybackRate(r);
    anims.current.ring?.updatePlaybackRate((playing ? 2.6 : hot.current ? 2.5 : 1) * k);
  };

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const drops = [...el.querySelectorAll<HTMLElement>("[data-drop]")].map((d, i) =>
      d.animate(DRIFT[i % 4]!, { duration: PERIOD[i % 4], iterations: Infinity, easing: "ease-in-out" }));
    const ring = el.querySelector<HTMLElement>("[data-ring]")?.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 6000, iterations: Infinity }) ?? null;
    anims.current = { drops, ring };
    flow();
    return () => { drops.forEach((a) => a.cancel()); ring?.cancel(); anims.current = { drops: [], ring: null }; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { flow(); }, [playing, pace]); // eslint-disable-line react-hooks/exhaustive-deps

  /** the press: the liquid gulps, the halo bursts once, the ring hurries, then everything settles */
  const launch = () => {
    const el = root.current;
    if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.querySelector<HTMLElement>("[data-liquid]")?.animate(
      [{ transform: "scale(1)" }, { transform: "scale(.78)", offset: 0.3 }, { transform: "scale(1.1)", offset: 0.65 }, { transform: "scale(1)" }],
      { duration: 720, easing: "cubic-bezier(.22,.9,.3,1)" });
    el.querySelector<HTMLElement>("[data-halo]")?.animate(
      [{ transform: "scale(.8)", opacity: 0.9 }, { transform: "scale(2.1)", opacity: 0 }], { duration: 820, easing: "cubic-bezier(.2,.7,.2,1)" });
    el.querySelector<HTMLElement>("[data-glyph] svg")?.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.45) rotate(-8deg)" }, { transform: "scale(1)" }], { duration: 520, easing: "cubic-bezier(.34,1.56,.64,1)" });
    flow(3.5);
    window.clearTimeout(burst.current);
    burst.current = window.setTimeout(() => flow(), 700);
  };

  const move = (e: React.PointerEvent) => {
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--px", ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
    el.style.setProperty("--py", ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
  };

  const vars = Object.fromEntries(colors.slice(0, 4).map((c, i) => [`--c${i}`, c]));
  return (
    <button ref={root} type="button" className={css.orb + (playing ? " " + css.live : "")} style={{ ...vars, ["--orb" as string]: `${size}px` }}
      aria-label={label} aria-pressed={playing}
      onPointerMove={move}
      onPointerEnter={() => { hot.current = true; flow(); }}
      onPointerLeave={() => { hot.current = false; flow(); root.current?.style.setProperty("--px", "0"); root.current?.style.setProperty("--py", "0"); }}
      onClick={() => { launch(); onClick(); }}>
      <span className={css.ring} data-ring />
      <span className={css.clip}>
        <span className={css.breathe}>
          <span className={css.liquid} data-liquid>
            <i className={css.b1} data-drop /><i className={css.b2} data-drop /><i className={css.b3} data-drop /><i className={css.b4} data-drop />
          </span>
        </span>
      </span>
      <span className={css.cap} />
      <span className={css.glyph} data-glyph><Icon name={playing ? "Pause" : "Play"} size={Math.round(size * 0.2)} /></span>
      <span className={css.halo} data-halo />
    </button>
  );
}
