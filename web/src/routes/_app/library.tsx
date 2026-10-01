import { useQuery } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { db, type AlbumRow, type ArtistRow, type TrackRow } from "../../api/db";
import { createPlaylist } from "../../api/playlists";
import { summaryQuery } from "../../api/queries";
import { sortKey } from "../../api/sync";
import { clock, num, plural } from "../../lib/format";
import { warmFromMirror } from "../../lib/images";
import { useLive } from "../../lib/live";
import { player, type QueueItem } from "../../player/engine";
import { AlbumCard } from "../../ui/AlbumCard";
import { Cover } from "../../ui/Cover";
import { Icon } from "../../ui/icons";
import css from "./library.module.css";

type Tab = "albums" | "artists" | "tracks" | "playlists";
type Sort = "az" | "year" | "plays" | "added";

export const Route = createFileRoute("/_app/library")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab; sort?: Sort } => ({
    tab: ["albums", "artists", "tracks", "playlists"].includes(s.tab as string) ? (s.tab as Tab) : undefined,
    sort: ["az", "year", "plays", "added"].includes(s.sort as string) ? (s.sort as Sort) : undefined,
  }),
  component: Library,
});

export interface AlbumCard { id: string; title: string; year: number | null; artist: string; coverImageId: string | null; tracks: number; addedAt: number }

/** Built from the mirror in one pass: albums with their track count, artist and newest add. */
async function albumCards(): Promise<AlbumCard[]> {
  const [albums, artists, tracks] = await Promise.all([db.albums.toArray(), db.artists.toArray(), db.tracks.toArray()]);
  const names = new Map(artists.map((a: ArtistRow) => [a.id, a.name]));
  const per = new Map<string, { n: number; added: number; artist: string }>();
  for (const t of tracks as TrackRow[]) {
    if (!t.albumId) continue;
    const e = per.get(t.albumId) ?? { n: 0, added: 0, artist: t.artist };
    e.n++;
    e.added = Math.max(e.added, t.addedAt);
    per.set(t.albumId, e);
  }
  return (albums as AlbumRow[])
    .filter((a) => per.has(a.id))
    .map((a) => ({ id: a.id, title: a.title, year: a.year, artist: (a.albumArtistId && names.get(a.albumArtistId)) || per.get(a.id)!.artist, coverImageId: a.coverImageId, tracks: per.get(a.id)!.n, addedAt: per.get(a.id)!.added }));
}

/** v1's library (golden library-albums), in the home/player language: the summary readout,
 *  a filter, the section switch, and a virtualized list from the local mirror (no request). */
function Library() {
  const { tab = "albums", sort = "az" } = Route.useSearch();
  const nav = useNavigate({ from: "/library" });
  const [filter, setFilter] = useState("");
  const counts = useLive(async () => ({ tracks: await db.tracks.count(), albums: await db.albums.count(), artists: await db.artists.count(), playlists: await db.playlists.count() }), [], undefined);
  const summary = useQuery(summaryQuery).data;
  const syncing = counts?.tracks === 0;

  return (
    <div className={css.page}>
      <div className={css.readout}>
        {counts && !syncing ? (
          <>
            <b>{num(counts.tracks)}</b> {plural(counts.tracks, "трек", "трека", "треков")} · <b>{num(counts.albums)}</b> {plural(counts.albums, "альбом", "альбома", "альбомов")} · <b>{num(counts.artists)}</b> {plural(counts.artists, "артист", "артиста", "артистов")}
            {summary && <> · <b>{summary.genres.length}</b> {plural(summary.genres.length, "жанр", "жанра", "жанров")}</>}
          </>
        ) : "Собираю библиотеку…"}
      </div>
      <label className={css.filter}>
        <Icon name="Search" size={16} />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Поиск: песня, альбом или исполнитель" aria-label="Фильтр библиотеки" />
      </label>
      <div className={css.bar}>
        <div className={css.tabs} role="tablist">
          {([["albums", "Альбомы", "Grid"], ["artists", "Артисты", "Star"], ["tracks", "Треки", "List"], ["playlists", "Плейлисты", "Lyrics"]] as const).map(([t, label, icon]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? css.tabOn : css.tab} onClick={() => void nav({ search: (p) => ({ ...p, tab: t }) })}>
              <Icon name={icon} size={15} /> {label}
              {counts && <span className={css.count}>{num({ albums: counts.albums, artists: counts.artists, tracks: counts.tracks, playlists: counts.playlists }[t])}</span>}
            </button>
          ))}
        </div>
        {(tab === "albums" || tab === "tracks") && (
          <div className={css.sorts} role="radiogroup" aria-label="Сортировка">
            {([["az", "А–Я"], ["year", "год"], ["plays", "слушаю чаще"], ["added", "новые"]] as const)
              .filter(([s]) => tab === "albums" || s !== "plays")
              .map(([s, label]) => (
                <button key={s} type="button" role="radio" aria-checked={sort === s} className={sort === s ? css.sortOn : css.sort} onClick={() => void nav({ search: (p) => ({ ...p, sort: s }) })}>{label}</button>
              ))}
          </div>
        )}
      </div>
      {tab === "albums" && <Albums filter={filter} sort={sort} plays={summary?.albumPlays as Record<string, number> | undefined} />}
      {tab === "artists" && <Artists filter={filter} />}
      {tab === "tracks" && <Tracks filter={filter} sort={sort} />}
      {tab === "playlists" && <Playlists filter={filter} />}
    </div>
  );
}

