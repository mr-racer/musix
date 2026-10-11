import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef } from "react";
import { create } from "zustand";
import { subscribe } from "../api/realtime";
import { bulk } from "../library/film";
import glass from "./glass.module.css";
import css from "./Achievements.module.css";

/** The library's ten achievements as die-cut stickers (design/code/screens/library.md): an
 *  earned one is stuck on at an angle in its colours, the rest are dashed outlines with a ring
 *  of progress. A new one arrives as a small glass card at the top right, on any screen: it
 *  slides in, the sticker is slapped onto it and a quiet «бульк» sounds in the same frame. */

type Art = [string, string, "c" | "s", string];
const ART: Record<string, Art> = {
  repeat: ["#ff7a8a", "#d9356f", "c", '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>'],
  marathon: ["#ffc15a", "#ff7a2f", "s", '<circle cx="12" cy="14" r="7"/><path d="M12 10.5v3.5l2.5 2"/><path d="M10 2.5h4"/><path d="M12 2.5v4"/><path d="M18.5 6.5l1.5-1.5"/>'],
  picky: ["#7fe3ff", "#3b7cf0", "c", '<path d="M5.5 4.5l9.5 7.5-9.5 7.5z" data-fill/><path d="M19 5v14"/>'],
  night: ["#a493ff", "#4c3fb8", "s", '<path d="M20 13.5A8 8 0 1 1 10.5 4a6.3 6.3 0 0 0 9.5 9.5z"/><path d="M17 3v3M15.5 4.5h3"/>'],
  whole: ["#f6cf5c", "#d98b25", "c", '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.2" stroke-opacity=".5"/><circle cx="12" cy="12" r="2.2" data-fill/>'],
  week: ["#ff9a4d", "#e8452c", "s", '<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3.5 10h17"/><path d="M10 13.2h4.2l-2.6 5"/>'],
  unwrap: ["#b9f3dc", "#2fb38a", "c", '<path d="M3.5 7.5L12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="M3.5 7.5L12 11.5l8.5-4"/><path d="M12 11.5v9"/><path d="M7.7 5.5l8.5 4"/>'],
  time: ["#f2dca2", "#b0813f", "s", '<path d="M6.5 2.5h11M6.5 21.5h11"/><path d="M7.5 2.5c0 4.2 2.4 6.3 4.5 9.5-2.1 3.2-4.5 5.3-4.5 9.5"/><path d="M16.5 2.5c0 4.2-2.4 6.3-4.5 9.5 2.1 3.2 4.5 5.3 4.5 9.5"/><path d="M9.5 19.5h5l-2.5-2.6z" data-fill/>'],
  one: ["#ff8fc3", "#d93f7b", "c", '<path d="M20.4 5a5.2 5.2 0 0 0-7.4 0L12 6l-1-1a5.2 5.2 0 0 0-7.4 7.4l1 1L12 20.5l7.4-7.1 1-1a5.2 5.2 0 0 0 0-7.4z"/>'],
  globe: ["#7deab5", "#1f9d6a", "s", '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>'],
};
export const ROT: Record<string, number> = { repeat: -5, marathon: 4, picky: -3, night: 6, whole: -6, week: 3, unwrap: -4, time: 5, one: -2, globe: 4 };

