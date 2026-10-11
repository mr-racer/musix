import { create } from "zustand";
import { db, rowToTrack, type TrackRow } from "../api/db";
import { fromTrack, player } from "../player/engine";
import { flyToMini } from "../player/MiniPlayer";
import type { ContextType } from "../player/listen";
import { useGatefold } from "../ui/Gatefold";

/** What the wall does: play an album, an artist, a group; open the gatefold; and the life of
 *  the film on never-heard albums, which the summary alone cannot know at once:
 *  - `heard`: albums started here since the summary was read (the film is gone for good);
 *  - `open`: albums unwrapped to look inside; when the gatefold closes and they are still
 *    unheard, they are wrapped again (the owner, 2026-10-11) and `rewrap` plays the move. */
export const useFilm = create<{ heard: Set<string>; open: Set<string>; rewrap: Set<string> }>(() => ({
  heard: new Set(), open: new Set(), rewrap: new Set(),
}));
const edit = (k: "heard" | "open" | "rewrap", id: string, on: boolean) =>
  useFilm.setState((s) => { const n = new Set(s[k]); if (on) n.add(id); else n.delete(id); return { [k]: n } as never; });

let watching: string | null = null;
useGatefold.subscribe((s, prev) => {
  const was = prev.open?.id;
  if (was && !s.open && was === watching) {
    watching = null;
    if (!useFilm.getState().heard.has(was)) {
      edit("open", was, false);
      edit("rewrap", was, true);
      setTimeout(() => edit("rewrap", was, false), 1400);
    }
  }
});

const order = (a: TrackRow, b: TrackRow) => (a.discNo ?? 0) - (b.discNo ?? 0) || (a.trackNo ?? 0) - (b.trackNo ?? 0) || a.sortTitle.localeCompare(b.sortTitle);
const shuffle = <T,>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
const items = (ts: TrackRow[], ctx: ContextType, id: string | null) => ts.map((t) => fromTrack(rowToTrack(t), ctx, id));

export async function playAlbum(id: string, from: HTMLElement | null): Promise<void> {
  const ts = (await db.tracks.where("albumId").equals(id).toArray()).sort(order);
  if (!ts.length) return;
  edit("heard", id, true);
  flyToMini(from);
  await player.playTracks(items(ts, "album", id), 0);
}

export async function playArtist(id: string, from: HTMLElement | null): Promise<void> {
  const ts = await db.tracks.where("artistIds").equals(id).toArray();
  if (!ts.length) return;
  flyToMini(from);
  await player.playTracks(items(shuffle(ts), "artist", id), 0);
}

/** A group of the wall: its albums' (or artists') songs, shuffled. */
export async function playGroup(albumIds: string[], artistIds: string[], from: HTMLElement | null): Promise<void> {
  const ts = albumIds.length ? await db.tracks.where("albumId").anyOf(albumIds).toArray() : await db.tracks.where("artistIds").anyOf(artistIds).toArray();
  if (!ts.length) return;
  for (const a of albumIds) edit("heard", a, true);
  flyToMini(from);
  await player.playTracks(items(shuffle([...new Map(ts.map((t) => [t.id, t])).values()]), "queue", null), 0);
}

/** Opens the gatefold from a cover; a sealed album is watched so its film comes back if it
 *  is closed unheard. */
export function openFrom(id: string, cover: string | null, el: Element | null, sealed: boolean): void {
  const r = el?.getBoundingClientRect();
  if (sealed) { edit("open", id, true); watching = id; }
  useGatefold.getState().show({ id, cover, from: r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null });
}
export const markOpen = (id: string) => edit("open", id, true);
