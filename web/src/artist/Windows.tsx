import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui/icons";
import css from "./artist.module.css";
import { cx } from "./Hero";
import { paragraphs } from "./model";

/** A window that grows out of what opened it (transform-origin at the trigger) over the page
 *  gone out of focus, and goes back the same way. In a portal: the page is a size container. */
export function Win({ from, onClose, tint, img, title, sub, narrow, children }: {
  from: DOMRect | null;
  onClose: () => void;
  tint: string;
  img?: string | null;
  title: string;
  sub?: string;
  narrow?: boolean;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const win = useRef<HTMLDivElement>(null);
  const x = useRef<HTMLButtonElement>(null);
  const [on, setOn] = useState(false);
  const closing = useRef(false);
  useLayoutEffect(() => {
    const b = box.current, w = win.current;
    if (b && w && from) {
      const br = b.getBoundingClientRect();
      w.style.setProperty("--ox", `${from.left + from.width / 2 - br.left - w.offsetLeft}px`);
      w.style.setProperty("--oy", `${from.top + from.height / 2 - br.top - w.offsetTop}px`);
    }
    const r = requestAnimationFrame(() => { setOn(true); x.current?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(r);
  }, [from]);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    setOn(false);
    window.setTimeout(onClose, 220);
  };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  });
  return createPortal(
    <div ref={box} className={cx("modal", on && "on")} data-mx-theme="dark" style={{ ["--tint" as string]: tint }}>
      <div className={css.scr} onClick={close} />
      <div ref={win} className={cx("mwin", narrow && "qwin")} role="dialog" aria-modal="true" aria-label={title}>
        <div className={css.wh}>
          {img && <img src={img} alt="" />}
          <div><h2>{title}</h2>{sub && <small>{sub}</small>}</div>
          <button ref={x} type="button" className={css.x} onClick={close} aria-label="Закрыть"><Icon name="Close" size={18} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** The biography window: the AI text in paragraphs, where the name came from. */
export function BioWindow({ from, onClose, tint, img, name, text, origin }: { from: DOMRect | null; onClose: () => void; tint: string; img: string | null; name: string; text: string; origin: string | null }) {
  return (
    <Win from={from} onClose={onClose} tint={tint} img={img} title={name} sub="Биография · написал ИИ по открытым источникам">
      <div className={css.wb}>
        {paragraphs(text).map((p, i) => <p key={i} className={css.bio}>{p}</p>)}
        {origin && <><div className={css.lbl}>Откуда название</div><blockquote>{origin}</blockquote></>}
      </div>
    </Win>
  );
}
