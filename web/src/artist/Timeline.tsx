import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { image, imageUrl } from "../lib/images";
import { playAlbum } from "../library/actions";
import glass from "../ui/glass.module.css";
import { openAlbum } from "../ui/Gatefold";
import { Icon } from "../ui/icons";
import css from "./artist.module.css";
import { cx } from "./Hero";
import { layoutTimeline } from "./layout";
import type { Album, Model } from "./model";

/** Seen once: the class goes on when the element first shows (the arrival plays once). */
export function useSeen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

/** The discography by year (design/reference/artist «Лента»): sleeves over and under the axis, a
 *  stem to the real year, the history on the line (formed, ✝), long gaps folded into a break. */
export function Timeline({ m }: { m: Model }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const [W, setW] = useState(0);
  const [hot, setHot] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setW(el.clientWidth)); });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [ref]);
  const band = /(^|[^а-яё])групп/i.test(m.bio.slice(0, 300)); // \b is ASCII-only in JS
  // too narrow for the smallest sleeves (a phone): the line keeps its width and scrolls sideways
  const n = m.albums.filter((a) => a.year).length, need = Math.ceil(n / (n <= 3 ? 1 : 2)) * 134 + 40;
  const LW = Math.max(W, need);
  const tl = useMemo(() => layoutTimeline(LW, m.albums, { start: m.start, formedYear: m.formedYear, end: m.end, dead: m.dead, band }), [LW, m, band]);
  const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
  return (
    <div ref={ref} className={css.tlw}>
    <div className={cx("tl", seen && "seen")} style={{ height: tl?.H ?? 300, width: LW > W ? LW : undefined }}>
      {tl && (
        <>
          <svg className={css.ax} viewBox={`0 0 ${tl.W} ${tl.H}`} preserveAspectRatio="none" aria-hidden>
            <line className={css.axis} style={{ ["--len" as string]: tl.W }} x1="0" x2={tl.W} y1={tl.axisY} y2={tl.axisY} />
            {tl.ticks.map((t, i) => (
              <g key={i}>
                <line className={css.tick} x1={t.x} x2={t.x} y1={tl.axisY - (t.dec ? 6 : 3)} y2={tl.axisY + (t.dec ? 6 : 3)} />
                {t.label && <text className={cx("yl", t.dec && "dec")} x={t.x} y={tl.axisY + (tl.lanes === 2 ? -10 : 22)} textAnchor="middle">{t.label}</text>}
              </g>
            ))}
            {tl.breaks.map((b, i) => (
              <g key={i}>
                <rect x={b.x - 9} y={tl.axisY - 6} width="18" height="12" fill="var(--bg)" />
                <path className={css.brk} d={`M${b.x - 8} ${tl.axisY + 6} L${b.x - 2} ${tl.axisY - 6} M${b.x + 2} ${tl.axisY + 6} L${b.x + 8} ${tl.axisY - 6}`} />
                <text className={css.brkt} x={b.x} y={tl.axisY + ((tl.lanes === 2) !== b.flip ? -12 : 22)} textAnchor="middle">{b.label}</text>
              </g>
            ))}
            {tl.items.map((it) => (
              <g key={it.al.id}>
                <path className={cx("stem", hot === it.i && "hot")} d={`M${it.tx} ${tl.axisY} C ${it.tx} ${(tl.axisY + it.ys) / 2}, ${it.x} ${(tl.axisY + it.ys) / 2}, ${it.x} ${it.ys}`} />
                <circle className={cx("dot", hot === it.i && "hot")} cx={it.tx} cy={tl.axisY} r="4.5" />
              </g>
            ))}
          </svg>
          {tl.items.map((it) => (
            <Sleeve key={it.al.id} al={it.al} i={it.i} S={tl.S} dpr={dpr} style={{ left: it.x - tl.S / 2, top: it.top, ["--from" as string]: `${it.up ? 14 : -14}px` }}
              onHot={(v) => setHot(v ? it.i : null)} />
          ))}
          {tl.events.map((e) => <span key={e.text} className={css.ev} style={{ left: e.x, top: tl.axisY }}><b>{e.year}</b>{e.text}</span>)}
        </>
      )}
    </div>
    </div>
  );
}

const LABELS = ["#c23b2b", "#e2b53d", "#3a6ec2", "#e9e4d8", "#2f8f5b", "#a34fc0"];

function Sleeve({ al, i, S, dpr, style, onHot }: { al: Album; i: number; S: number; dpr: number; style: React.CSSProperties; onHot: (v: boolean) => void }) {
  const deck = useRef<HTMLSpanElement>(null);
  const pal = image(al.cover)?.palette;
  const lab = pal?.vibrant ?? LABELS[i % LABELS.length];
  const src = imageUrl(al.cover, Math.round(S * dpr));
  return (
    <a className={css.al} href={`/album/${al.id}`} style={{ ...style, ["--S" as string]: `${S}px`, ["--i" as string]: i }}
      onPointerEnter={() => onHot(true)} onPointerLeave={() => onHot(false)}
      onClick={(e) => openAlbum(e, al.id, al.cover, deck.current?.querySelector("img") ?? deck.current)}>
      <span ref={deck} className={css.sl} data-album-cover={al.id}>
        <span className={css.disc} style={{ ["--lab" as string]: lab }} />
        {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <span className={css.nocover} />}
        {/* a control inside the album's link: a span with the button role (a <button> may not sit in an <a>) */}
        <span role="button" tabIndex={0} className={cx("pl", glass.lg)} aria-label={`Слушать «${al.clean}»`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); void playAlbum(al.id, deck.current); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); void playAlbum(al.id, deck.current); } }}><Icon name="Play" size={15} /></span>
      </span>
      <div className={css.ti}>{al.clean}{al.ed && <span className={css.ed}>{al.ed}</span>}</div>
      <div className={css.sub}><span className={css.y}>{al.year ?? "—"}</span><span className={css.bar} style={{ ["--p" as string]: al.n ? (al.heard / al.n).toFixed(3) : 0 }}><i /></span><span>{al.heard}/{al.n}</span></div>
    </a>
  );
}
