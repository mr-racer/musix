import { clock } from "../lib/format";
import { Glyph } from "./glyphs";
import { instruments, useSoundUi, type TrackSound } from "./sound";
import css from "./Instruments.module.css";

/** Keep a label inside the player's scrollable reading column, including after scrolling. */
function placeLabel(button: HTMLButtonElement): void {
  const column = button.closest<HTMLElement>("[data-player-info]");
  const label = button.querySelector<HTMLElement>('[role="tooltip"]');
  if (!column || !label) return;
  const room = column.getBoundingClientRect(), anchor = button.getBoundingClientRect();
  const left = anchor.left + anchor.width / 2 - label.offsetWidth / 2;
  const safe = Math.max(room.left + 6, Math.min(left, room.right - label.offsetWidth - 6));
  label.style.setProperty("--tip-x", `${safe - left}px`);
  label.toggleAttribute("data-below", anchor.top - 9 - label.offsetHeight < room.top + 6);
}

/** «Звучат»: what plays in the song, as glyphs (the owner, 2026-10-25: names in text read as
 *  clutter). At rest only the glyphs; under the pointer a chip lifts, its glyph hops and its
 *  name grows out of it on a glass label, so the row never reflows. An instrument with a
 *  moment («вступают струнные») carries a dot: hovering lights its mark on the seek line, a
 *  click plays from two seconds before it comes in. */
export function Instruments({ s, onSeek }: { s: TrackSound; onSeek: (ms: number) => void }) {
  const list = instruments(s);
  if (!list.length) return null;
  return (
    <span className={css.row}>
      {list.map((it, i) => {
        const go = it.at !== null;
        return (
          <button key={it.key} type="button" className={css.chip} style={{ ["--n" as string]: i }} data-go={go || undefined}
            aria-label={go ? `${it.label}: играть с ${clock(it.at! * 1000)}` : it.label} tabIndex={go ? 0 : -1}
            onPointerEnter={(e) => { placeLabel(e.currentTarget); useSoundUi.setState({ lit: it.at }); }} onPointerLeave={() => useSoundUi.setState({ lit: null })}
            onFocus={(e) => { placeLabel(e.currentTarget); useSoundUi.setState({ lit: it.at }); }} onBlur={() => useSoundUi.setState({ lit: null })}
            onClick={() => { if (go) onSeek(Math.max(0, it.at! - 2) * 1000); }}>
            <span className={css.glyph}><Glyph name={it.key} size={21} /></span>
            <span className={css.label} role="tooltip">{it.label}{go && <small>{clock(it.at! * 1000)}</small>}</span>
          </button>
        );
      })}
    </span>
  );
}
