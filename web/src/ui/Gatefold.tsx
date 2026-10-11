import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { mediaUrl, type Schemas } from "../api/client";
import { albumQuery, artistQuery } from "../api/queries";
import { clock, plural } from "../lib/format";
import { image, imageUrl } from "../lib/images";
import { coverFill } from "../lib/coverFill";
import { fromTrack, player, usePlayer, type QueueItem } from "../player/engine";
import css from "./Gatefold.module.css";
import { Icon } from "./icons";

type Rect = { top: number; left: number; width: number; height: number };
type Open = { id: string; cover: string | null; from: Rect | null };

/** v1's album gatefold: the open album is UI state, not a route. A plain click on an album
 *  card opens it in place; `/album/$id` stays the deep link and the new-tab target.
 *  Design: design/reference/gatefold (variant «Разворот», the owner's choice of 2026-10-10). */
export const useGatefold = create<{ open: Open | null; show: (o: Open) => void; hide: () => void }>((set) => ({
  open: null,
  show: (open) => set({ open }),
  hide: () => set({ open: null }),
}));

/** A click handler for album links: a plain left click opens the gatefold from the clicked
 *  cover. A modified click (new tab, new window) does what the link does. */
export function openAlbum(e: React.MouseEvent, id: string, cover: string | null, coverEl: Element | null): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const r = coverEl?.getBoundingClientRect();
  useGatefold.getState().show({ id, cover, from: r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null });
}

