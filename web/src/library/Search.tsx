import { useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { rowToTrack } from "../api/db";
import { plural } from "../lib/format";
import { imageUrl } from "../lib/images";
import { fromTrack, player } from "../player/engine";
import { flyToMini } from "../player/MiniPlayer";
import { useGatefold } from "../ui/Gatefold";
import glass from "../ui/glass.module.css";
import { Icon } from "../ui/icons";
import { type Index, load } from "../ui/QuickSearch";
import css from "./library.module.css";

/** The library's search: the glass button grows into a glass field that covers every tool of
 *  the bar; the answers drop out of it in glass with a deeper tint. Each kind is told apart by
 *  shape and colour: an artist round and lilac, an album square with a record's edge and amber,
 *  a song a small cover with a note and teal. ↑↓ Enter Esc; «/» opens it. No AI, no network:
 *  the device's mirror (the home's quick search index). */

type K = "artist" | "album" | "song";
type Hit = { k: K; id: string; title: string; sub: string; cover: string | null; score: number };
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function find(ix: Index, q: string): { k: K; name: string; hits: Hit[] }[] {
  const n = norm(q);
  if (!n) return [];
  const sc = (s: string) => { const x = norm(s); return x.startsWith(n) ? 3 : (" " + x).includes(" " + n) ? 2 : x.includes(n) ? 1 : 0; };
  const pick = <T,>(list: T[], f: (x: T) => number, cap: number, make: (x: T, s: number) => Hit) =>
    list.map((x) => [f(x), x] as const).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, cap).map(([s, x]) => make(x, s));
  const albumOf = new Map(ix.albums.map((a) => [a.id, a]));
  return ([
    { k: "artist" as K, name: "Артисты", hits: pick(ix.artists, (a) => sc(a.name), 3, (a, s) => ({ k: "artist", id: a.id, title: a.name, sub: `${a.n} ${plural(a.n, "песня", "песни", "песен")}`, cover: a.imageId ?? a.cover, score: s })) },
    { k: "album" as K, name: "Альбомы", hits: pick(ix.albums, (a) => Math.max(sc(a.title), sc(a.artist) * 0.5), 4, (a, s) => ({ k: "album", id: a.id, title: a.title, sub: `${a.artist}${a.year ? " · " + a.year : ""}`, cover: a.coverImageId, score: s })) },
    { k: "song" as K, name: "Песни", hits: pick(ix.tracks, (t) => Math.max(sc(t.title), sc(t.artist) * 0.4), 6, (t, s) => ({ k: "song", id: t.id, title: t.title, sub: `${t.artist}${t.albumId && albumOf.get(t.albumId) ? " · " + albumOf.get(t.albumId)!.title : ""}`, cover: t.coverImageId, score: s })) },
  ]).filter((g) => g.hits.length).sort((a, b) => b.hits[0]!.score - a.hits[0]!.score);
}

function mark(s: string, q: string) {
  const n = norm(q), i = s.toLowerCase().replace(/ё/g, "е").indexOf(n);
  return i < 0 ? s : <>{s.slice(0, i)}<mark>{s.slice(i, i + n.length)}</mark>{s.slice(i + n.length)}</>;
}

