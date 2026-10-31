import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type AlbumRow, type ArtistRow, rowToTrack, type TrackRow } from "../api/db";
import { statsQuery } from "../api/queries";
import { fromTrack, player } from "../player/engine";
import { useSearchIndex } from "../lib/useSearchIndex";
import { Cover } from "./Cover";
import { openAlbum, useGatefold } from "./Gatefold";
import { Icon } from "./icons";
import css from "./QuickSearch.module.css";

/** The home's search (design/code/screens/home.md): the library at once by default, from
 *  the device's own mirror, no network and no AI; the «ИИ» side of the switch hands the
 *  words to the assistant page, which asks them at once. The thumb of the switch
 *  springs between the two like the island's blob. «/» focuses it from anywhere. */

type Mode = "lib" | "ai";
type Hit =
  | { kind: "artist"; row: ArtistRow; n: number; cover: string | null }
  | { kind: "album"; row: AlbumRow; artist: string }
  | { kind: "track"; row: TrackRow }
  | { kind: "ai"; q: string };
const PH: Record<Mode, string> = { lib: "Артист, альбом или песня", ai: "Строчка, звучание, плейлист…" };
/** The examples under an empty «ИИ» field speak of this library (the owner, 2026-10-25): the
 *  decade most of it is from, the artist played most; without stats, plain ones. */
const decadeRu = (d: number) => (d % 100 === 0 ? "нулевых" : `${d % 100}-х`);
function says(decade: number | undefined, artist: string | undefined): string[] {
  return [
    decade ? `Собери плейлист хитов ${decadeRu(decade)}` : "Собери плейлист хитов",
    artist ? `Что-нибудь похожее на ${artist}` : "Что-нибудь похожее по звучанию",
    "Собери плейлист на вечер из спокойного",
  ];
}

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
  const ix = useSearchIndex(mode === "lib" && !!q.trim());
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

  // the stats are asked for only once the «ИИ» side is chosen
  const st = useQuery({ ...statsQuery, enabled: mode === "ai" }).data;
  const decs = st?.collection?.decades ?? [];
  const decade = decs.length ? decs.reduce((a, b) => (b.count > a.count ? b : a)).decade : undefined;
  const fav = st?.listening.topArtist?.artist.name;
  const SAYS = says(decade, fav);

  const hits = useMemo<Hit[]>(() => {
    const words = q.trim(), lq = words.toLowerCase();
    if (mode === "ai") return words ? [{ kind: "ai", q: words }] : SAYS.map((s) => ({ kind: "ai", q: s }));
    if (!lq || !ix) return [];
    const out: Hit[] = [];
    for (const a of ix.artists) if (a.name.toLowerCase().includes(lq)) { out.push({ kind: "artist", row: a, n: a.n, cover: a.cover }); if (out.length >= 3) break; }
    let n = 0;
    for (const a of ix.albums) if (a.title.toLowerCase().includes(lq)) { out.push({ kind: "album", row: a, artist: a.artist }); if (++n >= 3) break; }
    n = 0;
    for (const t of ix.tracks) if (t.title.toLowerCase().includes(lq)) { out.push({ kind: "track", row: t }); if (++n >= 5) break; }
    out.push({ kind: "ai", q: words });
    return out;
  }, [q, mode, ix, SAYS.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSel(0); }, [hits]);

  const choose = (h: Hit | undefined, e?: React.MouseEvent) => {
    if (!h) return;
    setOpen(false); setQ(""); input.current?.blur();
    if (h.kind === "track") void player.playTracks([fromTrack(rowToTrack(h.row), "search")]);
    else if (h.kind === "artist") void nav({ to: "/artist/$id", params: { id: h.row.id } });
    else if (h.kind === "album") {
      if (e) openAlbum(e, h.row.id, h.row.coverImageId, (e.currentTarget as HTMLElement).querySelector("img"));
      else useGatefold.getState().show({ id: h.row.id, cover: h.row.coverImageId, from: null });
    } else void nav({ to: "/assistant", search: { q: h.q } });
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
      <input ref={input} id="home-find" data-hotkey-search value={q} placeholder={PH[mode]} autoComplete="off" spellCheck={false} aria-label="Поиск"
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
