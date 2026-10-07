import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
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
  const onPlayer = useRouterState({ select: (s) => s.location.pathname === "/player" });
  const shown = !!item && !onPlayer;
  const accent = image(item?.coverImageId)?.palette?.accent.light ?? "#c9c287";

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--player-h", shown ? `${MINI_H}px` : "0px");
    root.setProperty("--spec-room", shown ? `${SPEC_ROOM}px` : "0px");
  }, [shown]);

  if (!shown) return null;
  const lossless = tier === "lossless" || tier === "lossless_compat";
  return (
    <div className={css.mini} role="region" aria-label="Сейчас играет" style={{ ["--acc" as string]: accent }}>
      <SeekLine className={css.line} progress={durationMs ? Math.min(1, positionMs / durationMs) : 0} durationMs={durationMs} onSeek={(f) => player.seek(f * durationMs)}>
        <Spectrum trackId={item.trackId} className={css.spectrum} />
      </SeekLine>
      <div className={css.row}>
        <Link to="/player" className={css.now}>
          <Cover id={item.coverImageId} size={44} radius={9} className={css.cover} />
          <span className={css.text}>
            <span className={css.title}>{item.title}</span>
            <span className={css.artist}>{item.artist}</span>
          </span>
        </Link>
        <div className={css.transport}>
          <button type="button" className={css.ic} onClick={() => void player.prev()} aria-label="Предыдущий"><Icon name="ChevronLeft" size={22} /></button>
          <button type="button" className={css.big} onClick={() => player.toggle()} aria-label={playing ? "Пауза" : "Играть"} aria-busy={buffering}>
            <Icon name={playing ? "Pause" : "Play"} size={20} />
          </button>
          <button type="button" className={css.ic} onClick={() => void player.next()} aria-label="Следующий"><Icon name="ChevronRight" size={22} /></button>
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