export function SearchButton({ onSearching }: { onSearching: (on: boolean) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<{ right: number; top: number; width: number } | null>(null);
  const start = () => {
    const b = btn.current!, r = b.getBoundingClientRect(), bar = b.closest("[data-bar]");
    const tools = [...(bar?.querySelectorAll<HTMLElement>("[data-tool]") ?? [])].map((t) => t.getBoundingClientRect().left);
    const tabsEnd = bar?.querySelector("[data-tabs]")?.getBoundingClientRect().right ?? 0;
    const left = Math.max(tools.length ? Math.min(...tools) - 8 : r.right - 440, tabsEnd + 24);
    setOpen({ right: innerWidth - r.right, top: r.top + r.height / 2 - 23, width: Math.max(360, r.right - left) });
    onSearching(true);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target as HTMLElement).closest("input, textarea, [contenteditable]")) { e.preventDefault(); if (!open) start(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  return (
    <>
      <button ref={btn} type="button" className={`${css.sbtn} ${glass.lg}`} data-hide={open ? "" : undefined} aria-label="Поиск по библиотеке" onClick={start}>
        <Icon name="Search" size={18} /><kbd>/</kbd>
      </button>
      {open && <Field at={open} close={() => { setOpen(null); onSearching(false); btn.current?.animate([{ transform: "scale(.7)" }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.34,1.56,.64,1)" }); }} />}
    </>
  );
}

function Field({ at, close }: { at: { right: number; top: number; width: number }; close: () => void }) {
  const nav = useNavigate();
  const field = useRef<HTMLDivElement>(null), res = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [ix, setIx] = useState<Index | null>(null);
  const [on, setOn] = useState(0);
  const leaving = useRef(false);
  useEffect(() => { void load().then(setIx); }, []);
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
    if (!reduce()) field.current?.animate([{ clipPath: `inset(0 0 0 ${at.width - 46}px round 23px)`, opacity: 0.6 }, { clipPath: "inset(0 0 0 0 round 23px)", opacity: 1 }], { duration: 520, easing: "cubic-bezier(.2,1.1,.3,1)" });
  }, [at.width]);
  const groups = ix ? find(ix, q) : [];
  const flat = groups.flatMap((g) => g.hits);
  const shown = useRef(false);
  useLayoutEffect(() => {
    const r = res.current;
    if (!r || reduce()) return;
    if (flat.length && !shown.current) {
      r.animate([{ transform: "translateY(-8px) scale(.96)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: "cubic-bezier(.34,1.56,.64,1)" });
      [...r.querySelectorAll("[data-hit]")].slice(0, 10).forEach((el, i) => el.animate([{ transform: "translateY(6px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 320, delay: 40 + i * 22, easing: "cubic-bezier(.22,.9,.3,1)", fill: "backwards" }));
    }
    shown.current = flat.length > 0;
  }, [flat.length]);
  const leave = () => {
    if (leaving.current) return;
    leaving.current = true;
    const f = field.current, r = res.current;
    r?.animate([{ opacity: 1 }, { transform: "translateY(-8px) scale(.96)", opacity: 0 }], { duration: 170, easing: "ease-in", fill: "forwards" });
    const an = f?.animate([{ clipPath: "inset(0 0 0 0 round 23px)", opacity: 1 }, { clipPath: `inset(0 0 0 ${at.width - 46}px round 23px)`, opacity: 0 }], { duration: reduce() ? 1 : 260, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" });
    if (an) an.finished.then(close, close); else close();
  };
  useEffect(() => {
    const off = (e: PointerEvent) => { if (!field.current?.contains(e.target as Node) && !res.current?.contains(e.target as Node)) leave(); };
    window.addEventListener("pointerdown", off);
    return () => window.removeEventListener("pointerdown", off);
  });
  const act = (h: Hit | undefined, el: HTMLElement | null) => {
    if (!h) return;
    if (h.k === "song") {
      const t = ix?.tracks.find((x) => x.id === h.id);
      if (t) { flyToMini(el?.querySelector<HTMLElement>("[data-pic]") ?? null); void player.playTracks([fromTrack(rowToTrack(t), "search")]); }
    } else if (h.k === "album") {
      const r = el?.querySelector("img")?.getBoundingClientRect();
      useGatefold.getState().show({ id: h.id, cover: h.cover, from: r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null });
    } else void nav({ to: "/artist/$id", params: { id: h.id } });
    leave();
  };
  const top = at.top + 54;
  return (
    <>
      <div ref={field} className={`${css.sfield} ${glass.lg}`} style={{ right: at.right, top: at.top, width: at.width }}>
        <Icon name="Search" size={18} />
        <input ref={input} type="search" value={q} placeholder="Альбом, песня или артист" aria-label="Поиск по библиотеке" autoComplete="off" spellCheck={false}
          onChange={(e) => { setQ(e.target.value); setOn(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); leave(); }
            else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && flat.length) { e.preventDefault(); setOn((o) => (o + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length); }
            else if (e.key === "Enter" && flat[on]) { e.preventDefault(); act(flat[on], res.current?.querySelector(`[data-hit="${on}"]`) ?? null); }
          }} />
        <button type="button" className={css.sx} aria-label="Закрыть поиск" onClick={leave}><Icon name="Close" size={16} /></button>
      </div>
      {q.trim() && ix && (
        <div ref={res} className={`${css.sres} ${glass.lg}`} role="listbox" style={{ right: at.right, top, width: at.width, maxHeight: innerHeight - top - 150 }}>
          {!groups.length && <div className={css.snone}>Ничего не нашлось по «{q}».<br />Ищу по названиям альбомов и песен и по именам артистов.</div>}
          {groups.map((g) => (
            <div key={g.k} className={css.sgroup} data-k={g.k}>
              <h3>{g.name}<small>{g.hits.length}</small></h3>
              {g.hits.map((h) => {
                const i = flat.indexOf(h), src = imageUrl(h.cover, 96) ?? undefined;
                return (
                  <button key={h.k + h.id} type="button" className={css.hit} data-k={h.k} data-hit={i} data-on={i === on ? "" : undefined} onPointerMove={() => i !== on && setOn(i)}
                    onClick={(e) => act(h, e.currentTarget)}>
                    {h.k === "song" ? <span className={css.pw}><img className={css.pic} data-pic src={src} alt="" /><span className={css.note}><Icon name="Lyrics" size={11} /></span></span> : <img className={css.pic} src={src} alt="" />}
                    <span className={css.htx}><b>{mark(h.title, q)}</b><small><i>{h.k === "artist" ? "Артист" : h.k === "album" ? "Альбом" : "Песня"}</i> · {h.sub}</small></span>
                    <span className={css.go}><Icon name={h.k === "song" ? "Play" : "ChevronRight"} size={h.k === "song" ? 14 : 16} /></span>
                  </button>
                );
              })}
            </div>
          ))}
          {groups.length > 0 && <div className={css.shint}><span>↑↓ выбрать</span><span>Enter открыть</span><span>Esc закрыть</span></div>}
        </div>
      )}
    </>
  );
}
