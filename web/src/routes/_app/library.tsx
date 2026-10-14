import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { statsQuery, summaryQuery } from "../../api/queries";
import { image } from "../../lib/images";
import { morph } from "../../lib/pageMotion";
import { usePlayer } from "../../player/engine";
import { Icon } from "../../ui/icons";
import { DayBand } from "../../library/DayBand";
import { Lists } from "../../library/Lists";
import { mirrorReady, useMirror } from "../../library/mirror";
import {
  ALBUM_SORTS, ARTIST_SORTS, type AlbumSort, type ArtistSort, albumCards, albumSections, artistCards, artistSections, type Lens,
} from "../../library/model";
import { SearchButton } from "../../library/Search";
import { Stats } from "../../library/Stats";
import { Wall } from "../../library/Wall";
import { AddMusic, DropPanel, useDrop } from "../../library/AddMusic";
import addCss from "../../library/add.module.css";
import yCss from "../../library/yandex.module.css";
import css from "../../library/library.module.css";
import glass from "../../ui/glass.module.css";

/** The library «Стена» and its statistics (design/code/screens/library.md; approved by the
 *  owner on 2026-10-11 after four rounds of the mock, design/reference/library). */

type Tab = "albums" | "artists" | "playlists" | "stats";
type View = "grid" | "rows";
const TABS: Tab[] = ["albums", "artists", "playlists", "stats"];

export const Route = createFileRoute("/_app/library")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab; sort?: string; view?: View; add?: "yandex" | "files" } => ({
    tab: TABS.includes(s.tab as Tab) ? (s.tab as Tab) : undefined,
    sort: typeof s.sort === "string" ? s.sort : undefined,
    view: s.view === "rows" ? "rows" : undefined,
    // «Добавить» opened from elsewhere (the settings' «Подключить», the old /import and /upload)
    add: s.add === "yandex" || s.add === "files" ? s.add : undefined,
  }),
  // the page's first render is what a page change shows (lib/pageMotion.ts), so the wall and its
  // order are read before it; the statistics are asked for here too, so the tab is ready when
  // it is opened (the owner: «может сразу запрашивать стату при заходе в библиотеку?»)
  loader: async ({ context }) => {
    const qc = context.queryClient;
    // what is already here is shown at once; the refreshes (a fetch and a parse each) wait until
    // the page change is over, so they never take its first frames
    setTimeout(() => { void qc.prefetchQuery(statsQuery); void qc.prefetchQuery(summaryQuery); }, 700);
    if (!qc.getQueryData(statsQuery.queryKey)) void qc.prefetchQuery(statsQuery);
    const summary = qc.ensureQueryData(summaryQuery).catch(() => undefined);
    await Promise.race([Promise.all([summary, mirrorReady()]), new Promise((r) => setTimeout(r, 600))]);
  },
  component: Library,
});

const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// the Yandex window is fetched when it is first opened (a rare visit), not with the wall
const YandexWindow = lazy(() => import("../../library/YandexWindow").then((m) => ({ default: m.YandexWindow })));
/** A mark placed for the first time appears where it belongs; after that it glides. */
function place(el: HTMLElement | null, props: Record<string, string>) {
  if (!el) return;
  const first = !el.dataset.placed;
  if (first) el.style.transition = "none";
  for (const k in props) el.style.setProperty(k, props[k]!);
  if (first) { void el.offsetWidth; el.style.transition = ""; el.dataset.placed = "1"; }
}

