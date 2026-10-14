import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { incognitoUntil, readSettings } from "../api/settings";
import { useLive } from "../lib/live";
import { image } from "../lib/images";
import { clock } from "../lib/format";
import { Cover } from "../ui/Cover";
import { Icon, LosslessMark } from "../ui/icons";
import { player, usePlayer } from "./engine";
import css from "./MiniPlayer.module.css";
import { SeekLine, Spectrum } from "./Spectrum";

/** The bar under every screen but the player: the player's own bottom line, open on the
 *  page (design/code/screens/home.md): the seek line with the spectrum rising above it,
 *  then one row: the cover and the title (they open the player), the transport, the time
 *  and the quality badge. It sets `--player-h` (its own height) and `--spec-room` (what
 *  the spectrum needs above it), so no page puts anything under the curve. */
export const MINI_H = 86;
export const SPEC_ROOM = 44;

export function MiniPlayer() {
  const item = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const positionMs = usePlayer((s) => s.positionMs);
  const durationMs = usePlayer((s) => s.durationMs);
  const tier = usePlayer((s) => s.tier);
  // the resolved location: it changes with the page, inside the page change, so the old page
  // is photographed with the bar still in it (lib/pageMotion.ts); `location` changes earlier
  const onPlayer = useRouterState({ select: (s) => (s.resolvedLocation ?? s.location).pathname === "/player" });
  const shown = !!item && !onPlayer;
  const accent = image(item?.coverImageId)?.palette?.accent.light ?? "#c9c287";

  // a song starting from silence: the bar rises from under the screen's edge and the cover
  // pops in after it, while the page eases up to make room (--player-h is animated)
  const bar = useRef<HTMLDivElement>(null);
  const had = useRef(false);
  useLayoutEffect(() => {
    const el = bar.current;
    if (shown && el && !had.current && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      el.animate([{ transform: "translateY(110%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 620, easing: "cubic-bezier(.2,.9,.25,1.04)" });
      el.querySelector(`.${css.cover}`)?.animate([{ transform: "scale(.6) rotate(-6deg)", opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: 560, delay: 160, easing: "cubic-bezier(.34,1.56,.64,1)", fill: "backwards" });
    }
    had.current = !!item;
  }, [shown, item]);

  // a layout effect: inside a page change it lands before the new page is photographed
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--player-h", shown ? `${MINI_H}px` : "0px");
    root.setProperty("--spec-room", shown ? `${SPEC_ROOM}px` : "0px");
  }, [shown]);

  if (!shown) return null;
  const lossless = tier === "lossless" || tier === "lossless_compat";
  return (
    <div ref={bar} className={css.mini} data-mini role="region" aria-label="Сейчас играет" style={{ ["--acc" as string]: accent }}>
      <SeekLine className={css.line} progress={durationMs ? Math.min(1, positionMs / durationMs) : 0} durationMs={durationMs} onSeek={(f) => player.seek(f * durationMs)}>
        <Spectrum trackId={item.trackId} className={css.spectrum} />
      </SeekLine>
      <div className={css.row}>
        <div className={css.left}>
        <Link to="/player" className={css.now}>
          <Cover id={item.coverImageId} size={44} radius={9} className={css.cover} seed={item.albumId ?? item.title} />
          <span className={css.text}>
            <span className={css.title}>{item.title}</span>
            <span className={css.artist}>{item.artist}</span>
          </span>
        </Link>
        <Incognito />
        </div>
        <div className={css.transport}>
          <button type="button" className={css.ic} onClick={() => void player.prev()} aria-label="Предыдущий"><Icon name="ChevronLeft" size={22} /></button>
          <button type="button" className={css.big} onClick={() => player.toggle()} aria-label={playing ? "Пауза" : "Играть"} aria-busy={buffering}>
            <Icon name={playing ? "Pause" : "Play"} size={20} />
          </button>
          <button type="button" className={css.ic} data-mini-next onClick={() => void player.next()} aria-label="Следующий"><Icon name="ChevronRight" size={22} /></button>
        </div>
        <div className={css.tools}>
          <span className={css.time}>{clock(positionMs)} / {clock(durationMs)}</span>
          {lossless && <span className={css.badge}><LosslessMark height={10} /> Lossless</span>}
        </div>
      </div>
    </div>
  );
}

/** A cover that starts playing flies from where it lay into the mini player's cover (the
 *  mock's move). Painted from the thumbnail's own pixels, so it is never blank. Nothing
 *  happens when the mini player is not on the page or motion is reduced. */
export function flyToMini(from: HTMLElement | null): void {
  const to = document.querySelector<HTMLElement>(`.${css.cover}`);
  const img = from?.querySelector("img") ?? (from instanceof HTMLImageElement ? from : null);
  if (!from || !to || !img || !img.naturalWidth || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const cv = document.createElement("canvas");
  const s = Math.round(a.width * Math.min(window.devicePixelRatio || 1, 2));
  cv.width = s; cv.height = s;
  try { cv.getContext("2d")?.drawImage(img, 0, 0, s, s); } catch { return; }
  Object.assign(cv.style, { position: "fixed", zIndex: "60", left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`, borderRadius: "9px",
    transformOrigin: "0 0", pointerEvents: "none", boxShadow: "0 20px 40px -14px rgba(0,0,0,.8)" } as CSSStyleDeclaration);
  document.body.appendChild(cv);
  cv.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width})` }, { transform: "none" }],
    { duration: 560, easing: "cubic-bezier(.2,.8,.2,1)" }).onfinish = () => {
    cv.remove();
    to.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 420, easing: "cubic-bezier(.34,1.56,.64,1)" });
  };
}

/** While «Слушать инкогнито» is on (the settings), the bar wears a mask and counts down to the
 *  moment it switches itself off; it comes in with a spring and leaves quickly. */
function Incognito() {
  const s = useLive(readSettings, [], undefined);
  const [now, setNow] = useState(Date.now());
  const until = incognitoUntil(s, now);
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [until]);
  const pill = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(!!until);
  useLayoutEffect(() => {
    const el = pill.current, still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (until && !shown) setShown(true);
    else if (until && el && !still) el.animate([{ opacity: 0, transform: "scale(.6) translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 520, easing: "cubic-bezier(.34,1.56,.64,1)" });
    else if (!until && shown) {
      if (!el || still) return setShown(false);
      el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.8)" }], { duration: 180, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).onfinish = () => setShown(false);
    }
  }, [!!until, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  const left = Math.max(0, (until ?? now) - now);
  return (
    <span ref={pill} className={css.incog} title="Слушаешь инкогнито: это не попадёт в историю">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 11h18" /><path d="M6 11l1.5-5.5h9L18 11" /><circle cx="7.5" cy="16" r="2.6" /><circle cx="16.5" cy="16" r="2.6" /><path d="M10.1 16h3.8" /></svg>
      инкогнито <span className={css.incogT}>{Math.floor(left / 3_600_000)}:{String(Math.floor((left % 3_600_000) / 60_000)).padStart(2, "0")}</span>
    </span>
  );
}
