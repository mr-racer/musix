import { liveQuery } from "dexie";
import { type AlbumRow, type ArtistRow, db, type TrackRow } from "../api/db";
import { onAccountChange, useAuth } from "../api/auth";
import { onSyncComplete } from "../api/sync";
import { warmFromMirror } from "./images";

export type Index = { tracks: TrackRow[]; artists: (ArtistRow & { n: number; cover: string | null })[]; albums: (AlbumRow & { artist: string })[] };
let index: Promise<Index> | null = null;
let revision = 0;
let snapshotMarker: string | null = null;
let account = useAuth.getState().accountId;
const listeners = new Set<() => void>();
export const searchIndexRevision = () => revision;
export const subscribeSearchIndex = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export function forgetIndex(): void {
  index = null;
  snapshotMarker = null;
  revision++;
  for (const fn of listeners) fn();
}
const offAccount = onAccountChange((next) => { account = next; forgetIndex(); });
const offSync = onSyncComplete(({ changes, full }) => { if (changes || full) forgetIndex(); });

const readMarker = async () => {
  const [owner, cursor] = await db.kv.bulkGet(["account", "sync.cursor"]);
  return JSON.stringify([owner?.value ?? null, cursor?.value ?? null]);
};
// The cursor commits with the rows. Watching two keys catches another tab's sync
// without rereading any library table until a search actually needs its new index.
const mirror = liveQuery(readMarker).subscribe((marker) => {
  if (snapshotMarker !== null && snapshotMarker !== marker) forgetIndex();
});
if (import.meta.hot) import.meta.hot.dispose(() => { mirror.unsubscribe(); offAccount(); offSync(); });

/** One consistent mirror snapshot, shared by both searches until sync or account change. */
export function loadSearchIndex(): Promise<Index> {
  if (index) return index;
  const current = revision, owner = account;
  const request = (async () => {
    const [tracks, artists, albums, storedOwner, cursor] = await db.transaction("r", [db.tracks, db.artists, db.albums, db.kv], () =>
      Promise.all([db.tracks.toArray(), db.artists.toArray(), db.albums.toArray(), db.kv.get("account"), db.kv.get("sync.cursor")]));
    const stale = () => current !== revision || !owner || owner !== account || storedOwner?.value !== owner;
    if (stale()) throw new DOMException("Search snapshot changed", "AbortError");
    const marker = JSON.stringify([storedOwner?.value ?? null, cursor?.value ?? null]);
    snapshotMarker = marker;
    // the hits' covers come from the mirror, not from whichever screen happened to remember them
    await warmFromMirror([...tracks.map((t) => t.coverImageId), ...artists.map((a) => a.imageId), ...albums.map((a) => a.coverImageId)]);
    if (stale()) throw new DOMException("Search snapshot changed", "AbortError");
    if (await readMarker() !== marker) {
      if (current === revision) forgetIndex();
      throw new DOMException("Search snapshot changed", "AbortError");
    }
    if (stale()) throw new DOMException("Search snapshot changed", "AbortError");
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
  index = request;
  void request.catch(() => { if (index === request) index = null; });
  return request;
}
