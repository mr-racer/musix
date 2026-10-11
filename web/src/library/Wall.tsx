import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Link } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { image, imageUrl } from "../lib/images";
import { plural } from "../lib/format";
import { Icon } from "../ui/icons";
import glass from "../ui/glass.module.css";
import { openFrom, playAlbum, playArtist, playGroup, useFilm } from "./actions";
import { peel } from "./film";
import { flagUrl } from "./flags";
import { type AlbumCard, type ArtistCard, countryName, type Section } from "./model";
import css from "./library.module.css";

/** The wall: covers edge to edge, grouped; a big heading in the flow, a glass plate that
 *  holds the open group's name once its heading is under the bar, a rail at the right edge.
 *  Virtualized by rows over the window's scroll; the row heights are known, so a jump lands
 *  exactly (design/code/screens/library.md). */

export type Kind = "album" | "artist";
type Row<T> = { t: "head"; s: number; first: boolean } | { t: "tiles"; s: number; items: T[] } | { t: "rows"; s: number; item: T } | { t: "rhead" } | { t: "top" };

const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const SPRING = "cubic-bezier(.34,1.56,.64,1)";
const hue = (s: string) => [...s].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
const tileMin = (w: number) => (w < 1400 ? 190 : w < 1800 ? 208 : w < 2200 ? 224 : 244);

/** A cover that arrives organically: the palette's colour at once, then its 96 px sketch
 *  blurred, then the cover develops (a wave from the top left when several come together);
 *  a cover already in the browser's cache is simply there. */
export const WallCover = memo(function WallCover({ id, px, round }: { id: string | null; px: number; round?: boolean }) {
  const pal = image(id)?.palette;
  const src = imageUrl(id, Math.round(px * Math.min(2, devicePixelRatio || 1)));
  const sketch = imageUrl(id, 96);
  const ph = useRef<HTMLDivElement>(null);
  const done = (img: HTMLImageElement, cached: boolean) => {
    img.removeAttribute("data-wait");
    const hide = () => { if (ph.current) ph.current.style.display = "none"; };
    if (cached || reduce()) { hide(); return; }
    const r = img.getBoundingClientRect(), d = Math.max(0, Math.min(1, (r.left + r.top) / (innerWidth + innerHeight))) * 420 + Math.random() * 60;
    img.animate([{ opacity: 0, filter: "blur(12px) saturate(.7)", transform: "scale(1.06)" }, { opacity: 1, filter: "blur(0px) saturate(1)", transform: "scale(1)" }],
      { duration: 680, delay: d, easing: "cubic-bezier(.2,.75,.25,1)", fill: "backwards" });
    setTimeout(hide, d + 720);
  };
  return (
    <>
      <div ref={ph} className={css.ph} style={{ background: pal ? `linear-gradient(145deg, ${pal.dominant ?? pal.muted}, ${pal.muted ?? pal.dominant})` : "#202026" }}>
        {sketch && sketch !== src && <img src={sketch} alt="" decoding="async" />}
      </div>
      {src && <img className={css.cv} data-wait="" src={src} alt="" decoding="async" loading="lazy" draggable={false}
        style={round ? { borderRadius: "50%" } : undefined}
        ref={(el) => { if (el?.complete && el.naturalWidth && el.hasAttribute("data-wait")) done(el, true); }}
        onLoad={(e) => e.currentTarget.hasAttribute("data-wait") && done(e.currentTarget, false)} />}
    </>
  );
});

function Film({ rewrap }: { rewrap: boolean }) {
  return <span className={css.film} data-film="" data-rewrap={rewrap ? "" : undefined}><span className={css.sticker}>не слушал</span></span>;
}

