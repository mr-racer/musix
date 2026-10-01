import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { albumQuery } from "../api/queries";
import { clock, plural } from "../lib/format";
import { image, imageUrl } from "../lib/images";
import { fromTrack, player } from "../player/engine";
import { AddToPlaylist } from "./AddToPlaylist";
import { Cover } from "./Cover";
import css from "./Gatefold.module.css";
import { Icon } from "./icons";

type Rect = { top: number; left: number; width: number; height: number };
type Open = { id: string; cover: string | null; from: Rect | null };

/** v1's album gatefold: the open album is UI state, not a route. A plain click on an album
 *  card opens it in place; `/album/$id` stays the deep link and the new-tab target. */
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

function Gatefold({ id, cover, from, onClose }: Open & { onClose: () => void }) {
  const q = useQuery(albumQuery(id));
  const nav = useNavigate();
  const stage = useRef<HTMLDivElement>(null);
  const atOrigin = useRef<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [hover, setHover] = useState(-1);
  const [adding, setAdding] = useState<string[] | null>(null);
  const [allFeat, setAllFeat] = useState(false);
  const coverId = q.data?.album.coverImageId ?? cover;
  const pal = image(coverId)?.palette;

  // shared-element fly-in (FLIP): from the clicked grid cover to the centre, while it flips
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el || !from || reduced()) return;
    const end = el.getBoundingClientRect();
    if (!end.width || !end.height) return;
    const t = `translate(${from.left + from.width / 2 - (end.left + end.width / 2)}px, ${from.top + from.height / 2 - (end.top + end.height / 2)}px) scale(${from.width / end.width}, ${from.height / end.height})`;
    atOrigin.current = t;
    el.style.transform = t;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = "transform 0.7s cubic-bezier(.3,.75,.25,1)";
      el.style.transform = "none";
    }));
  }, [from]);

  // the close plays it backwards: the reverse flip and the flight home
  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    const el = stage.current;
    if (el && atOrigin.current && !reduced()) {
      el.style.transition = "transform 0.45s cubic-bezier(.55,.06,.5,.9)";
      el.style.transform = atOrigin.current;
    }
    setTimeout(onClose, 460);
  }, [closing, onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", esc); };
  }, [close]);

  const album = q.data?.album;
  const tracks = q.data?.tracks ?? [];
  const items = tracks.map((t) => fromTrack(t, "album", id));
  const play = (i: number) => { void player.playTracks(items, i); close(); };
  const artistId = album?.albumArtist?.id;
  const feats = [...new Map(tracks.flatMap((t) => t.artists).filter((a) => a.id !== artistId).map((a) => [a.id, a])).values()];
  const shownFeats = allFeat ? feats : feats.slice(0, 6);
  const toArtist = (aid: string) => { close(); void nav({ to: "/artist/$id", params: { id: aid } }); };
  const total = tracks.reduce((s, t) => s + (t.durationMs ?? 0), 0);
  const label = `radial-gradient(circle at 38% 32%, ${pal?.vibrant ?? "oklch(62% 0.16 285)"}, ${pal?.accent.dark ?? "oklch(45% 0.16 300)"} 70%)`;
  const front = imageUrl(coverId, 400);  // the grid's variant: already cached, so the sleeve paints mid-flight
  const blur = imageUrl(coverId, 320);

  return (
    <div className={closing ? css.overlayOut : css.overlay} onClick={close}>
      <div ref={stage} className={css.stage} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label={album?.title ?? "Альбом"}>
        <div className={closing ? css.flipClosing : css.flip}>
          <div className={css.face}>
            {front ? <img src={front} alt="" className={css.frontImg} /> : <div className={css.frontBlank} />}
            <div className={css.sheen} aria-hidden />
          </div>

          <div className={`${css.face} ${css.back}`}>
            {blur && <img src={blur} alt="" aria-hidden className={css.backBlur} />}
            <div className={css.backShade} aria-hidden />
            <div className={css.backBody}>
              <div className={css.rise} style={{ ["--d" as string]: "0.45s" }}>
                <div className={css.hero}>
                  <div className={css.sleeve}>
                    <div className={css.vinyl}><span className={css.vinylLabel} style={{ background: label }} /></div>
                    <div className={css.sleeveCover}><Cover id={coverId} size={132} radius={12} eager /></div>
                  </div>
                  <div className={css.heroText}>
                    <div className={css.kicker}>Альбом</div>
                    <div className={css.title}>{album?.title ?? ""}</div>
                    {album?.albumArtist && (
                      <button type="button" className={css.artistPill} onClick={() => toArtist(album.albumArtist!.id)} title="Открыть страницу артиста">
                        {album.albumArtist.name} <span aria-hidden>→</span>
                      </button>
                    )}
                    {feats.length > 0 && (
                      <div className={css.feats}>
                        {shownFeats.map((f) => <button type="button" key={f.id} className={css.feat} onClick={() => toArtist(f.id)}>{f.name}</button>)}
                        {feats.length > shownFeats.length && <button type="button" className={css.featMore} onClick={() => setAllFeat(true)}>+{feats.length - shownFeats.length} ещё</button>}
                      </div>
                    )}
                    {album && (
                      <div className={css.meta}>
                        {[album.year ?? "—", `${tracks.length} ${plural(tracks.length, "трек", "трека", "треков")}`, clock(total)].map((x, i) => (
                          <span key={i}>{i > 0 && <span aria-hidden className={css.dot}>·</span>}{x}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="button" className={css.x} onClick={close} aria-label="Закрыть"><Icon name="Close" size={15} /></button>
                </div>
              </div>

              <div className={css.rise} style={{ ["--d" as string]: "0.55s" }}>
                <div className={css.actions}>
                  <button type="button" className={css.playAll} onClick={() => play(0)} disabled={!tracks.length}><Icon name="Play" size={13} /> Играть всё</button>
                  <button type="button" className={css.ghost} onClick={() => { void player.playTracks([...items].sort(() => Math.random() - 0.5)); close(); }} disabled={!tracks.length}><Icon name="Shuffle" size={13} /> Вперемешку</button>
                  <span className={css.addWrap}>
                    <button type="button" className={css.ghost} onClick={() => setAdding((a) => (a ? null : tracks.map((t) => t.id)))} disabled={!tracks.length}><Icon name="Plus" size={13} /> В плейлист</button>
                    {adding && adding.length > 1 && <AddToPlaylist trackIds={adding} onDone={() => setAdding(null)} />}
                  </span>
                </div>
              </div>

              <div className={css.list}>
                {tracks.map((t, i) => (
                  <div key={t.id} className={css.row} style={{ ["--i" as string]: Math.min(i, 20) }}
                    onClick={() => play(i)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)}>
                    <span className={css.no}>{hover === i ? "▶" : t.trackNo ?? i + 1}</span>
                    <span className={css.name}>
                      {t.titleDisplay ?? t.title}
                      {t.artists.length > 1 && <span className={css.featIn}> feat. {t.artists.slice(1).map((a) => a.name).join(", ")}</span>}
                    </span>
                    <span className={css.dur}>{clock(t.durationMs ?? 0)}</span>
                    <button type="button" className={css.rowBtn} title="Играть следующим" onClick={(e) => { e.stopPropagation(); player.playNext([items[i]!]); }}><Icon name="QueueNext" size={15} /></button>
                    <span className={css.addWrap}>
                      <button type="button" className={css.rowBtn} title="Добавить в плейлист" onClick={(e) => { e.stopPropagation(); setAdding((a) => (a?.[0] === t.id && a.length === 1 ? null : [t.id])); }}><Icon name="Plus" size={15} /></button>
                      {adding?.length === 1 && adding[0] === t.id && <span onClick={(e) => e.stopPropagation()}><AddToPlaylist trackIds={adding} onDone={() => setAdding(null)} /></span>}
                    </span>
                  </div>
                ))}
                {q.isError && <div className={css.err}>Не удалось открыть альбом</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