/** A render crash inside the gatefold closes it quietly, never a white screen. */
class Boundary extends Component<{ onReset: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("[gatefold] closed after a render error", error); this.props.onReset(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function GatefoldHost() {
  const open = useGatefold((s) => s.open);
  const hide = useGatefold((s) => s.hide);
  if (!open) return null;
  return <Boundary key={open.id} onReset={hide}><Gatefold {...open} onClose={hide} /></Boundary>;
}

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const SPRING = "cubic-bezier(.34,1.56,.64,1)";
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const frames = (n: number) => new Promise<void>((r) => { const f = (k: number) => (k ? requestAnimationFrame(() => f(k - 1)) : r()); f(n); });

/** A one-shot Web Animation whose end state stays: committed, then dropped, so the next move
 *  starts from what is on screen and nothing stacks. */
function run(el: Element | null | undefined, kf: Keyframe[], o: KeyframeAnimationOptions): Promise<void> {
  if (!el) return Promise.resolve();
  const an = el.animate(kf, { fill: "forwards", ...(reduced() ? { ...o, duration: 1, delay: 0 } : o) });
  return an.finished.then(() => { try { an.commitStyles(); } catch { /* detached */ } an.cancel(); }, () => {});
}

/** The spread: two square pages of side L in the middle of the room above the mini player.
 *  On a phone the gatefold is one full-screen page. */
function measure() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const mini = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--player-h")) || 0;
  const narrow = vw <= 768;
  const L = Math.round(Math.min((vh - mini - 48) * 0.94, (vw - 240) / 2, vh >= 1300 ? 900 : 720));
  return { narrow, L: Math.max(320, L), cy: Math.round((vh - mini) / 2) };
}

/** Large covers of the stack, loaded under the pointer, so the one that travels on a click is
 *  painted sharp (a 96 px thumbnail stretched over the page looked soapy). */
const big = new Map<string, HTMLImageElement>();
function preloadCover(coverId: string | null | undefined): void {
  const url = imageUrl(coverId, 1000);
  if (!url || big.has(url)) return;
  const im = new Image();
  im.src = url;
  big.set(url, im);
}

const MONTHS = ["янв.", "февр.", "марта", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."];
const day = (iso: string) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const span = (ms: number) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`; };

function Gatefold({ id: firstId, cover, from, onClose }: Open & { onClose: () => void }) {
  const [id, setId] = useState(firstId);
  const [prevId, setPrevId] = useState<string | null>(null);   // the right page's old colour, fading out after a swap
  const [swapped, setSwapped] = useState(false);
  const [leaving, setLeaving] = useState<"" | "swap" | "close">("");
  const [fading, setFading] = useState(false);   // the scrim goes once the page has folded back
  const q = useQuery(albumQuery(id));
  const qc = useQueryClient();
  const nav = useNavigate();
  const [{ narrow, L, cy }] = useState(measure);
  const gf = useRef<HTMLDivElement>(null);
  const sleeve = useRef<HTMLDivElement>(null);
  const flip = useRef<HTMLDivElement>(null);
  const leaf = useRef<HTMLDivElement>(null);
  const lit = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const home = useRef<string | null>(null);
  const busy = useRef(true);
  const closing = useRef(false);

  const album = q.data?.album;
  const tracks = useMemo(() => q.data?.tracks ?? [], [q.data]);
  const items = useMemo(() => tracks.map((t) => fromTrack(t, "album", id)), [tracks, id]);
  const coverId = album?.coverImageId ?? (id === firstId ? cover : null);
  const pal = image(coverId)?.palette;
  const bgVariant = image(coverId)?.urls.bg;
  const bg = bgVariant ? mediaUrl(bgVariant) : null;
  const low = imageUrl(coverId, 400);    // the grid's variant: already cached, so the sleeve paints mid-flight
  const high = imageUrl(coverId, 1000);

  // the mini player stays above the scrim while an album is open: queued tracks fly into it
  useEffect(() => {
    document.documentElement.dataset.gatefold = "";
    return () => { delete document.documentElement.dataset.gatefold; };
  }, []);

  const unfold = useCallback(() => {
    const d = 440;
    if (leaf.current) leaf.current.dataset.open = "";
    void run(gf.current, [{ transform: "translateX(0)" }, { transform: `translateX(${-L / 2}px)` }], { duration: d, easing: "cubic-bezier(.2,.9,.25,1)" });
    void run(lit.current, [{ opacity: 0.6 }, { opacity: 0 }], { duration: d, easing: "ease-out" });
    return run(leaf.current, [{ transform: "rotateY(90deg)" }, { transform: "rotateY(0deg)" }], { duration: d, easing: "cubic-bezier(.25,1.08,.4,1)" });
  }, [L]);

  // v1's opening, kept: the sleeve flies out of the grid and turns over, and its back is the
  // same sharp cover (no blur before the album has opened). Then the right page swings out
  // from behind the left one (only its last 90° are seen) while the spread slides to the
  // middle, and the blur under the text comes up with the text.
  useLayoutEffect(() => {
    const g = gf.current, sl = sleeve.current, fl = flip.current;
    if (!g || !sl || !fl) return;
    const end = sl.getBoundingClientRect();
    if (from && end.width && !reduced()) {
      const t = `translate(${from.left + from.width / 2 - (end.left + end.width / 2)}px, ${from.top + from.height / 2 - (end.top + end.height / 2)}px) scale(${from.width / end.width})`;
      home.current = t;
      sl.style.transform = t;
      void run(sl, [{ transform: t }, { transform: "none" }], { duration: 700, easing: "cubic-bezier(.3,.75,.25,1)" });
    }
    void run(fl, [{ transform: "rotateY(0deg)" }, { transform: "rotateY(180deg)" }], { duration: 850, delay: 60, easing: "cubic-bezier(.35,.72,.22,1)" });
    let alive = true;
    void (async () => {
      if (!narrow) { await wait(reduced() ? 0 : 620); if (!alive) return; await unfold(); }
      else await wait(reduced() ? 0 : 900);
      busy.current = false;
      g.style.setProperty("--d0", "0ms");   // what mounts later (a swap) rises at once
    })();
    return () => { alive = false; };
    // the opening plays once, from where the card was clicked
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the bands under the left page's text follow the height of that text
  useLayoutEffect(() => {
    const pg = page.current;
    if (!pg || narrow) return;
    const set = () => {
      const top = pg.querySelector<HTMLElement>(`.${css.liner}`), bot = pg.querySelector<HTMLElement>(`.${css.poster}`);
      pg.style.setProperty("--top-h", `${top?.offsetHeight ?? 0}px`);
      pg.style.setProperty("--bot-h", `${bot?.offsetHeight ?? 0}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    pg.querySelectorAll(`.${css.liner}, .${css.poster}`).forEach((e) => ro.observe(e));
    return () => ro.disconnect();
  }, [q.data, id, narrow]);

  // the close plays it backwards: the page swings back, the sleeve turns and flies home
  const close = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    setLeaving("close");
    if (!narrow) {
      const d = 260, e = "cubic-bezier(.55,.06,.6,.9)";
      void run(gf.current, [{ transform: `translateX(${-L / 2}px)` }, { transform: "translateX(0)" }], { duration: d, easing: e });
      void run(lit.current, [{ opacity: 0 }, { opacity: 0.6 }], { duration: d, easing: "ease-in" });
      await run(leaf.current, [{ transform: "rotateY(0deg)" }, { transform: "rotateY(90deg)" }], { duration: d, easing: e });
      if (leaf.current) delete leaf.current.dataset.open;
    }
    setFading(true);
    const sl = sleeve.current;
    // after a swap the way home is the new album's own cover on the page, if it is there
    let to = home.current;
    if (swapped && sl) {
      const el = document.querySelector(`[data-album-cover="${id}"]`);
      const a = el?.getBoundingClientRect(), b = sl.getBoundingClientRect();
      to = a && a.width ? `translate(${a.left + a.width / 2 - (b.left + b.width / 2)}px, ${a.top + a.height / 2 - (b.top + b.height / 2)}px) scale(${a.width / b.width})` : null;
    }
    void run(flip.current, [{ transform: "rotateY(180deg)" }, { transform: "rotateY(360deg)" }], { duration: 480, easing: "cubic-bezier(.5,.08,.4,1)" });
    if (sl) void run(sl, [{ transform: "none", opacity: 1 }, to ? { transform: to, opacity: 1 } : { transform: "scale(.6)", opacity: 0 }], { duration: 430, easing: "cubic-bezier(.55,.06,.5,.9)" });
    await wait(reduced() ? 0 : 450);
    onClose();
  }, [L, narrow, swapped, id, onClose]);

  useEffect(() => {
    // the page stops scrolling under the gatefold, but keeps the scrollbar's room: without it
    // the page grew by the bar's width, the library's wall laid its tiles out again and the
    // covers shifted while the album opened and back when it closed (the owner's report)
    const root = document.documentElement.style, prev = document.body.style.overflow, gutter = root.scrollbarGutter;
    root.scrollbarGutter = "stable";
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") void close(); };
    document.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = prev; root.scrollbarGutter = gutter; document.removeEventListener("keydown", esc); };
  }, [close]);

  // «Ещё у артиста»: the other album's cover travels from its thumbnail onto the left page
  // (a canvas of the thumbnail's own pixels, at the page's size, scaled onto the thumbnail,
  // so its corners never round on the way). The spread stays open: the text gives way, the
  // right page's colour crossfades, the new text rises.
  const swap = useCallback(async (toId: string, thumb: HTMLImageElement | null, toCover: string | null) => {
    if (busy.current || closing.current || toId === id) return;
    busy.current = true;
    setLeaving("swap");
    const data = qc.fetchQuery(albumQuery(toId)).catch(() => null);
    const pg = page.current;
    let clone: HTMLCanvasElement | null = null;
    if (pg && thumb?.naturalWidth && !reduced()) {
      const a = thumb.getBoundingClientRect(), b = pg.getBoundingClientRect();
      const large = big.get(imageUrl(toCover, 1000) ?? "");
      const src = large?.complete && large.naturalWidth ? large : thumb;
      clone = document.createElement("canvas");
      const s = Math.min(1024, Math.round(b.width * Math.min(window.devicePixelRatio || 1, 2)));
      clone.width = s; clone.height = s;
      try { clone.getContext("2d")?.drawImage(src, 0, 0, s, s); } catch { clone = null; }
      if (clone) {
        Object.assign(clone.style, { position: "fixed", zIndex: "103", left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`,
          borderRadius: "18px 0 0 18px", transformOrigin: "0 0", pointerEvents: "none", boxShadow: "0 30px 60px -20px rgba(0,0,0,.7)" } as CSSStyleDeclaration);
        document.body.appendChild(clone);
        await run(clone, [
          { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width})` },
          { transform: "none" }], { duration: 560, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    }
    const got = await data;
    if (!got) { clone?.remove(); setLeaving(""); busy.current = false; return; }
    // the new cover is decoded before it replaces the travelling copy
    const next = imageUrl(got.album.coverImageId, 1000);
    if (next) { const im = new Image(); im.src = next; await im.decode().catch(() => {}); }
    setPrevId(id); setId(toId); setSwapped(true); setLeaving("");
    if (clone) {
      const c = clone;
      await frames(2);
      void run(c, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-out" }).then(() => c.remove());
    }
    setTimeout(() => setPrevId(null), 800);
    busy.current = false;
  }, [id, qc]);

  // the queue: positions of the hand-picked tracks after the current one
  const cur = usePlayer((s) => s.queue[s.index]);
  const playingNow = usePlayer((s) => s.playing || s.buffering);
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const queued = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (let k = index + 1; k < queue.length; k++) if (queue[k]!.queued) m.set(queue[k]!.trackId, ++n);
    return m;
  }, [queue, index]);
  const mine = cur?.contextType === "album" && cur.contextId === id;

  const toArtist = (aid: string) => { void close(); void nav({ to: "/artist/$id", params: { id: aid } }); };
  const play = (i: number) => { if (items.length) void player.playTracks(items, i); };
  const toggleQueue = (i: number, from: HTMLElement | null) => {
    const t = tracks[i]!;
    if (queued.has(t.id)) return player.unqueue(t.id);
    player.enqueue(items[i]!);
    flyToNext(from, items[i]!);
  };

  const plays = useMemo(() => q.data?.trackPlays ?? {}, [q.data]);
  const total = tracks.reduce((s, t) => s + (t.durationMs ?? 0), 0);
  const playsSum = Object.values(plays).reduce((s, n) => s + n, 0);
  const genre = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of tracks) if (t.genre) c.set(t.genre, (c.get(t.genre) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [tracks]);
  const fav = useMemo(() => {
    const ranked = tracks.map((t) => [t.id, plays[t.id] ?? 0] as const).sort((a, b) => b[1] - a[1]);
    const [top, second] = ranked;
    return top && top[1] >= 5 && top[1] >= (second?.[1] ?? 0) + 2 ? top[0] : null;
  }, [tracks, plays]);

  const acc = pal?.accent.dark ?? "oklch(62% 0.16 285)";
  const style = { ["--L" as string]: `${L}px`, ["--cy" as string]: `${cy}px`, ["--acc" as string]: acc,
    ["--mark" as string]: `color-mix(in srgb, ${acc} 30%, #fff)` };

  const poster = album && (
    <div className={css.poster} key={`p${id}`}>
      <h2 className={album.title.length > 26 ? `${css.title} ${css.titleLong}` : css.title}>{album.title}</h2>
      {album.albumArtist && (
        <div><button type="button" className={css.who} onClick={() => toArtist(album.albumArtist!.id)}>
          {album.albumArtist.name}<Icon name="ChevronRight" size={16} />
        </button></div>
      )}
      <div className={css.facts}>
        {[album.year, genre, `${tracks.length} ${plural(tracks.length, "трек", "трека", "треков")}`, total ? span(total) : null].filter(Boolean).map((x, i) => <span key={i}>{x}</span>)}
      </div>
      <div className={css.acts}>
        <button type="button" className={css.play} data-on={(mine && playingNow) || undefined} disabled={!tracks.length}
          onClick={() => (mine ? player.toggle() : play(0))}>
          <span className={css.glyphs}><Icon name="Play" size={18} /><Icon name="Pause" size={18} /></span>
          {mine ? (playingNow ? "Пауза" : "Продолжить") : "Слушать"}
        </button>
        {q.data?.trackPlays && (   /* a server without the album's plays says nothing rather than «not heard» */
          <div className={css.stat}>
            {playsSum ? <><b>{playsSum}</b> {plural(playsSum, "прослушивание", "прослушивания", "прослушиваний")}
              {q.data.lastPlayedAt && <><br />последний раз {day(q.data.lastPlayedAt)}</>}</> : "Ещё не слушал"}
          </div>
        )}
      </div>
    </div>
  );

  const list = (
    <div className={css.list} key={`l${id}`}>
      <Rows tracks={tracks} plays={plays} fav={fav} current={mine ? cur?.trackId ?? null : null} playing={playingNow}
        queued={queued} onPlay={play} onQueue={toggleQueue} />
      {q.isError && <div className={css.err}>Не удалось открыть альбом</div>}
    </div>
  );

  const x = <button type="button" className={css.x} onClick={() => void close()} aria-label="Закрыть"><Icon name="Close" size={16} /></button>;

  return (
    <div className={css.overlay} data-leaving={fading || undefined} onClick={() => void close()}>
      <div ref={gf} className={narrow ? `${css.gf} ${css.narrow}` : css.gf} style={style} data-leaving={leaving || undefined}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label={album?.title ?? "Альбом"}>
        <div ref={sleeve} className={css.sleeve}>
          <div ref={flip} className={css.flip}>
            <div className={css.face}>
              <Picture key={coverId} low={low} high={high} seed={id} />
              <div className={css.sheen} aria-hidden />
            </div>
            <div ref={page} className={`${css.face} ${css.back}`}>
              {narrow ? (
                <>
                  <Paper url={bg} tint={pal?.muted} />
                  <div className={css.phoneBody}>{poster}{list}</div>
                  {x}
                </>
              ) : (
                <>
                  <Picture key={coverId} low={low} high={high} seed={id} />
                  <Bands key={`b${id}`} url={bg} />
                  <Liner key={`c${id}`} data={q.data} onArtist={toArtist} onSwap={swap} current={id} />
                  {poster}
                </>
              )}
            </div>
          </div>
        </div>
        {!narrow && (
          <div ref={leaf} className={css.leaf}>
            {/* keyed by album, so the old colour keeps its element (and its painted canvas)
                while the new one fades in over it */}
            {prevId && prevId !== id && <Paper key={prevId} url={backdropOf(prevId, qc)} tint={null} />}
            <Paper key={id} url={bg} tint={pal?.muted} fadeIn={swapped} />
            <div className={css.leafBody}>
              <div className={css.leafHead}><b>Треки</b><span>{tracks.length ? `${tracks.length} · ${span(total)}` : ""}</span></div>
              {list}
            </div>
            {x}
            <div className={css.crease} aria-hidden />
            <div ref={lit} className={css.lit} aria-hidden />
          </div>
        )}
      </div>
    </div>
  );
}

