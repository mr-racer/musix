import { useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type AlbumRow, type ArtistRow, db, rowToTrack, type TrackRow } from "../api/db";
import { fromTrack, player } from "../player/engine";
import { Cover } from "./Cover";
import { openAlbum } from "./Gatefold";
import { Icon } from "./icons";
import css from "./QuickSearch.module.css";

/** The home's search (design/code/screens/home.md): the library at once by default, from
 *  the device's own mirror, no network and no AI; the «ИИ» side of the switch hands the
 *  words to the assistant (today the search page's lyrics mode). The thumb of the switch
 *  springs between the two like the island's blob. «/» focuses it from anywhere. */

type Mode = "lib" | "ai";
type Hit =
  | { kind: "artist"; row: ArtistRow; n: number; cover: string | null }
  | { kind: "album"; row: AlbumRow; artist: string }
  | { kind: "track"; row: TrackRow }
  | { kind: "ai"; q: string };
const PH: Record<Mode, string> = { lib: "Артист, альбом или песня", ai: "Строчка, звучание, плейлист…" };
const SAYS = ["Найди песню, где поют про дождь и пустой город", "Что-нибудь похожее по звучанию", "Собери плейлист на вечер из спокойного"];

type Index = { tracks: TrackRow[]; artists: (ArtistRow & { n: number; cover: string | null })[]; albums: (AlbumRow & { artist: string })[] };
let index: Promise<Index> | null = null;
/** The mirror, read once per session (a few thousand rows) and searched in memory. */
function load(): Promise<Index> {
  index ??= (async () => {
    const [tracks, artists, albums] = await Promise.all([db.tracks.toArray(), db.artists.toArray(), db.albums.toArray()]);
    const count = new Map<string, { n: number; cover: string | null }>();
    const byAlbum = new Map<string, string>();
    for (const t of tracks) {
      for (const id of t.artistIds) {
        const c = count.get(id) ?? { n: 0, cover: null };
        c.n++; c.cover ??= t.coverImageId; count.set(id, c);
      }
      if (t.albumId && !byAlbum.has(t.albumId)) byAlbum.set(t.albumId, t.artist);
    }
    return {
      tracks,
      artists: artists.map((a) => ({ ...a, n: count.get(a.id)?.n ?? 0, cover: count.get(a.id)?.cover ?? a.imageId })).filter((a) => a.n > 0),
      albums: albums.map((a) => ({ ...a, artist: byAlbum.get(a.id) ?? "" })),
    };
  })();
  return index;
}
export function forgetIndex(): void { index = null; }

function mark(s: string, q: string) {
  const i = s.toLowerCase().indexOf(q);
  return i < 0 ? s : <>{s.slice(0, i)}<mark>{s.slice(i, i + q.length)}</mark>{s.slice(i + q.length)}</>;
}

