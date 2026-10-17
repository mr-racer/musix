import { Link } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { imageUrl } from "../lib/images";
import { flagUrl } from "../library/flags";
import glass from "../ui/glass.module.css";
import { Icon } from "../ui/icons";
import css from "./artist.module.css";
import { extendEdge } from "./layout";
import { LAUREL_STEM, laurelLeaves, laurelPath, pl, type Model } from "./model";

export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).map((n) => css[n as string] ?? n).join(" ");

/** The five steps of the progressive blur under the name's corner: blur px, mask radius. */
const BLUR: [number, string][] = [[2, "150% 140%"], [4, "126% 118%"], [8, "106% 100%"], [16, "88% 84%"], [30, "70% 68%"]];

export function Hero({ m, onPlay, onShuffle, onStream, onBio, streaming, heroRef }: {
  m: Model;
  onPlay: (from: HTMLElement) => void;
  onShuffle: (from: HTMLElement) => void;
  onStream: () => void;
  onBio: (from: HTMLElement) => void;
  streaming: boolean;
  heroRef?: (el: HTMLElement | null) => void;
}) {
  const hero = useRef<HTMLElement | null>(null);
  const photo = useRef<HTMLDivElement>(null);
  const ext = useRef<HTMLCanvasElement>(null);
  const hbg = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const shot = m.shot;
  const sq = shot?.kind === "sq";

  // the picture at the size it is drawn (2048 px variants exist for the editorial photos)
  useLayoutEffect(() => {
    setOn(false);
    if (!shot) { setSrc(null); return; }
    const w = hero.current?.offsetWidth ?? 1600, dpr = Math.min(2, window.devicePixelRatio || 1);
    const want = shot.kind === "wide" ? w * 1.24 * dpr : Math.min(1080, w * 0.64) * dpr;
    setSrc(imageUrl(shot.id, Math.round(want)));
  }, [shot?.id, shot?.kind]);

  // decoded before it fades in, so the first frames of the arrival never stall on a decode
  useEffect(() => {
    if (!src) return;
    let gone = false;
    const im = new Image();
    im.decoding = "async";
    im.src = src;
    const draw = () => {
      if (!sq || !ext.current || !photo.current) return;
      const pl0 = extendEdge(ext.current, photo.current, im);
      hbg.current?.style.setProperty("--pl", pl0 == null ? "0px" : `${pl0}px`);
    };
    im.decode().catch(() => undefined).then(() => {
      if (gone) return;
      requestAnimationFrame(() => { draw(); setOn(true); });
    });
    // the continuation follows the photo's box: redrawn once a resize settles
    let t = 0;
    const ro = new ResizeObserver(() => { clearTimeout(t); t = window.setTimeout(draw, 120); });
    if (photo.current) ro.observe(photo.current);
    return () => { gone = true; ro.disconnect(); clearTimeout(t); };
  }, [src, sq]);

  const img = src ? `url("${src}")` : undefined;
  const span = m.start ? (m.end ? <>{m.start}–{m.end}{m.dead && <small> ✝</small>}</> : `с ${m.start}`) : null;
  const flag = flagUrl(m.cc);
  const logo = m.logo ? imageUrl(m.logo, 1024) : null;
  return (
    <section ref={(el) => { hero.current = el; heroRef?.(el); }} className={cx("hero", m.light && "light", sq && "sq", !shot && "bare")}>
      <div ref={hbg} className={css.hbg}>
        {sq && <><canvas ref={ext} className={cx("ext", on && "on")} width={1} height={1} /><i className={css.extdim} /></>}
        {shot && <div ref={photo} className={cx("photo", shot.kind, m.light && "light", on && "on")} style={{ ["--img" as string]: img }} />}
        {shot?.kind === "wide" && <div className={cx("pblur", on && "on")} aria-hidden>{BLUR.map(([b, r]) => <i key={b} style={{ ["--b" as string]: `${b}px`, ["--r" as string]: r, ["--img" as string]: img }} />)}</div>}
        <i className={css.scrim} /><i className={css.grain} />
      </div>
      <Link to="/library" search={{ tab: "artists" }} className={cx("back", glass.lg)}><Icon name="ChevronLeft" size={18} />Артисты</Link>
      <div className={css.htext}>
        <Name m={m} logo={logo} hero={hero} />
        <div className={css.meta}>
          {m.country && <span>{flag && <img className={css.flag} src={flag} alt="" />}{m.country}{m.city && <small> {m.city}</small>}</span>}
          {m.genre && <span>{m.genre}</span>}
          {span && <span>{span}</span>}
          {m.grammy && <Grammy g={m.grammy} hero={hero} light={m.light} />}
        </div>
        <div className={css.lib}>
          <span>{m.albums.length} {pl.albums(m.albums.length)} · {m.tracks} {pl.songs(m.tracks)} в библиотеке</span>
          {m.bio && <button type="button" className={css.biolink} onClick={(e) => onBio(e.currentTarget)}>Биография<Icon name="ChevronRight" size={14} /></button>}
        </div>
        <div className={css.acts}>
          <button type="button" className={cx("btn", "play")} onClick={(e) => onPlay(e.currentTarget)}><Icon name="Play" size={16} />Слушать</button>
          <button type="button" className={cx("btn", "ghost", glass.lg)} onClick={(e) => onShuffle(e.currentTarget)}><Icon name="Shuffle" size={17} />Вперемешку</button>
          <button type="button" className={cx("btn", "ghost", "wave", glass.lg)} onClick={onStream} data-busy={streaming ? "" : undefined}
            title="Его песни вперемешку с похожими по звучанию из твоей библиотеки"><Icon name="Sparkles" size={17} />Поток артиста</button>
        </div>
      </div>
    </section>
  );
}