function useColumns(ref: React.RefObject<HTMLDivElement | null>, min: number, gap: number): number {
  const [cols, setCols] = useState(5);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCols(Math.max(2, Math.floor((e!.contentRect.width + gap) / (min + gap)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, min, gap]);
  return cols;
}

function Albums({ filter, sort, plays }: { filter: string; sort: Sort; plays?: Record<string, number> }) {
  const all = useLive(albumCards, [], []) ?? [];
  const f = sortKey(filter.trim());
  const list = useMemo(() => {
    const hit = f ? all.filter((a) => sortKey(a.title).includes(f) || sortKey(a.artist).includes(f)) : all;
    const by: Record<Sort, (a: AlbumCard, b: AlbumCard) => number> = {
      az: (a, b) => sortKey(a.title).localeCompare(sortKey(b.title), "ru"),
      year: (a, b) => (b.year ?? 0) - (a.year ?? 0),
      plays: (a, b) => (plays?.[b.id] ?? 0) - (plays?.[a.id] ?? 0),
      added: (a, b) => b.addedAt - a.addedAt,
    };
    return [...hit].sort(by[sort]);
  }, [all, f, sort, plays]);
  const box = useRef<HTMLDivElement>(null);
  const cols = useColumns(box, 170, 22);
  const rows = Math.ceil(list.length / cols);
  const v = useWindowVirtualizer({ count: rows, estimateSize: () => 250, overscan: 3, scrollMargin: box.current?.offsetTop ?? 0 });
  useEffect(() => {
    const vis = v.getVirtualItems();
    void warmFromMirror(vis.flatMap((r) => list.slice(r.index * cols, r.index * cols + cols).map((a) => a.coverImageId)));
  });
  return (
    <div ref={box} className={css.virtual} style={{ ["--h" as string]: `${v.getTotalSize()}px` }}>
      {v.getVirtualItems().map((r) => (
        <div key={r.key} className={css.gridRow} data-index={r.index} ref={v.measureElement}
          style={{ ["--y" as string]: `${r.start - (v.options.scrollMargin ?? 0)}px`, ["--cols" as string]: String(cols) }}>
          {list.slice(r.index * cols, r.index * cols + cols).map((a) => (
            <AlbumCard key={a.id} id={a.id} coverImageId={a.coverImageId} title={a.title} badge={`${a.tracks} тр`}
              sub={[a.artist, a.year].filter(Boolean).join(" · ")} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Artists({ filter }: { filter: string }) {
  const all = useLive(async () => {
    const [artists, tracks] = await Promise.all([db.artists.toArray(), db.tracks.toArray()]);
    const n = new Map<string, number>();
    for (const t of tracks) for (const id of t.artistIds) n.set(id, (n.get(id) ?? 0) + 1);
    return artists.filter((a) => n.has(a.id)).map((a) => ({ ...a, tracks: n.get(a.id)! })).sort((a, b) => a.sortName.localeCompare(b.sortName, "ru"));
  }, [], []) ?? [];
  const f = sortKey(filter.trim());
  const list = f ? all.filter((a) => a.sortName.includes(f)) : all;
  const box = useRef<HTMLDivElement>(null);
  const cols = useColumns(box, 130, 22);
  const rows = Math.ceil(list.length / cols);
  const v = useWindowVirtualizer({ count: rows, estimateSize: () => 180, overscan: 3, scrollMargin: box.current?.offsetTop ?? 0 });
  useEffect(() => {
    void warmFromMirror(v.getVirtualItems().flatMap((r) => list.slice(r.index * cols, r.index * cols + cols).map((a) => a.imageId)));
  });
  return (
    <div ref={box} className={css.virtual} style={{ ["--h" as string]: `${v.getTotalSize()}px` }}>
      {v.getVirtualItems().map((r) => (
        <div key={r.key} className={css.gridRow} data-index={r.index} ref={v.measureElement}
          style={{ ["--y" as string]: `${r.start - (v.options.scrollMargin ?? 0)}px`, ["--cols" as string]: String(cols) }}>
          {list.slice(r.index * cols, r.index * cols + cols).map((a) => (
            <Link key={a.id} to="/artist/$id" params={{ id: a.id }} className={css.artist}>
              <Cover id={a.imageId} size={120} radius={60} />
              <span className={css.albumTitle}>{a.name}</span>
              <span className={css.albumSub}>{a.tracks} {plural(a.tracks, "трек", "трека", "треков")}</span>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

function Tracks({ filter, sort }: { filter: string; sort: Sort }) {
  const all = useLive(() => db.tracks.orderBy("sortTitle").toArray(), [], []) ?? [];
  const f = sortKey(filter.trim());
  const list = useMemo(() => {
    const hit = f ? all.filter((t) => t.sortTitle.includes(f) || sortKey(t.artist).includes(f) || sortKey(t.album ?? "").includes(f)) : all;
    if (sort === "year") return [...hit].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    if (sort === "added") return [...hit].sort((a, b) => b.addedAt - a.addedAt);
    return hit;
  }, [all, f, sort]);
  const box = useRef<HTMLDivElement>(null);
  const v = useWindowVirtualizer({ count: list.length, estimateSize: () => 54, overscan: 12, scrollMargin: box.current?.offsetTop ?? 0 });
  useEffect(() => {
    void warmFromMirror(v.getVirtualItems().map((r) => list[r.index]?.coverImageId));
  });
  const play = (i: number) => {
    const from = Math.max(0, i - 0);
    const items: QueueItem[] = list.slice(from, from + 200).map((t) => ({ trackId: t.id, title: t.title, artist: t.artist, artistId: t.artistIds[0] ?? null, album: t.album, albumId: t.albumId, coverImageId: t.coverImageId, durationMs: t.durationMs, source: "manual", contextType: "queue" }));
    void player.playTracks(items, 0);
  };
  return (
    <div ref={box} className={css.virtual} style={{ ["--h" as string]: `${v.getTotalSize()}px` }}>
      {v.getVirtualItems().map((r) => {
        const t = list[r.index]!;
        return (
          <button key={t.id} type="button" className={css.trackRow} onClick={() => play(r.index)} style={{ ["--y" as string]: `${r.start - (v.options.scrollMargin ?? 0)}px` }}>
            <Cover id={t.coverImageId} size={40} radius={6} />
            <span className={css.trackText}>
              <span className={css.trackTitle}>{t.title}</span>
              <span className={css.trackSub}>{t.artist}</span>
            </span>
            <span className={css.trackAlbum}>{t.album}</span>
            <span className={css.trackTime}>{clock(t.durationMs)}</span>
          </button>
        );
      })}
    </div>
  );
}

function Playlists({ filter }: { filter: string }) {
  const lists = useLive(() => db.playlists.toArray(), [], []) ?? [];
  const covers = useLive(async () => {
    const items = await db.items.toArray();
    const tracks = new Map((await db.tracks.bulkGet([...new Set(items.map((i) => i.trackId))])).filter(Boolean).map((t) => [t!.id, t!.coverImageId]));
    const by = new Map<string, string[]>();
    for (const it of items.sort((a, b) => (a.position < b.position ? -1 : 1))) {
      const c = tracks.get(it.trackId);
      if (!c) continue;
      const arr = by.get(it.playlistId) ?? [];
      if (arr.length < 4 && !arr.includes(c)) arr.push(c);
      by.set(it.playlistId, arr);
    }
    await warmFromMirror([...by.values()].flat());
    return by;
  }, [], new Map<string, string[]>());
  const nav = useNavigate();
  const [name, setName] = useState("");
  const f = sortKey(filter.trim());
  const shown = (f ? lists.filter((p) => sortKey(p.name).includes(f)) : lists).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className={css.playlists}>
      <form className={css.newList} onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; const id = await createPlaylist(name.trim()); setName(""); void nav({ to: "/playlist/$id", params: { id } }); }}>
        <span className={css.plus}><Icon name="Plus" size={22} /></span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Новый плейлист" aria-label="Название нового плейлиста" />
      </form>
      {shown.map((p) => (
        <Link key={p.id} to="/playlist/$id" params={{ id: p.id }} className={css.playlist}>
          <span className={css.mosaic}>
            {(covers?.get(p.id) ?? []).slice(0, 4).map((c: string) => <Cover key={c} id={c} size={80} radius={0} />)}
          </span>
          <span className={css.albumTitle}>{p.name}</span>
          <span className={css.albumSub}>{p.itemCount} {plural(p.itemCount, "трек", "трека", "треков")}</span>
        </Link>
      ))}
    </div>
  );
}