export function QuickSearch({ className, edge }: { className?: string; edge?: boolean }) {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("lib");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [hits, setHits] = useState<Hit[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLSpanElement>(null);

  // the thumb under the chosen side
  useLayoutEffect(() => {
    const g = group.current, b = g?.querySelector<HTMLElement>(`[data-m="${mode}"]`), t = g?.querySelector<HTMLElement>("[data-thumb]");
    if (!b || !t) return;
    t.style.setProperty("--x", `${b.offsetLeft}px`);
    t.style.setProperty("--w", `${b.offsetWidth}px`);
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !/input|textarea/i.test((document.activeElement as HTMLElement)?.tagName ?? "")) { e.preventDefault(); input.current?.focus(); }
    };
    const onDown = (e: PointerEvent) => { if (!field.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, []);

  useEffect(() => {
    let dead = false;
    const words = q.trim(), lq = words.toLowerCase();
    if (mode === "ai") { setHits(words ? [{ kind: "ai", q: words }] : SAYS.map((s) => ({ kind: "ai", q: s }))); setSel(0); return; }
    if (!lq) { setHits([]); return; }
    void load().then((ix) => {
      if (dead) return;
      const out: Hit[] = [];
      for (const a of ix.artists) if (a.name.toLowerCase().includes(lq)) { out.push({ kind: "artist", row: a, n: a.n, cover: a.cover }); if (out.length >= 3) break; }
      let n = 0;
      for (const a of ix.albums) if (a.title.toLowerCase().includes(lq)) { out.push({ kind: "album", row: a, artist: a.artist }); if (++n >= 3) break; }
      n = 0;
      for (const t of ix.tracks) if (t.title.toLowerCase().includes(lq)) { out.push({ kind: "track", row: t }); if (++n >= 5) break; }
      out.push({ kind: "ai", q: words });
      setHits(out); setSel(0);
    });
    return () => { dead = true; };
  }, [q, mode]);

  const choose = (h: Hit | undefined, e?: React.MouseEvent) => {
    if (!h) return;
    setOpen(false); setQ(""); input.current?.blur();
    if (h.kind === "track") void player.playTracks([fromTrack(rowToTrack(h.row), "search")]);
    else if (h.kind === "artist") void nav({ to: "/artist/$id", params: { id: h.row.id } });
    else if (h.kind === "album") {
      if (e) openAlbum(e, h.row.id, h.row.coverImageId, (e.currentTarget as HTMLElement).querySelector("img"));
      else void nav({ to: "/album/$id", params: { id: h.row.id } });
    } else void nav({ to: "/search", search: { q: h.q, sections: "lyrics" } });
  };
  const shown = open && hits.length > 0;
  const n = (s: number) => `${s} ${s % 10 === 1 && s % 100 !== 11 ? "трек" : s % 10 >= 2 && s % 10 <= 4 && (s % 100 < 10 || s % 100 >= 20) ? "трека" : "треков"}`;

  return (
    <div ref={field} className={css.find + (className ? " " + className : "")} data-mode={mode} data-sky-edge={edge ? "find" : undefined}
      onClick={(e) => { if (e.target === e.currentTarget) input.current?.focus(); }}>
      <span ref={group} className={css.mode} role="radiogroup" aria-label="Где искать">
        <span className={css.thumb} data-thumb aria-hidden />
        {(["lib", "ai"] as const).map((m) => (
          <button key={m} type="button" role="radio" data-m={m} aria-checked={mode === m} className={css.side}
            onClick={() => { setMode(m); setOpen(true); input.current?.focus(); }}>
            <Icon name={m === "lib" ? "Search" : "Sparkles"} size={14} />{m === "lib" ? "Библиотека" : "ИИ"}
          </button>
        ))}
      </span>
      <input ref={input} id="home-find" value={q} placeholder={PH[mode]} autoComplete="off" spellCheck={false} aria-label="Поиск"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); choose(hits[sel]); }
          else if (e.key === "Escape") { setOpen(false); input.current?.blur(); }
        }} />
      <kbd className={css.kbd}>{mode === "ai" ? "⏎" : "/"}</kbd>
      {shown && (
        <div className={css.pop} role="listbox" aria-label="Найдено" onPointerDown={(e) => e.preventDefault() /* the field keeps the focus */}>
          {mode === "ai" && !q.trim() && <h4 className={css.h}>Спроси ассистента</h4>}
          {hits.map((h, i) => {
            const on = i === sel;
            if (h.kind === "ai" && mode === "ai" && !q.trim())
              return <button key={i} type="button" role="option" aria-selected={on} className={css.say} onClick={() => choose(h)}>{h.q}</button>;
            if (h.kind === "ai")
              return (
                <button key={i} type="button" role="option" aria-selected={on} className={css.hit + " " + css.ai} onClick={() => choose(h)}>
                  <span className={css.orbit}><Icon name="Sparkles" size={18} /></span>
                  <span><b>Спросить ассистента</b><small>«{h.q}»: по тексту, по звучанию, собрать плейлист</small></span>
                  <span className={css.k}>⏎</span>
                </button>
              );
            const prevKind = hits[i - 1]?.kind;
            const head = prevKind !== h.kind ? (h.kind === "artist" ? "Артисты" : h.kind === "album" ? "Альбомы" : "Треки") : null;
            return (
              <div key={i} className={css.group}>
                {head && <h4 className={css.h}>{head}</h4>}
                <button type="button" role="option" aria-selected={on} className={css.hit} onClick={(e) => choose(h, e)}>
                  {h.kind === "artist" && <Cover id={h.cover} size={40} radius={20} />}
                  {h.kind === "album" && <Cover id={h.row.coverImageId} size={40} radius={8} />}
                  {h.kind === "track" && <Cover id={h.row.coverImageId} size={40} radius={8} />}
                  <span>
                    <b>{mark(h.kind === "artist" ? h.row.name : h.row.title, q.trim().toLowerCase())}</b>
                    <small>{h.kind === "artist" ? n(h.n) : h.kind === "album" ? `${h.artist}${h.row.year ? ", " + h.row.year : ""}` : h.row.artist}</small>
                  </span>
                  <span className={css.k}>{h.kind === "artist" ? "артист" : h.kind === "album" ? "альбом" : "трек"}</span>
                </button>
              </div>
            );
          })}
          {mode === "lib" && q.trim() && hits.length === 1 && <p className={css.empty}>В библиотеке такого нет. Ассистент поищет по словам песни и по звучанию.</p>}
        </div>
      )}
    </div>
  );
}