let uid = 0;
/** The sticker's picture as SVG markup (inline: one string, no React per path). */
export function stickerSvg(code: string, on: boolean, frac = 0): string {
  const [c1, c2, sh, g] = ART[code] ?? ART.whole!;
  const id = `stk${uid++}`;
  const shape = (inset: number, attrs: string) => (sh === "c"
    ? `<circle cx="60" cy="60" r="${56 - inset}" ${attrs}/>`
    : `<rect x="${6 + inset}" y="${6 + inset}" width="${108 - 2 * inset}" height="${108 - 2 * inset}" rx="${30 - inset * 0.6}" ${attrs}/>`);
  const ink = on ? "#fff" : "rgba(255,255,255,.36)";
  const glyph = `<g transform="translate(60 60) scale(2.25) translate(-12 -12)" fill="none" stroke="${ink}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${g.replace(/data-fill/g, `fill="${ink}"`)}</g>`;
  if (on) return `<svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`
    + shape(0, 'fill="#f6f2ea"') + shape(6, `fill="url(#${id})"`) + shape(6, 'fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1.2"') + glyph + "</svg>";
  const C = 2 * Math.PI * 62, f = Math.max(0, Math.min(1, frac));
  return `<svg viewBox="0 0 120 120" aria-hidden="true">${shape(0, 'fill="rgba(255,255,255,.035)" stroke="rgba(255,255,255,.2)" stroke-width="1.4" stroke-dasharray="5 5"')}${glyph}`
    + `<circle cx="60" cy="60" r="62" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="3.5"/>`
    + `<circle cx="60" cy="60" r="62" fill="none" stroke="var(--fav,#fff)" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${(f * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/></svg>`;
}

export interface Earned { code: string; name: string; line: string; note?: string | null }
export const useAchievementPop = create<{ now: (Earned & { k: number }) | null; show: (a: Earned) => void; hide: () => void }>((set) => ({
  now: null,
  show: (a) => set({ now: { ...a, k: Date.now() } }),
  hide: () => set({ now: null }),
}));

/** Mounted once in the shell: the realtime event becomes the pop-up. */
export function AchievementHost() {
  const now = useAchievementPop((s) => s.now);
  const hide = useAchievementPop((s) => s.hide);
  const qc = useQueryClient();
  const nav = useNavigate();
  const el = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => subscribe((e) => {
    if (e.type !== "achievement.earned") return;
    const x = e;
    void qc.invalidateQueries({ queryKey: ["stats"] });
    useAchievementPop.getState().show(x);
  }), [qc]);

  const leave = () => {
    clearTimeout(timer.current);
    const p = el.current;
    if (!p) return hide();
    p.animate([{ transform: "none", opacity: 1 }, { transform: "translateX(calc(100% + 40px))", opacity: 0.2 }], { duration: 300, easing: "cubic-bezier(.5,0,.8,.4)", fill: "forwards" })
      .finished.then(hide, hide);
  };
  useLayoutEffect(() => {
    const p = el.current;
    if (!now || !p) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!still) {
      p.animate([{ transform: "translateX(calc(100% + 40px))", opacity: 0.3 }, { transform: "none", opacity: 1 }], { duration: 560, easing: "cubic-bezier(.2,1.15,.35,1)" });
      p.querySelector("[data-art]")?.animate([{ transform: "scale(1.9) rotate(-28deg)", opacity: 0 }, { transform: "scale(1.9) rotate(-28deg)", opacity: 0, offset: 0.4 },
        { transform: "scale(.9) rotate(-2deg)", opacity: 1, offset: 0.72 }, { transform: "scale(1) rotate(-6deg)", opacity: 1 }], { duration: 640, easing: "cubic-bezier(.3,.7,.3,1)", fill: "forwards" });
      p.animate([{ transform: "none" }, { transform: "translateY(3px) scale(.985)", offset: 0.5 }, { transform: "none" }], { duration: 260, delay: 470, easing: "ease-out" });
    }
    const t = setTimeout(bulk, still ? 0 : 450);
    timer.current = setTimeout(leave, 5200);
    return () => { clearTimeout(t); clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now?.k]);

  if (!now) return null;
  return (
    <div ref={el} key={now.k} className={`${css.pop} ${glass.lg}`} role="status"
      onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={() => { timer.current = setTimeout(leave, 1800); }}
      onClick={() => { leave(); void nav({ to: "/library", search: { tab: "stats" } }); }}>
      <div className={css.art} data-art dangerouslySetInnerHTML={{ __html: stickerSvg(now.code, true) }} />
      <div className={css.t}><i>Новая ачивка</i><b>{now.name}</b><small>{now.line}{now.note && now.code !== "week" ? ` · ${now.note}` : ""}</small></div>
    </div>
  );
}