/** The backdrop URL of an album already in the query cache (the right page's old colour). */
function backdropOf(albumId: string, qc: ReturnType<typeof useQueryClient>): string | null {
  const d = qc.getQueryData<Schemas["AlbumPageOut"]>(albumQuery(albumId).queryKey);
  const bg = image(d?.album.coverImageId)?.urls.bg;
  return bg ? mediaUrl(bg) : null;
}

/** The cover, sharp: the cached grid variant at once, the large one over it when it has
 *  loaded (a fade; none at all when it is already there). */
function Picture({ low, high, seed }: { low: string | null; high: string | null; seed: string }) {
  return (
    <>
      {low ? <img src={low} alt="" className={css.pic} /> : <div className={css.blank} style={{ background: coverFill(seed) }} />}
      {high && high !== low && (
        <img src={high} alt="" className={`${css.pic} ${css.hi}`}
          ref={(el) => { if (el?.complete && el.naturalWidth) el.dataset.ready = ""; }}
          onLoad={(e) => { e.currentTarget.dataset.ready = ""; }} />
      )}
    </>
  );
}

/** The right page's colour field: the server's backdrop (already blurred and tamed) drawn
 *  into a tiny canvas and stretched, so only the cover's colours are left. */
function Paper({ url, tint, fadeIn }: { url: string | null; tint: string | null | undefined; fadeIn?: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!url) return;
    const im = new Image();
    im.src = url;
    let alive = true;
    void im.decode().then(() => {
      const c = cv.current, g = c?.getContext("2d");
      if (!alive || !c || !g) return;
      g.filter = "blur(3px)";
      g.drawImage(im, -4, -4, c.width + 8, c.height + 8);
      c.dataset.ready = "";
    }).catch(() => {});
    return () => { alive = false; };
  }, [url]);
  return (
    <div className={fadeIn ? `${css.paper} ${css.paperIn}` : css.paper} style={{ background: tint ?? "#15151b" }} aria-hidden>
      <canvas ref={cv} width={36} height={36} />
      <i />
    </div>
  );
}