function Library() {
  const { tab = "albums", sort, view = "grid", add } = Route.useSearch();
  const nav = useNavigate({ from: "/library" });
  // the Yandex window and files dragged over the page take the library out of focus
  const [yandex, setYandex] = useState(add === "yandex");
  const [over, dropPanel] = useDrop(!yandex);
  useEffect(() => {
    if (add) void nav({ search: (s) => ({ ...s, add: undefined }), replace: true, resetScroll: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const root = document.documentElement;
    if (yandex || over) root.dataset.libFocus = "";
    else delete root.dataset.libFocus;
    return () => { delete root.dataset.libFocus; };
  }, [yandex, over]);
  const set = (p: { tab?: Tab; sort?: string; view?: View }) => void nav({ search: (s) => ({ ...s, ...p }), replace: true, resetScroll: false });
  const summary = useQuery({ ...summaryQuery, refetchOnMount: false }).data; // the loader refreshes it
  const mirror = useMirror();
  const [sealedOnly, setSealedOnly] = useState(false);
  const [searching, setSearching] = useState(false);
  // no browser scrollbar here: the rail of groups at the right is the page's scrollbar (the owner)
  useEffect(() => {
    document.documentElement.dataset.bare = "";
    return () => { delete document.documentElement.dataset.bare; };
  }, []);

  const albums = useMemo(() => (mirror ? albumCards(mirror.albums, mirror.tracks, new Map(mirror.artists.map((a) => [a.id, a])), summary) : []), [mirror, summary]);
  const artists = useMemo(() => (mirror ? artistCards(mirror.artists, mirror.tracks, mirror.albums, summary) : []), [mirror, summary]);
  const albumById = useMemo(() => new Map(albums.map((a) => [a.id, a])), [albums]);
  const clusters = useMemo(() => new Map((summary?.clusters ?? []).map((c) => [c.id, c.name])), [summary]);
  const [aSort, lens] = ((tab === "albums" ? sort : null) ?? "plays").split(":") as [AlbumSort, Lens | undefined];
  const rSort = ((tab === "artists" ? sort : null) ?? "plays") as ArtistSort;
  const sealedCount = albums.filter((a) => !a.plays).length;
  const albumSecs = useMemo(() => albumSections(sealedOnly ? albums.filter((a) => !a.plays) : albums, aSort, lens ?? "tags", clusters), [albums, aSort, lens, clusters, sealedOnly]);
  const artistSecs = useMemo(() => artistSections(artists, rSort), [artists, rSort]);
  const maxA = useMemo(() => Math.max(1, ...albums.map((a) => a.plays)), [albums]);
  const maxR = useMemo(() => Math.max(1, ...artists.map((a) => a.plays)), [artists]);

  // the rail and the marks wear the playing song's accent
  const cover = usePlayer((s) => s.queue[s.index]?.coverImageId);
  const acc = image(cover)?.palette?.accent.light ?? "#cfd0ff";

  const tabsEl = useRef<HTMLDivElement>(null), viewsEl = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const t = tabsEl.current?.querySelector<HTMLElement>("[aria-pressed='true']");
    if (t) place(tabsEl.current!.querySelector("[data-ul]"), { "--x": `${t.offsetLeft}px`, "--w": `${t.offsetWidth}px` });
    const v = viewsEl.current?.querySelector<HTMLElement>("[aria-pressed='true']");
    if (v) place(viewsEl.current!.querySelector("[data-thumb]"), { "--x": `${v.offsetLeft}px` });
  });

  const sortKeyNow = tab === "albums" ? (aSort === "genre" ? `genre:${lens ?? "tags"}` : aSort) : rSort;
  const sortName = (tab === "albums" ? ALBUM_SORTS : ARTIST_SORTS).find((s) => s[0] === sortKeyNow)?.[1] ?? "";
  // the new tab starts at the top: the router scrolls after the old one is photographed
  const changeTab = (t: Tab) => { if (t !== tab) void nav({ search: (s) => ({ ...s, tab: t, sort: undefined }), replace: true, resetScroll: true }); };
  const T: Record<Tab, [string, number | null]> = { albums: ["Альбомы", albums.length], artists: ["Артисты", artists.length], playlists: ["Плейлисты", null], stats: ["Статистика", null] };

  return (
    <div className={css.page} style={{ ["--acc" as string]: acc }}>
      <div className={css.bar} data-bar data-searching={searching ? "" : undefined}>
        <span className={css.ttl}>Библиотека</span>
        <div ref={tabsEl} className={css.tabs} data-tabs role="group" aria-label="Раздел">
          {TABS.map((t) => (
            <button key={t} type="button" className={css.tab} aria-pressed={t === tab} onClick={() => changeTab(t)}>
              {T[t][0]}{T[t][1] != null && <small>{T[t][1]}</small>}
            </button>
          ))}
          <span className={css.ul} data-ul />
        </div>
        <span className={css.grow} />
        <div className={css.tools}>
          {(tab === "albums" || tab === "artists") && (
            <SortPill name={sortName} options={tab === "albums" ? ALBUM_SORTS : ARTIST_SORTS} current={sortKeyNow}
              pick={(k) => void nav({ search: (s) => ({ ...s, sort: k === "plays" ? undefined : k }), replace: true, resetScroll: true })} />
          )}
          {tab === "albums" && (
            <button type="button" className={css.chip} data-tool aria-pressed={sealedOnly} title="Не распечатаны: альбомы, которые ты ещё не слушал"
              onClick={() => morph("regroup", () => { setSealedOnly((v) => !v); window.scrollTo(0, 0); })}>
              <span className={css.wrap} /><span className={css.chipLbl}>Не распечатаны</span><small>{sealedCount}</small>
            </button>
          )}
          {(tab === "albums" || tab === "artists") && (
            <div ref={viewsEl} className={css.views} data-tool role="group" aria-label="Вид">
              <span className={css.thumb} data-thumb />
              <button type="button" aria-pressed={view === "grid"} aria-label="Плиткой" onClick={() => set({ view: undefined })}><Icon name="Grid" size={16} /></button>
              <button type="button" aria-pressed={view === "rows"} aria-label="Строками" onClick={() => set({ view: "rows" })}><Icon name="List" size={16} /></button>
            </div>
          )}
          <SearchButton onSearching={setSearching} />
          <span className={addCss.wrap} data-tool><AddMusic onYandex={() => setYandex(true)} drop={over} startOpen={add === "files"} /></span>
        </div>
      </div>

      {tab === "albums" && (
        <Wall key={`a-${aSort}-${lens}-${sealedOnly}-${view}`} kind="album" sections={albumSecs} view={view} mx={maxA}
          top={!sealedOnly ? <DayBand pick={summary?.dayPick ?? null} albums={albumById} /> : null}
          otherOf={(a) => (aSort === "genre" && lens !== "sound" ? clusters.get(a.cluster ?? -1) ?? "—" : a.genre)} />
      )}
      {tab === "albums" && sealedOnly && !albumSecs.length && <p className={css.empty}>Всё распечатано: каждый альбом ты уже слушал.</p>}
      {tab === "artists" && <Wall key={`r-${rSort}-${view}`} kind="artist" sections={artistSecs} view={view} mx={maxR} />}
      {tab === "playlists" && <Lists />}
      {tab === "stats" && <Stats />}
      <div className={css.veil} aria-hidden />
      {yandex && <Suspense fallback={<div className={yCss.scrim} aria-hidden />}><YandexWindow onClose={() => setYandex(false)} /></Suspense>}
      {over && <><div className={yCss.scrimDrop} aria-hidden /><DropPanel panel={dropPanel} /></>}
    </div>
  );
}