const AlbumTile = memo(function AlbumTile({ a, px, sealed, rewrap }: { a: AlbumCard; px: number; sealed: boolean; rewrap: boolean }) {
  const el = useRef<HTMLAnchorElement>(null);
  const go = (e: React.MouseEvent, play: boolean) => {
    if (!play && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
    e.preventDefault(); e.stopPropagation();
    const box = el.current!, film = box.querySelector<HTMLElement>("[data-film]");
    const act = () => (play ? void playAlbum(a.id, box) : openFrom(a.id, a.cover, box, sealed));
    if (sealed && film) peel(box, film, act);
    else act();
  };
  return (
    <Link ref={el} to="/album/$id" params={{ id: a.id }} className={css.card} data-id={a.id} onClick={(e) => go(e, false)} draggable={false}>
      <WallCover id={a.cover} px={px} />
      {sealed && <Film rewrap={rewrap} />}
      <span className={css.cap}><b>{a.title}</b><small>{a.artist}{a.year ? ` · ${a.year}` : ""}</small></span>
      <button type="button" className={css.play} aria-label={`Слушать «${a.title}»`} onClick={(e) => go(e, true)}><Icon name="Play" size={18} /></button>
    </Link>
  );
});

const ArtistTile = memo(function ArtistTile({ a, px }: { a: ArtistCard; px: number }) {
  const el = useRef<HTMLAnchorElement>(null);
  return (
    <Link ref={el} to="/artist/$id" params={{ id: a.id }} className={css.card} data-id={a.id} draggable={false}>
      {a.image ? <WallCover id={a.image} px={px} /> : <span className={css.mono} style={{ ["--h" as string]: hue(a.name) }}>{[...a.name][0]}</span>}
      <span className={css.capOn}><b>{a.name}</b><small>{a.albums ? `${a.albums} ${plural(a.albums, "альбом", "альбома", "альбомов")} · ` : ""}{a.n} {plural(a.n, "песня", "песни", "песен")}</small></span>
      <button type="button" className={css.playR} aria-label={`Слушать ${a.name}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void playArtist(a.id, el.current); }}>
        <Icon name="Play" size={18} />
      </button>
    </Link>
  );
});

function listened(p: number, mx: number) {
  return p ? <span className={css.rpl}><i style={{ ["--f" as string]: Math.sqrt(p / mx).toFixed(3) }} />{p}</span> : <span><span className={css.new}>не слушал</span></span>;
}

function AlbumLine({ a, mx, other, sealed }: { a: AlbumCard; mx: number; other: string; sealed: boolean }) {
  const el = useRef<HTMLAnchorElement>(null);
  return (
    <Link ref={el} to="/album/$id" params={{ id: a.id }} className={css.row} data-id={a.id}
      onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey) return; e.preventDefault(); openFrom(a.id, a.cover, el.current?.querySelector("img") ?? null, false); }}>
      <span className={css.rc}><WallCover id={a.cover} px={56} />{sealed && <Film rewrap={false} />}</span>
      <span className={css.rt}>{a.title}</span><span className={css.rm}>{a.artist}</span><span className={css.rn}>{a.year ?? "—"}</span><span className={css.rm}>{other}</span>
      {listened(a.plays, mx)}
      <button type="button" className={css.rp} aria-label="Слушать" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void playAlbum(a.id, el.current); }}><Icon name="Play" size={14} /></button>
    </Link>
  );
}

function ArtistLine({ a, mx }: { a: ArtistCard; mx: number }) {
  const el = useRef<HTMLAnchorElement>(null);
  return (
    <Link ref={el} to="/artist/$id" params={{ id: a.id }} className={css.rowA} data-id={a.id}>
      <span className={css.rc}>{a.image ? <WallCover id={a.image} px={56} /> : <span className={css.mono} style={{ ["--h" as string]: hue(a.name) }}>{[...a.name][0]}</span>}</span>
      <span className={css.rt}>{a.name}</span><span className={css.rn}>{a.albums || "—"}</span><span className={css.rn}>{a.n}</span>
      {listened(a.plays, mx)}
      <button type="button" className={css.rp} aria-label="Слушать" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void playArtist(a.id, el.current); }}><Icon name="Play" size={14} /></button>
    </Link>
  );
}

export function Flag({ cc, wave }: { cc: string | null | undefined; wave?: boolean }) {
  const u = flagUrl(cc);
  return u ? <span className={css.flag} data-wave={wave ? "" : undefined} style={{ backgroundImage: `url(${u})` }} /> : null;
}

/** A few covers of a group, as a stack (the home's «якоря вкуса», which the owner liked). */
function Stack<T extends AlbumCard | ArtistCard>({ s }: { s: Section<T> }) {
  if (s.cc) return <span className={css.mstack}><Flag cc={s.cc} /></span>;
  const ids = s.items.map((x) => ("cover" in x && "image" in x ? (x as ArtistCard).image ?? (x as ArtistCard).cover : (x as AlbumCard).cover)).filter(Boolean).slice(0, 3);
  return <span className={css.mstack}>{ids.map((id) => <img key={id} src={imageUrl(id, 64) ?? undefined} alt="" />)}</span>;
}

export function Wall<T extends AlbumCard | ArtistCard>({ kind, sections, view, top, otherOf, mx }: {
  kind: Kind; sections: Section<T>[]; view: "grid" | "rows"; top?: React.ReactNode; otherOf?: (a: AlbumCard) => string; mx: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const topEl = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [topH, setTopH] = useState(0);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => {
      setWidth(box.current?.clientWidth ?? 1200); setTopH(topEl.current?.offsetHeight ?? 0);
      setMargin(box.current ? box.current.getBoundingClientRect().top + window.scrollY : 0);
    });
    if (box.current) ro.observe(box.current);
    if (topEl.current) ro.observe(topEl.current);
    return () => ro.disconnect();
  }, []);
  const gap = 5, cols = Math.max(2, Math.floor((width + gap) / (tileMin(window.innerWidth) + gap))), tile = (width - gap * (cols - 1)) / cols;
  const film = useFilm();

  // rows and their exact heights: a jump to a group lands where it should
  const { rows, heads } = useMemo(() => {
    const rows: Row<T>[] = [{ t: "top" }];
    const heads: number[] = [];
    if (view === "rows" && sections.length) rows.push({ t: "rhead" });
    sections.forEach((s, i) => {
      heads.push(rows.length); rows.push({ t: "head", s: i, first: i === 0 });
      if (view === "grid") for (let k = 0; k < s.items.length; k += cols) rows.push({ t: "tiles", s: i, items: s.items.slice(k, k + cols) });
      else for (const item of s.items) rows.push({ t: "rows", s: i, item });
    });
    return { rows, heads };
  }, [sections, view, cols]);
  const heightOf = useCallback((r: Row<T>) => (r.t === "top" ? topH : r.t === "head" ? (r.first ? 76 : 112) : r.t === "tiles" ? tile + gap : r.t === "rhead" ? 40 : 72), [tile, topH]);
  const starts = useMemo(() => { const out: number[] = []; let y = 0; for (const r of rows) { out.push(y); y += heightOf(r); } return out; }, [rows, heightOf]);
  const v = useWindowVirtualizer({ count: rows.length, estimateSize: (i) => heightOf(rows[i]!), overscan: 3, scrollMargin: margin });
  useEffect(() => { v.measure(); }, [v, heightOf, rows]);

  // the group under the bar: the plate's name, the rail's mark
  const [cur, setCur] = useState(-1);
  const [plateOn, setPlateOn] = useState(false);
  const listTop = () => (box.current ? box.current.getBoundingClientRect().top + window.scrollY : 0);
  const BAR = 72;
  useEffect(() => {
    const on = () => {
      const y = window.scrollY + BAR - listTop();
      let i = -1;
      for (let k = 0; k < heads.length; k++) { const hs = starts[heads[k]!]! + (k ? 36 : 0); if (hs <= y + 12) i = k; else break; }
      setCur(i);
      setPlateOn(i >= 0 && starts[heads[i]!]! + heightOf(rows[heads[i]!]!) <= y + 4);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [heads, starts, rows, heightOf]);

  const glideRaf = useRef(0);
  const glide = useCallback((i: number, instant?: boolean) => {
    const hs = heads[i]; if (hs == null) return;
    const to = Math.max(0, listTop() + starts[hs]! + (i ? 36 : 0) - BAR - 4), from = window.scrollY, dist = to - from;
    cancelAnimationFrame(glideRaf.current);
    const arrive = () => requestAnimationFrame(() => {
      const h = box.current?.querySelector<HTMLElement>(`[data-head="${i}"]`); if (!h || reduce()) return;
      h.animate([{ transform: "translateY(10px)", opacity: 0.35 }, { transform: "none", opacity: 1 }], { duration: 480, easing: SPRING });
      const f = h.querySelector<HTMLElement>("[data-wave], ." + css.flag); if (f) { f.removeAttribute("data-wave"); void f.offsetWidth; f.setAttribute("data-wave", ""); }
    });
    if (instant || reduce() || Math.abs(dist) < 2) { window.scrollTo(0, to); if (!instant) arrive(); return; }
    if (Math.abs(dist) > innerHeight * 1.6) {
      const el = box.current!, dir = Math.sign(dist);
      el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateY(${-dir * 30}px)` }], { duration: 160, easing: "cubic-bezier(.4,0,1,1)" }).finished.then(() => {
        window.scrollTo(0, to); arrive();
        el.animate([{ opacity: 0, transform: `translateY(${dir * 40}px)` }, { opacity: 1, transform: "none" }], { duration: 520, easing: "cubic-bezier(.2,1,.3,1)" });
      });
      return;
    }
    const T0 = performance.now(), dur = Math.min(640, 320 + Math.abs(dist) * 0.28), ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    const f = (now: number) => { const k = Math.min(1, (now - T0) / dur); window.scrollTo(0, from + dist * ease(k)); if (k < 1) glideRaf.current = requestAnimationFrame(f); else arrive(); };
    glideRaf.current = requestAnimationFrame(f);
  }, [heads, starts]);

  // the light on the film follows the pointer
  const onMove = (e: React.PointerEvent) => {
    const f = (e.target as HTMLElement).closest("[data-id]")?.querySelector<HTMLElement>("[data-film]");
    if (!f) return;
    const r = f.getBoundingClientRect();
    f.style.setProperty("--hx", ((e.clientX - r.left) / r.width).toFixed(3)); f.style.setProperty("--hy", ((e.clientY - r.top) / r.height).toFixed(3));
  };

  const sealedOf = (a: AlbumCard) => !a.plays && !film.heard.has(a.id) && !film.open.has(a.id);
  const rowKids = (r: Row<T>, i: number) => {
    if (r.t === "top") return <div ref={topEl}>{top}</div>;
    if (r.t === "rhead") return kind === "album"
      ? <div className={css.rhead}><span /><span>Альбом</span><span>Артист</span><span>Год</span><span>Жанр</span><span>Прослушано</span><span /></div>
      : <div className={css.rheadA}><span /><span>Артист</span><span>Альбомы</span><span>Песни</span><span>Прослушано</span><span /></div>;
    if (r.t === "head") {
      const s = sections[r.s]!;
      return (
        <header className={css.sh} data-gap={r.first ? undefined : ""} data-head={r.s}>
          {s.cc && <Flag cc={s.cc} />}
          <h2 onClick={(e) => openJump(e.currentTarget)}>{s.name}</h2><span className={css.sub}>{s.sub}</span>
          <button type="button" className={css.dp} onClick={(e) => void playGroup(kind === "album" ? (s.items as AlbumCard[]).map((a) => a.id) : [],
            kind === "artist" ? (s.items as ArtistCard[]).map((a) => a.id) : [], box.current?.querySelector<HTMLElement>(`[data-id="${s.items[0]?.id}"]`) ?? e.currentTarget)}>
            <Icon name="Play" size={14} />Слушать группу
          </button>
        </header>
      );
    }
    if (r.t === "tiles") return (
      <div className={css.wallRow} style={{ ["--cols" as string]: cols, ["--gap" as string]: `${gap}px` }}>
        {r.items.map((x) => kind === "album"
          ? <AlbumTile key={x.id} a={x as AlbumCard} px={tile} sealed={sealedOf(x as AlbumCard)} rewrap={film.rewrap.has(x.id)} />
          : <ArtistTile key={x.id} a={x as ArtistCard} px={tile} />)}
      </div>
    );
    void i;
    return kind === "album"
      ? <AlbumLine a={r.item as AlbumCard} mx={mx} other={otherOf?.(r.item as AlbumCard) ?? ""} sealed={sealedOf(r.item as AlbumCard)} />
      : <ArtistLine a={r.item as ArtistCard} mx={mx} />;
  };

  // the list of groups, out of the plate or a heading
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openJump = (el: Element) => { const r = el.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 8 }); };

  return (
    <div ref={box} className={css.vlist} style={{ height: v.getTotalSize() }} onPointerMove={onMove}>
      {v.getVirtualItems().map((it) => (
        <div key={it.key} className={css.vrow} style={{ transform: `translateY(${it.start - v.options.scrollMargin}px)`, height: it.size }}>
          {rowKids(rows[it.index]!, it.index)}
        </div>
      ))}
      <Plate sections={sections} cur={cur} on={plateOn} onOpen={openJump} left={box.current?.getBoundingClientRect().left ?? 120} />
      <Rail sections={sections} cur={cur} glide={glide} />
      {menu && <JumpMenu sections={sections} cur={cur} at={menu} close={closeMenu} go={(i) => { setMenu(null); glide(i); }} />}
    </div>
  );
}

