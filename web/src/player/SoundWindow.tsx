import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui/icons";
import { character, NAME, PLAIN, SCALES, shown, strongest, useSoundUi, type TrackSound } from "./sound";
import { SoundRing } from "./SoundRing";
import { StageScene } from "./StageScene";
import css from "./SoundWindow.module.css";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** The sound window (design/code/screens/player.md, «Звук»): liquid glass v2, on the right
 *  edge like the assistant's and the queue's windows, sliding in and back out the same way (the
 *  owner, 2026-10-25: grown out of the ring it stood neither in the middle nor at an edge). The owner's brief (2026-10-25): no
 *  explanations for their own sake, graphics first; plain words for the three scales; the
 *  song's pulse and room right after the score, airy, not in pills; a 3D stage instead of
 *  bars and left/right lists; no «что послушать» (the seek line has it), no «так же звучат».
 *  It stays mounted while the player is open, so it can leave as smoothly as it came. */
export function SoundWindow({ trackId, s, open, from, accent, onClose }: {
  trackId: string; s: TrackSound; open: boolean; from: HTMLElement | null; accent: string; onClose: () => void;
}) {
  const focus = useSoundUi((x) => x.scale);
  const values = shown(s.ratings);
  // the ring that opened it gives a little, as a button does
  useEffect(() => {
    if (open && from && !reduced()) from.animate([{ transform: "scale(1)" }, { transform: "scale(.88)" }, { transform: "scale(1)" }], { duration: 480, easing: "cubic-bezier(.34,1.56,.64,1)" });
  }, [open, from]);

  useEffect(() => { if (!open) useSoundUi.setState({ scale: null }); }, [open]);
  // the bars grow from nothing once the window is there (a value set at mount has nothing to
  // grow from); a new song while it is open moves them from where they are
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    if (!open) { setGrown(false); return; }
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
    return () => cancelAnimationFrame(r);
  }, [open]);
  const set = (k: (typeof SCALES)[number] | null) => useSoundUi.setState({ scale: k });
  // in <body>: the player's stage is its own stacking context, and the shell's corner buttons
  // stood over a window inside it
  return createPortal(
    <div data-mx-theme="dark" style={{ ["--pl-acc" as string]: accent, display: "contents" }}>
    <aside className={css.win} aria-label="Звук песни" aria-hidden={!open} data-open={open || undefined}>
      <button type="button" className={css.x} onClick={onClose} aria-label="Закрыть"><Icon name="Close" size={18} /></button>
      <header className={css.head}>
        <SoundRing values={values} size={96} />
        <div className={css.scales} onPointerLeave={() => set(null)}>
          {SCALES.map((k, i) => {
            const v = values[k];
            return (
              <div key={k} className={css.sc} data-k={k} data-on={focus === k || undefined} data-off={(focus && focus !== k) || undefined}
                style={{ ["--n" as string]: i }} tabIndex={0} onPointerEnter={() => set(k)} onFocus={() => set(k)} onBlur={() => set(null)}>
                <span className={css.nm}>{NAME[k]}</span>
                <span className={css.v}>{v ?? "—"}</span>
                <span className={css.bar}><i style={{ transform: `scaleX(${grown ? (v ?? 0) / 100 : 0})` }} /></span>
              </div>
            );
          })}
        </div>
      </header>
      {/* the song's pulse and room; a scale under the pointer says what it means in the same
          place (every text lies in one cell: the window never changes its height) */}
      <div className={css.say}>
        <div className={css.character} data-away={focus ? "" : undefined}>
          {character(s).map((ph, i) => (
            <p key={i} style={{ ["--n" as string]: i }}>{ph.map((x, j) => (x.strong ? <b key={j}>{x.text}</b> : <span key={j}>{x.text}</span>))}</p>
          ))}
          {s.signature && <p className={css.sig} style={{ ["--n" as string]: 2 }}>{s.signature}</p>}
        </div>
        {SCALES.map((k) => {
          const why = strongest(s, k);
          return (
            <p key={k} className={css.explain} data-k={k} data-here={focus === k ? "" : undefined} aria-hidden={focus !== k}>
              <b>{NAME[k]}.</b> {values[k] == null ? "Запись моно: простор не измерить." : PLAIN[k]}
              {values[k] != null && why && <> <span className={css.why}>Здесь: {why}.</span></>}
            </p>
          );
        })}
      </div>
      <StageScene trackId={trackId} s={s} active={open} />
    </aside>
    </div>,
    document.body,
  );
}