/** The left page's text stands on the cover blurred and darkened under it, at the top and
 *  the bottom; the middle stays the sharp cover. */
function Bands({ url }: { url: string | null }) {
  return <div className={css.bands} aria-hidden>{url && <img src={url} alt="" />}<i /></div>;
}

/** The liner notes in the left page's top band: producers (links, as in the player), the
 *  label, the artist's other albums as a cover stack; a click turns the gatefold to that one. */
function Liner({ data, onArtist, onSwap, current }: {
  data: Schemas["AlbumPageOut"] | undefined; onArtist: (id: string) => void;
  onSwap: (id: string, thumb: HTMLImageElement | null, cover: string | null) => void; current: string;
}) {
  const qc = useQueryClient();
  const artistId = data?.album.albumArtist?.id;
  const a = useQuery({ ...artistQuery(artistId ?? ""), enabled: !!artistId });
  const more = (a.data?.albums ?? []).filter((x) => x.id !== current && x.coverImageId).slice(0, 6);
  const producers = data?.producers ?? [];
  if (!data || (!producers.length && !data.label && !more.length)) return <div className={css.liner} />;
  return (
    <div className={css.liner}>
      {producers.length > 0 && (
        <div className={css.cg}>
          <span>{producers.length > 1 ? "Продюсеры" : "Продюсер"}</span>
          <p>{producers.slice(0, 3).map((p, i) => (
            <span key={p.name}>{i > 0 && ", "}
              {p.artistId
                ? <button type="button" className={css.lnk} onClick={() => onArtist(p.artistId!)}>{p.name}</button>
                : <Link to="/search" search={{ q: p.name }} className={css.lnk}>{p.name}</Link>}
            </span>))}</p>
        </div>
      )}
      {data.label && <div className={css.cg}><span>Лейбл</span><p>{data.label}</p></div>}
      {more.length > 0 && (
        <div className={css.cg}>
          <span>Ещё у артиста</span>
          {/* the stack keeps the width it has when spread, so spreading never reflows the
              notes (a reflow moved it from under the pointer, and it shook) */}
          <div className={css.stack} style={{ width: more.length * 38 + (more.length - 1) * 4 }}>
            {more.map((m) => (
              <button type="button" key={m.id} title={`${m.title}${m.year ? ` · ${m.year}` : ""}`}
                onPointerEnter={() => { void qc.prefetchQuery(albumQuery(m.id)); preloadCover(m.coverImageId); }}
                onFocus={() => preloadCover(m.coverImageId)}
                onClick={(e) => onSwap(m.id, e.currentTarget.querySelector("img"), m.coverImageId)}>
                <img src={imageUrl(m.coverImageId, 96) ?? ""} alt="" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Rows({ tracks, plays, fav, current, playing, queued, onPlay, onQueue }: {
  tracks: Schemas["TrackOut"][]; plays: Record<string, number>; fav: string | null; current: string | null; playing: boolean;
  queued: Map<string, number>; onPlay: (i: number) => void; onQueue: (i: number, from: HTMLElement | null) => void;
}) {
  const discs = new Set(tracks.map((t) => t.discNo ?? 1)).size > 1;
  let disc: number | null = null;
  let k = 0;
  return (
    <>
      {tracks.map((t, i) => {
        const head = discs && (t.discNo ?? 1) !== disc ? (disc = t.discNo ?? 1) : null;
        const n = queued.get(t.id);
        const on = current === t.id;
        const feats = t.artists.slice(1).map((a) => a.name);
        return (
          <div key={t.id} className={css.slot}>
            {head != null && <div className={css.discHead} style={{ ["--i" as string]: Math.min(k++, 18) }}>Диск {head}</div>}
            <div role="button" tabIndex={0} className={css.row} data-on={on || undefined} data-playing={(on && playing) || undefined}
              style={{ ["--i" as string]: Math.min(k++, 18) }}
              onClick={() => onPlay(i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPlay(i); } }}>
              <span className={css.no}>
                <span className={css.n}>{t.trackNo ?? i + 1}</span>
                <span className={css.pg}><Icon name="Play" size={13} /></span>
                <span className={css.eq} aria-hidden><i /><i /><i /></span>
              </span>
              <span className={css.name}>{t.titleDisplay ?? t.title}{feats.length > 0 && <small> feat. {feats.join(", ")}</small>}</span>
              {fav === t.id
                ? <span className={css.fire} title={`Чаще всего: ${plays[t.id]} ${plural(plays[t.id] ?? 0, "раз", "раза", "раз")}`}><Icon name="Fire" size={15} /></span>
                : <span />}
              <span className={css.dur}>{clock(t.durationMs ?? 0)}</span>
              <button type="button" className={css.q} data-n={n} aria-label={n ? "Убрать из очереди" : "Играть следующим"}
                onClick={(e) => { e.stopPropagation(); onQueue(i, e.currentTarget.parentElement?.querySelector(`.${css.name}`) as HTMLElement | null); }}>
                <Icon name="QueueNext" size={16} />
                <span className={css.k}>{n}</span>
                <span className={css.tip}>{n ? "Убрать из очереди" : "Играть следующим"}</span>
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}

/** A queued track flies in an arc into the mini player's «next» button (across eased in-out,
 *  down lifted first and then falling: two axes, never one ramp); the button takes it with a
 *  bump and «Далее» pops above it. Without a mini player on the page nothing flies. */
function flyToNext(from: HTMLElement | null, item: QueueItem): void {
  const to = document.querySelector<HTMLElement>("[data-mini-next]");
  if (!from || !to) return;
  const cover = imageUrl(item.coverImageId, 96);
  const pill = (label: string | null, title: string) => {
    const el = document.createElement("div");
    el.className = css.pill!;
    if (cover) { const im = document.createElement("img"); im.src = cover; im.alt = ""; el.appendChild(im); }
    if (label) { const s = document.createElement("span"); s.textContent = label; el.appendChild(s); }
    const b = document.createElement("b"); b.textContent = title; el.appendChild(b);
    return el;
  };
  const land = () => {
    to.animate([{ transform: "scale(1)" }, { transform: "scale(1.28)" }, { transform: "scale(1)" }], { duration: 480, easing: SPRING });
    const s = usePlayer.getState(), next = s.queue[s.index + 1];
    document.querySelectorAll(`.${css.peek}`).forEach((n) => n.remove());
    const peek = pill("Далее", next?.title ?? item.title);
    peek.classList.add(css.peek!);
    document.body.appendChild(peek);
    const r = to.getBoundingClientRect(), w = peek.offsetWidth;
    Object.assign(peek.style, { left: `${Math.min(window.innerWidth - 16 - w, r.left + r.width / 2 - w / 2)}px`, top: `${r.top - peek.offsetHeight - 12}px` });
    peek.animate([{ transform: "translateY(10px) scale(.6)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: SPRING });
    setTimeout(() => peek.animate([{ opacity: 1 }, { transform: "scale(.9)", opacity: 0 }], { duration: 190, easing: "ease-in", fill: "forwards" }).finished.then(() => peek.remove(), () => peek.remove()), 2600);
  };
  if (reduced()) return land();
  const fly = pill(null, item.title);
  const wrap = document.createElement("div");
  wrap.className = css.flyWrap!;
  wrap.appendChild(fly);
  document.body.appendChild(wrap);
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const w = fly.offsetWidth, h = fly.offsetHeight;
  const x0 = a.left - 6, y0 = a.top + a.height / 2 - h / 2, x1 = b.left + b.width / 2 - w / 2, y1 = b.top + b.height / 2 - h / 2;
  wrap.style.transform = `translate(${x0}px, ${y0}px)`;
  wrap.animate([{ transform: `translate(${x0}px, ${y0}px)` }, { transform: `translate(${x1}px, ${y0}px)` }], { duration: 640, easing: "cubic-bezier(.45,0,.4,1)", fill: "forwards" });
  fly.animate([
    { transform: "translateY(0) scale(1)", opacity: 1, easing: "cubic-bezier(.2,.7,.3,1)" },
    { transform: "translateY(-26px) scale(1.04)", opacity: 1, offset: 0.26, easing: "cubic-bezier(.55,0,.85,.35)" },
    { transform: `translateY(${y1 - y0}px) scale(.42)`, opacity: 0.2 }], { duration: 640, fill: "forwards" })
    .finished.then(() => { wrap.remove(); land(); }, () => wrap.remove());
}
