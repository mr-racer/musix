import { clock } from "../lib/format";
import { Glyph } from "./glyphs";
import { instruments, useSoundUi, type TrackSound } from "./sound";
import css from "./Instruments.module.css";

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
            onPointerEnter={() => useSoundUi.setState({ lit: it.at })} onPointerLeave={() => useSoundUi.setState({ lit: null })}
            onFocus={() => useSoundUi.setState({ lit: it.at })} onBlur={() => useSoundUi.setState({ lit: null })}
            onClick={() => { if (go) onSeek(Math.max(0, it.at! - 2) * 1000); }}>
            <span className={css.glyph}><Glyph name={it.key} size={21} /></span>
            <span className={css.label} role="tooltip">{it.label}{go && <small>{clock(it.at! * 1000)}</small>}</span>
          </button>
        );
      })}
    </span>
  );
}