/** The name in big type (or Apple Music's transparent logo), the «?» that tells where it came from. */
function Name({ m, logo, hero }: { m: Model; logo: string | null; hero: React.RefObject<HTMLElement | null> }) {
  const q = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => { if (!pop.current?.contains(e.target as Node) && e.target !== q.current) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const toggle = () => {
    const h = hero.current, b = q.current, o = pop.current;
    if (!h || !b || !o) return;
    if (!open) {
      // laid out in the hero's terms, written in the terms of the box the pop-up sits in
      const hr = h.getBoundingClientRect(), qr = b.getBoundingClientRect(), pr = (o.offsetParent ?? h).getBoundingClientRect();
      let x = qr.left - hr.left, y = qr.bottom - hr.top + 10;
      const above = y + 140 > hr.height;
      if (above) y = qr.top - hr.top - 10 - o.offsetHeight;
      x = Math.min(x, hr.width - o.offsetWidth - 20);
      Object.assign(o.style, { left: `${x - (pr.left - hr.left)}px`, top: `${y - (pr.top - hr.top)}px` });
      o.style.setProperty("--ox", `${qr.left - hr.left - x + 8}px`);
      o.style.setProperty("--oy", above ? "100%" : "0px");
    }
    setOpen(!open);
  };
  const qBtn = m.nameOrigin ? <button ref={q} type="button" className={css.q} onClick={toggle} aria-label="Откуда название" aria-expanded={open}>?</button> : null;
  return (
    <>
      {logo
        ? <><h1 className={css.sr}>{m.name}</h1><div className={css.namerow}><img className={css.logo} src={logo} alt="" />{qBtn}</div></>
        : <h1 className={css.name}>{m.name.split(/\s+/).map((w, i) => <span key={i}><span className={css.w} style={{ ["--i" as string]: i }}>{w}</span>{" "}</span>)}{qBtn}</h1>}
      {m.nameOrigin && <div ref={pop} className={cx("origin", glass.lg, open && "on")} role="dialog" aria-label="Откуда название"><b>Откуда название</b>{m.nameOrigin}</div>}
    </>
  );
}

function Laurel({ k, gold, right }: { k: number; gold: boolean; right?: boolean }) {
  return (
    <svg className={right ? css.r : css.l} viewBox="0 0 13 30" aria-hidden>
      <path d={LAUREL_STEM} fill="none" stroke={gold ? "#c99a3c" : "#e3c37a"} strokeWidth=".9" strokeLinecap="round" opacity={gold ? 1 : 0.7} />
      <path d={laurelPath(k)} {...(gold ? { fill: "url(#mxGold)" } : { fill: "none", stroke: "#e3c37a", strokeWidth: 0.8, opacity: 0.85 })} />
    </svg>
  );
}

/** The statuette: a gold gramophone on a black plinth; a nomination is its outline only. */
function Statue({ win }: { win: boolean }) {
  return (
    <svg viewBox="0 0 20 30" aria-hidden>
      <g {...(win ? { fill: "url(#mxGold)", stroke: "rgba(96,66,12,.5)", strokeWidth: 0.35 } : { fill: "none", stroke: "#d9b45a", strokeWidth: 0.9, opacity: 0.75 })} strokeLinejoin="round">
        <path d="M9.3 14.6C9.5 11.6 10.9 9.4 13 7.8L15.3 1.6C17.4 2 19.4 3.9 20 6.2L14 9.2C12.2 10.5 11 12.2 10.7 14.6Z" />
        <ellipse cx="10" cy="15.3" rx="6.3" ry="1.5" /><rect x="9.3" y="16.5" width="1.4" height="4.4" rx=".4" /><rect x="7.4" y="20.7" width="5.2" height="1.3" rx=".55" />
      </g>
      {win
        ? <><rect x="3" y="22" width="14" height="7.6" rx="1.1" fill="url(#mxBase)" /><rect x="3.4" y="22" width="13.2" height=".55" rx=".27" fill="#e2bd63" opacity=".85" /></>
        : <rect x="3.4" y="22.4" width="13.2" height="6.8" rx="1" fill="none" stroke="#d9b45a" strokeWidth=".9" opacity=".55" />}
    </svg>
  );
}

/** The Grammys live in the facts line: a laurel with the count, the case grows out of it on hover,
 *  focus or click in liquid glass v2, above it in the name's zone — never over the photo. */
function Grammy({ g, hero, light }: { g: NonNullable<Model["grammy"]>; hero: React.RefObject<HTMLElement | null>; light: boolean }) {
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0); // re-plays the statuettes' placing on each opening
  const pinned = useRef(false);
  const tOpen = useRef(0), tClose = useRef(0);
  const w = g.wins, n = g.nominations ?? null;
  const hollow = n != null ? Math.max(0, n - w) : 0, total = w + hollow;
  const gw = total > 32 ? 10 : total > 22 ? 12 : 14;
  const k = laurelLeaves(w);
  const place = () => {
    const h = hero.current, b = btn.current, o = pop.current;
    if (!h || !b || !o) return;
    // above the laurel, in the name's zone; laid out in the hero's terms, written in the parent's
    const hr = h.getBoundingClientRect(), br = b.getBoundingClientRect(), pr = (o.offsetParent ?? h).getBoundingClientRect();
    const x = Math.min(br.left - hr.left - 6, hr.width - o.offsetWidth - 20), y = br.top - hr.top - o.offsetHeight - 12;
    Object.assign(o.style, { left: `${x - (pr.left - hr.left)}px`, top: `${y - (pr.top - hr.top)}px` });
    o.style.setProperty("--ox", `${br.left - hr.left - x + br.width / 2}px`);
    o.style.setProperty("--oy", "calc(100% + 12px)");
  };
  const show = (v: boolean) => {
    clearTimeout(tOpen.current); clearTimeout(tClose.current);
    if (v && !open) { place(); setNonce((x) => x + 1); }
    if (!v) pinned.current = false;
    setOpen(v);
  };
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) show(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") show(false); };
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc); };
  });
  useEffect(() => () => { clearTimeout(tOpen.current); clearTimeout(tClose.current); }, []);
  const leave = () => { clearTimeout(tOpen.current); if (!pinned.current) tClose.current = window.setTimeout(() => show(false), 220); };
  const lib = g.laureates;
  const line = w
    ? <><b>№{g.position}</b> из {lib} {lib % 10 === 1 && lib % 100 !== 11 ? "лауреата" : "лауреатов"} твоей библиотеки{n ? ` · ${n} ${n % 10 === 1 && n % 100 !== 11 ? "номинация" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "номинации" : "номинаций"}` : ""}</>
    : <>{n ?? 0} {nomWord(n ?? 0)} — и ни одной статуэтки. Академия, ну.</>;
  return (
    <span>
      <button ref={btn} type="button" className={cx("gb", !w && "zero")} aria-expanded={open} aria-label={`Грэмми: ${w}`}
        onPointerEnter={() => { clearTimeout(tClose.current); tOpen.current = window.setTimeout(() => show(true), 90); }}
        onPointerLeave={leave}
        onClick={() => { pinned.current = !pinned.current || !open; show(pinned.current || !open); }}
        onFocus={() => show(true)} onBlur={() => { if (!pinned.current) show(false); }}>
        <Laurel k={k} gold={!!w} /><b>{w || n}</b><Laurel k={k} gold={!!w} right /><em>{w ? "Грэмми" : `${nomWord(n ?? 0)} Грэмми`}</em>
      </button>
      <span ref={pop as unknown as React.RefObject<HTMLSpanElement>} className={cx("gpop", glass.lg, open && "on", light && "light")} role="dialog" aria-label="Грэмми"
        style={{ display: "block" }} onPointerEnter={() => clearTimeout(tClose.current)} onPointerLeave={leave}>
        <span className={css.gtop}><b className={cx("gn", !w && "zero")}>{w}</b><span className={css.gt}><span className={css.gl}>Грэмми</span><span className={css.gr}>{line}</span></span></span>
        <span className={css.shelf} key={nonce}>
          {Array.from({ length: w }, (_, i) => <Statuette key={`w${i}`} i={i} win gw={gw} />)}
          {Array.from({ length: hollow }, (_, i) => <span key={`n${i}`} className={cx("st", "nom")} style={{ ["--gw" as string]: `${gw}px`, ["--i" as string]: i }} title="номинация"><Statue win={false} /></span>)}
        </span>
      </span>
    </span>
  );
}

function Statuette({ i, gw }: { i: number; win: true; gw: number }) {
  const el = useRef<HTMLSpanElement>(null);
  const hop = () => { const s = el.current; if (!s) return; s.classList.remove(css.hop!); void s.offsetWidth; s.classList.add(css.hop!); };
  return <span ref={el} className={cx("st", "win")} style={{ ["--gw" as string]: `${gw}px`, ["--i" as string]: i }} onClick={hop}><Statue win /></span>;
}

const nomWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "номинация" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "номинации" : "номинаций");