function SortPill({ name, options, current, pick }: { name: string; options: [string, string, string][]; current: string; pick: (k: string) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const m = menu.current;
    if (!m) return;
    if (!reduce()) {
      m.animate([{ transform: "scale(.86)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: "cubic-bezier(.34,1.56,.64,1)" });
      [...m.children].forEach((b, i) => b.animate([{ transform: "translateY(-4px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 260, delay: 30 + i * 24, easing: "cubic-bezier(.22,.9,.3,1)", fill: "backwards" }));
    }
    const off = (e: PointerEvent) => { if (!m.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setAt(null); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAt(null);
    const gone = () => setAt(null);
    window.addEventListener("pointerdown", off); window.addEventListener("keydown", esc); window.addEventListener("scroll", gone, { passive: true });
    return () => { window.removeEventListener("pointerdown", off); window.removeEventListener("keydown", esc); window.removeEventListener("scroll", gone); };
  }, [at]);
  return (
    <>
      <button ref={btn} type="button" className={css.pill} data-tool aria-haspopup="menu" aria-expanded={!!at}
        onClick={() => { if (at) return setAt(null); const r = btn.current!.getBoundingClientRect(); setAt({ x: r.left, y: r.bottom + 8 }); }}>
        <Icon name="Bars" size={15} /><span>{name}</span><span className={css.chev}><Icon name="ChevronDown" size={16} /></span>
      </button>
      {at && (
        <div ref={menu} className={`${css.menuGlass} ${glass.lg}`} role="menu" style={{ left: Math.min(at.x, innerWidth - 280), top: at.y }}>
          {options.map(([k, n, d]) => (
            <button key={k} type="button" role="menuitemradio" aria-pressed={k === current} onClick={() => { setAt(null); pick(k); }}>
              <span className={css.nm}>{n}</span><small>{d}</small>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
