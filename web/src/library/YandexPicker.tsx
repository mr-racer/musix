import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ok } from "../api/client";
import { clock } from "../lib/format";
import { Icon } from "../ui/icons";
import css from "./yandexPicker.module.css";

/** Picking single songs inside a Yandex source (moved here from the old import page when the
 *  import became a window over the library, design/reference/settings): a search, «выбрать
 *  все/найденные», a virtual list with each song's fate here. */

export type Source = { source: unknown; title: string; trackCount: number; cover?: string | null; playlistId?: string | null; syncedAt?: string | null };
/** The server keeps every Yandex track's fate: here, new, failed on the network (tried again),
 *  refused by Yandex, or brought and then deleted here (can be picked again). */
type YState = "imported" | "new" | "failed" | "unavailable" | "removed";
export type YTrack = { id: string; title: string; artists: string[]; album?: string | null; durationMs?: number | null; cover?: string | null; available: boolean; imported: boolean; state: YState; reason?: string | null; trackId?: string | null; inPlaylist?: boolean };
/** What is picked in one source: the whole source, or some of its tracks. */
export type Pick = "all" | Set<string>;

const ROW = 56;
export const keyOf = (src: unknown) => (src === "likes" ? "likes" : String((src as { kind: number }).kind));
export const selectable = (t: YTrack) => t.available && !t.imported;
/** What a whole-source import (a top-up) fetches: new tracks and network failures only. */
export const topUpable = (t: YTrack) => t.available && (t.state === "new" || t.state === "failed");
export const tracksQuery = (key: string) => ({
  queryKey: ["ym-tracks", key],
  queryFn: () => ok(api.GET("/api/v2/imports/yandex/tracks", { params: { query: { source: key } } })) as Promise<YTrack[]>,
  staleTime: 5 * 60_000,
});

export function TrackPicker({ tracks, pick, selectableCount, onSet, onAll }: {
  tracks: YTrack[];
  pick: Pick | undefined;
  selectableCount: number;
  onSet: (ids: string[], on: boolean) => void;
  onAll: (on: boolean) => void;
}) {
  const [q, setQ] = useState("");
  // rows rise in only as the list opens: the virtualizer mounts rows while scrolling too
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setFresh(false), 700);
    return () => clearTimeout(t);
  }, []);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? tracks.filter((t) => `${t.title} ${t.artists.join(" ")} ${t.album ?? ""}`.toLowerCase().includes(needle)) : tracks;
  }, [tracks, q]);
  const box = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: shown.length, getScrollElement: () => box.current, estimateSize: () => ROW, overscan: 10 });
  const isOn = (t: YTrack) => selectable(t) && (pick === "all" || (pick instanceof Set && pick.has(t.id)));
  // while searching, the button acts on what was found, not on the whole source
  const searching = q.trim() !== "";
  const found = searching ? shown.filter(selectable) : [];
  const allOn = searching
    ? found.length > 0 && found.every(isOn)
    : selectableCount > 0 && (pick === "all" ? selectableCount : pick?.size ?? 0) >= selectableCount;

  return (
    <div className={css.picker}>
      <div className={css.tools}>
        <label className={css.search}>
          <Icon name="Search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти в плейлисте" aria-label="Найти в плейлисте" />
        </label>
        <button type="button" className={css.allBtn} disabled={searching ? !found.length : !selectableCount}
          onClick={() => (searching ? onSet(found.map((t) => t.id), !allOn) : onAll(!allOn))}>
          {searching ? (allOn ? "Снять найденные" : "Выбрать найденные") : allOn ? "Снять все" : "Выбрать все"}
        </button>
      </div>
      <div ref={box} className={css.list} data-fresh={fresh || undefined} style={{ height: Math.min(shown.length * ROW, 8 * ROW) || ROW }}>
        {!shown.length && <div className={css.empty}>Ничего не нашлось</div>}
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((r) => {
            const t = shown[r.index]!;
            const on = isOn(t);
            const can = selectable(t);
            return (
              <button key={t.id} type="button" disabled={!can} onClick={() => onSet([t.id], !on)}
                className={on ? css.trackOn : can ? css.track : css.trackOff}
                style={{ top: r.start, ["--i" as string]: Math.min(r.index, 12) }}>
                <span className={css.trackCheck}><Check state={on ? "all" : "none"} passive /></span>
                {t.cover ? <img className={css.cover} src={t.cover} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className={css.cover} />}
                <span className={css.text}>
                  <span className={css.trackTitle}>{t.title}</span>
                  <span className={css.trackSub}>{[t.artists.join(", "), t.album].filter(Boolean).join(" · ")}</span>
                </span>
                {t.imported ? <span className={css.tag}>уже здесь</span>
                  : !t.available || t.state === "unavailable" ? <span className={css.tagOff} title={t.reason ?? undefined}>недоступен</span>
                  : t.state === "failed" ? <span className={css.tagRetry} title={t.reason ?? undefined}>не скачался</span>
                  : t.state === "removed" ? <span className={css.tagOff}>удалён здесь</span> : null}
                <span className={css.time}>{t.durationMs ? clock(t.durationMs) : ""}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A checkbox with a mark that draws itself and a box that answers the press. `passive`:
 *  drawn inside a row that is itself the button. */
export function Check({ state, label, onChange, passive }: { state: "none" | "some" | "all"; label?: string; onChange?: () => void; passive?: boolean }) {
  const mark = (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path className={css.markAll} d="M5 10.5 8.5 14 15 6.5" />
      <path className={css.markSome} d="M6 10h8" />
    </svg>
  );
  if (passive) return <span className={css.check} data-state={state}>{mark}</span>;
  return (
    <button type="button" role="checkbox" aria-checked={state === "all" ? true : state === "some" ? "mixed" : false} aria-label={label}
      className={css.check} data-state={state} onClick={onChange}>
      {mark}
    </button>
  );
}
