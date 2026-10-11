import { liveQuery, type Subscription } from "dexie";
import { useSyncExternalStore } from "react";
import { onAccountChange } from "../api/auth";
import { type AlbumRow, type ArtistRow, db, type TrackRow } from "../api/db";
import { warmFromMirror } from "../lib/images";

/** The library's slice of the mirror: one live query for the whole app, started by the first
 *  visit and kept. A page change photographs the new page's first render (lib/pageMotion.ts),
 *  so that render must already hold the wall; and the page must not read six thousand rows
 *  again on every visit, in the middle of the change (it cost a frame as the library came back
 *  from the player). The query runs again only when the mirror changes (a sync). */
export interface Mirror { tracks: TrackRow[]; albums: AlbumRow[]; artists: ArtistRow[] }
let last: Mirror | undefined;
let live: Subscription | null = null;
let first: Promise<Mirror> | null = null;
const subs = new Set<() => void>();

onAccountChange(() => {
  live?.unsubscribe();
  live = null; first = null; last = undefined;
  for (const f of subs) f();
});

async function read(): Promise<Mirror> {
  const [tracks, albums, artists] = await Promise.all([db.tracks.toArray(), db.albums.toArray(), db.artists.toArray()]);
  // the covers' urls and palettes come from the mirror: without this the wall stays blank
  // until some other screen has remembered them
  await warmFromMirror([...albums.map((a) => a.coverImageId), ...artists.map((a) => a.imageId), ...tracks.map((t) => t.coverImageId)]);
  return { tracks, albums, artists };
}

/** Starts the live query once; resolves with its first answer (the route's loader awaits it). */
export function mirrorReady(): Promise<Mirror> {
  if (last) return Promise.resolve(last);
  if (!first) {
    first = new Promise<Mirror>((resolve) => {
      live = liveQuery(read).subscribe({
        next: (m) => { last = m; resolve(m); for (const f of subs) f(); },
        error: () => { live = null; first = null; },
      });
    });
  }
  return first;
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function useMirror(): Mirror | undefined {
  if (!live) void mirrorReady();
  return useSyncExternalStore(subscribe, () => last);
}