function Plate<T extends AlbumCard | ArtistCard>({ sections, cur, on, onOpen, left }: { sections: Section<T>[]; cur: number; on: boolean; onOpen: (el: Element) => void; left: number }) {
  const el = useRef<HTMLButtonElement>(null);
  const was = useRef({ on: false, cur: -1 });
  const s = sections[cur];
  useLayoutEffect(() => {
    const p = el.current; if (!p) return;
    if (on && !was.current.on && !reduce()) p.animate([{ opacity: 0, transform: "translateY(-10px) scale(.92)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 460, easing: SPRING });
    if (on && was.current.on && cur !== was.current.cur && !reduce()) {
      const dir = cur > was.current.cur ? 1 : -1;
      p.querySelector("[data-nm]")?.animate([{ transform: `translateY(${dir * 100}%)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: SPRING });
    }
    was.current = { on, cur };
  }, [on, cur]);
  return (
    <button ref={el} type="button" className={`${css.plate} ${glass.lg}`} hidden={!on || !s} style={{ left }} aria-haspopup="menu" onClick={(e) => onOpen(e.currentTarget)}>
      {s && <><Stack s={s} /><span className={css.nm}><span data-nm>{s.name}</span></span><small>{s.items.length}</small><Icon name="ChevronDown" size={16} /></>}
    </button>
  );
}

function Rail<T extends AlbumCard | ArtistCard>({ sections, cur, glide }: { sections: Section<T>[]; cur: number; glide: (i: number, instant?: boolean) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [lab, setLab] = useState<{ i: number; y: number } | null>(null);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const total = sections.reduce((n, s) => n + s.items.length, 0) || 1;
  const H = el.current?.clientHeight ?? 400;
  if (sections.length < 2) return null;
  const at = (y: number) => { const segs = [...(el.current?.children ?? [])] as HTMLElement[]; for (const sg of segs) { const r = sg.getBoundingClientRect(); if (y <= r.bottom + 1.5) return +sg.dataset.i!; } return sections.length - 1; };
  const move = (e: React.PointerEvent) => {
    const i = at(e.clientY);
    for (const sg of [...(el.current?.children ?? [])] as HTMLElement[]) {
      const r = sg.getBoundingClientRect(), f = Math.max(0, 1 - Math.abs((r.top + r.bottom) / 2 - e.clientY) / 70);
      sg.style.setProperty("--fx", (1 + f * 1.4).toFixed(2)); sg.style.setProperty("--fs", (1 + f * 0.45).toFixed(2));
    }
    setLab({ i, y: e.clientY - 20 });
    if (drag.current) { if (Math.abs(e.clientY - drag.current.y) > 4) drag.current.moved = true; if (drag.current.moved) glide(i, true); }
  };
  const leave = () => { if (drag.current) return; setLab(null); for (const sg of [...(el.current?.children ?? [])] as HTMLElement[]) { sg.style.removeProperty("--fx"); sg.style.removeProperty("--fs"); } };
  const s = lab ? sections[lab.i] : null;
  return (
    <>
      <div ref={el} className={css.rail} aria-label="Перейти к группе" onPointerMove={move} onPointerLeave={leave}
        onPointerDown={(e) => { drag.current = { y: e.clientY, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerUp={(e) => { const d = drag.current; drag.current = null; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* gone */ } if (d && !d.moved) glide(at(e.clientY)); }}>
        {sections.map((x, i) => {
          const h = (H * x.items.length) / total, u = x.cc ? flagUrl(x.cc) : null;
          return (
            <div key={x.key} className={css.rseg} data-i={i} data-on={i === cur ? "" : undefined} style={{ flexGrow: Math.max(1, x.items.length) }}>
              {h >= 13 && (u ? <i style={{ backgroundImage: `url(${u})` }} /> : x.short ? <b>{x.short}</b> : null)}
            </div>
          );
        })}
      </div>
      <div className={css.rlabel} hidden={!s} style={{ top: lab?.y ?? 0 }}>{s && <><Stack s={s} />{s.name}<small>{s.items.length}</small></>}</div>
    </>
  );
}

function JumpMenu<T extends AlbumCard | ArtistCard>({ sections, cur, at, close, go }: { sections: Section<T>[]; cur: number; at: { x: number; y: number }; close: () => void; go: (i: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const m = el.current!;
    if (!reduce()) {
      m.animate([{ transform: "scale(.86)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: SPRING });
      [...m.children].slice(0, 14).forEach((b, i) => b.animate([{ transform: "translateY(-4px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 260, delay: 30 + i * 24, easing: "cubic-bezier(.22,.9,.3,1)", fill: "backwards" }));
    }
    const on = m.querySelector<HTMLElement>("[aria-pressed='true']"); if (on) m.scrollTop = Math.max(0, on.offsetTop - 80);
    const off = (e: PointerEvent) => { if (!m.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    setTimeout(() => window.addEventListener("pointerdown", off), 0);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", off); window.removeEventListener("keydown", esc); };
  }, [close]);
  return (
    <div ref={el} className={`${css.menuGlass} ${glass.deep}`} role="menu" style={{ left: Math.min(at.x, innerWidth - 300), top: at.y, maxHeight: innerHeight - at.y - 150 }}>
      {sections.map((s, i) => (
        <button key={s.key} type="button" role="menuitem" aria-pressed={i === cur} onClick={() => go(i)}>
          <Stack s={s} /><span className={css.nm}>{s.name}</span><small>{s.items.length}</small>
        </button>
      ))}
    </div>
  );
}

export { countryName };
