import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../ui/icons";
import { character, NAME, PLAIN, SCALES, shown, strongest, useSoundUi, type TrackSound } from "./sound";
import { SoundRing } from "./SoundRing";
import { StageScene } from "./StageScene";
import css from "./SoundWindow.module.css";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** The sound window (design/code/screens/player.md, «Звук»): liquid glass v2, grown out of
 *  the ring it was opened from and taken back into it. The owner's brief (2026-10-25): no
 *  explanations for their own sake, graphics first; plain words for the three scales; the
 *  song's pulse and room right after the score, airy, not in pills; a 3D stage instead of
 *  bars and left/right lists; no «что послушать» (the seek line has it), no «так же звучат».
 *  It stays mounted while the player is open, so it can leave as smoothly as it came. */
export function SoundWindow({ trackId, s, open, from, onClose }: {
  trackId: string; s: TrackSound; open: boolean; from: HTMLElement | null; onClose: () => void;
}) {
  const box = useRef<HTMLElement>(null);
  const [shown_, setShown] = useState(open); // stays true through the closing animation
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const focus = useSoundUi((x) => x.scale);
  const values = shown(s.ratings);

  // the window's place: its right edge under the ring's, just below it, inside the screen
  useLayoutEffect(() => {
    if (!open || !from) return;
    const r = from.getBoundingClientRect();
    setPlace({ top: Math.round(r.bottom + 34), // under the ring's caption
      right: Math.max(16, Math.round(window.innerWidth - r.right - 4)) });
    setShown(true);
  }, [open, from]);

  // in: grown out of the ring (scale, blur and light together, critically damped);
  // out: back into it, shorter, ease-in
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !from || !place) return;
    const top = Math.min(place.top, window.innerHeight - el.offsetHeight - 16);
    el.style.top = `${Math.max(16, top)}px`;
    const w = el.getBoundingClientRect(), r = from.getBoundingClientRect();
    el.style.transformOrigin = `${r.left + r.width / 2 - w.left}px ${r.top + r.height / 2 - w.top}px`;
    if (reduced()) { if (!open) setShown(false); return; }
    el.getAnimations().forEach((a) => a.cancel());
    if (open) {
      // opacity comes in faster than the size: a glass plate a few pixels wide reads as a flash
      el.animate([{ opacity: 0, transform: "scale(.22)", filter: "blur(14px)" }, { opacity: 1, offset: 0.35 }, { opacity: 1, transform: "none", filter: "blur(0)" }],
        { duration: 560, easing: "cubic-bezier(.2,.95,.25,1)" });
      from.animate([{ transform: "scale(1)" }, { transform: "scale(.88)" }, { transform: "scale(1)" }], { duration: 480, easing: "cubic-bezier(.34,1.56,.64,1)" });
    } else {
      el.animate([{ opacity: 1, transform: "none", filter: "blur(0)" }, { opacity: 0, transform: "scale(.2)", filter: "blur(10px)" }],
        { duration: 260, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).onfinish = () => setShown(false);
    }
  }, [open, place, from]);

  useEffect(() => { if (!open) useSoundUi.setState({ scale: null }); }, [open]);
  // the bars grow from nothing once the window is there (a value set at mount has nothing to
  // grow from); a new song while it is open moves them from where they are
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    if (!open) { setGrown(false); return; }
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
    return () => cancelAnimationFrame(r);
  }, [open]);
  if (!shown_ || !place) return null;
  const set = (k: (typeof SCALES)[number] | null) => useSoundUi.setState({ scale: k });
  return (
    <aside ref={box} className={css.win} style={{ top: place.top, right: place.right }} aria-label="Звук песни" aria-hidden={!open} data-open={open || undefined}>
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
  );
}
