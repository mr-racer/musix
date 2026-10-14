import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { setThemePref, themePref, useTheme, type ThemePref } from "../lib/theme";
import glass from "./glass.module.css";
import css from "./ThemeButton.module.css";

/** The theme as its own button beside the gear (the owner, 2026-10-12: «тему … вынести отдельной
 *  кнопкой рядом с настройками … с анимациями при наведении + нажатии»). One sun that becomes a
 *  moon: the bite slides in, the rays draw in. A click switches with a circular reveal from the
 *  button; holding it ~0.8 s means «как в системе» (a ring fills); a glass caption after 450 ms
 *  says what a click will do. */
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ThemeButton() {
  const resolved = useTheme();
  const pref = themePref();
  const mask = `bite${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const btn = useRef<HTMLButtonElement>(null);
  const [tip, setTip] = useState(false), [holding, setHolding] = useState(false);
  const tipT = useRef(0), holdT = useRef(0), held = useRef(false);

  function setTheme(p: ThemePref) {
    const b = btn.current, root = document.documentElement;
    if (b) {
      const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      root.style.setProperty("--rx", `${x}px`); root.style.setProperty("--ry", `${y}px`);
      root.style.setProperty("--rr", `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
    }
    const before = resolved;
    const next = p === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : p;
    if (next === before || reduce() || typeof document.startViewTransition !== "function") return setThemePref(p);
    root.dataset.vt = "theme";
    const t = document.startViewTransition(() => flushSync(() => setThemePref(p)));
    t.ready.catch(() => undefined);
    void t.finished.finally(() => delete root.dataset.vt);
  }
  function pop() {
    if (!reduce()) btn.current?.animate([{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(.95)" }, { transform: "scale(1)" }], { duration: 520, easing: "cubic-bezier(.34,1.56,.64,1)" });
  }
  const cancelHold = () => { clearTimeout(holdT.current); setHolding(false); };
  const state = pref === "system" ? "system" : resolved;
  const a = pref === "system" ? `Как в системе · сейчас ${resolved === "dark" ? "тёмная" : "светлая"}` : resolved === "dark" ? "Включить светлую" : "Включить тёмную";
  const b = pref === "system" ? "нажми — выберешь сам" : "удерживай — как в системе";

  return (
    <button ref={btn} type="button" className={css.theme} data-t={state} aria-label={a}
      onPointerEnter={() => { tipT.current = window.setTimeout(() => setTip(true), 450); }}
      onPointerLeave={() => { clearTimeout(tipT.current); setTip(false); cancelHold(); }}
      onPointerDown={(e) => {
        if (e.button) return;
        held.current = false; clearTimeout(tipT.current); setTip(false);
        holdT.current = window.setTimeout(() => {
          setHolding(true);
          holdT.current = window.setTimeout(() => { held.current = true; setHolding(false); setTheme("system"); pop(); }, 560);
        }, 220);
      }}
      onPointerUp={cancelHold}
      onClick={() => { if (held.current) { held.current = false; return; } setTheme(resolved === "dark" ? "light" : "dark"); }}>
      <svg className={css.glyph} viewBox="0 0 24 24" aria-hidden="true">
        <defs><mask id={mask}><rect x="-4" y="-4" width="32" height="32" fill="#fff" /><circle className={css.bite} cx="17.5" cy="7" r="6.8" fill="#000" /></mask></defs>
        <g className={css.rays}><path d="M12 1.6v2.2M12 20.2v2.2M1.6 12h2.2M20.2 12h2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" /></g>
        <circle className={css.core} cx="12" cy="12" r="8.4" mask={`url(#${mask})`} />
        <path className={css.half} d="M12 6.2a5.8 5.8 0 0 0 0 11.6z" />
        <path className={css.star} d="M20.5 2.4l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" />
      </svg>
      <svg className={css.hold} data-on={holding ? "" : undefined} viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="19" /></svg>
      <span className={`${css.tip} ${glass.lg}`} data-on={tip ? "" : undefined} aria-hidden="true">{a}<small>{b}</small></span>
    </button>
  );
}
