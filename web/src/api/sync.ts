import { api, ok, type Schemas } from "./client";
import { db, type TrackRow } from "./db";

/** Mirrors the account from `/sync` into IndexedDB — the Android SyncEngine's rules:
 *  - the first run pages a snapshot, then deltas by cursor; each page's rows and its cursor
 *    commit in one transaction, so a closed tab resumes exactly there;
 *  - a snapshot stamps a generation, and its last page sweeps rows of older generations
 *    (what the server deleted while this browser had no cursor); the cursor keeps a
 *    `snap:` mark until then, so a resume mid-snapshot never sweeps early;
 *  - a cursor the server refuses (400/422) restarts from a snapshot. */
type Change = Schemas["SyncPage"]["changes"][number];
type Page = Schemas["SyncPage"];
const SNAP = "snap:";

export type Fetch = (cursor: string | null, limit: number) => Promise<Page>;

const fetchPage: Fetch = (cursor, limit) =>
  ok(api.GET("/api/v2/sync", { params: { query: { ...(cursor ? { cursor } : {}), limit } } }));

export function sortKey(s: string): string {
  return s.toLowerCase().replace(/^[([\"'« ]+/, "").replace(/^the /, "");
}

function trackRow(t: Schemas["TrackOut"], gen: number): TrackRow {
  const title = t.titleDisplay ?? t.title;
  return {
    id: t.id,
    title,
    sortTitle: sortKey(title),
    artist: t.artistDisplay,
    artistIds: t.artists.map((a) => a.id),
    artists: t.artists.map((a) => ({ id: a.id, name: a.name })),
    albumId: t.albumId ?? null,
    album: t.album ?? null,
    year: t.year ?? null,
    genre: t.genre ?? null,
    durationMs: t.durationMs ?? 0,
    trackNo: t.trackNo ?? null,
    discNo: t.discNo ?? null,
    coverImageId: t.coverImageId ?? null,
    addedAt: Date.parse(t.addedAt),
    gen,
  };
}

async function apply(changes: Change[], gen: number): Promise<void> {
  const up = <E extends Change["entity"]>(e: E) =>
    changes.filter((c): c is Extract<Change, { entity: E }> => c.entity === e && c.op === "upsert" && c.data != null);
  const del = (e: Change["entity"]) => changes.filter((c) => c.entity === e && (c.op === "delete" || c.data == null)).map((c) => c.id);
  await db.images.bulkPut(up("image").map((c) => ({ id: c.data!.id, blurhash: c.data!.blurhash ?? null, urls: c.data!.urls, palette: c.data!.palette ?? null, gen })));
  await db.artists.bulkPut(up("artist").map((c) => ({ id: c.data!.id, name: c.data!.name, sortName: sortKey(c.data!.sortName ?? c.data!.name), imageId: c.data!.imageId ?? null, gen })));
  await db.albums.bulkPut(up("album").map((c) => ({ id: c.data!.id, title: c.data!.title, year: c.data!.year ?? null, albumArtistId: c.data!.albumArtistId ?? null, coverImageId: c.data!.coverImageId ?? null, gen })));
  await db.tracks.bulkPut(up("track").map((c) => trackRow(c.data!, gen)));
  await db.playlists.bulkPut(up("playlist").map((c) => ({ ...c.data!, itemCount: c.data!.itemCount ?? 0, gen })));
  await db.items.bulkPut(up("playlistItem").map((c) => ({ id: c.data!.itemId, playlistId: c.data!.playlistId, trackId: c.data!.trackId, position: c.data!.position, gen })));
  await db.signals.bulkPut(up("signalState").map((c) => ({ trackId: c.data!.trackId, kind: c.data!.kind, createdAt: c.data!.createdAt, gen })));
  const settings = up("settings").at(-1);
  if (settings) await db.kv.put({ key: "settings", value: settings.data!.value });
  await db.tracks.bulkDelete(del("track"));
  await db.artists.bulkDelete(del("artist"));
  await db.albums.bulkDelete(del("album"));
  await db.images.bulkDelete(del("image"));
  const gone = del("playlist");
  if (gone.length) await db.items.where("playlistId").anyOf(gone).delete();
  await db.playlists.bulkDelete(gone);
  await db.items.bulkDelete(del("playlistItem"));
  await db.signals.bulkDelete(del("signalState"));
}

async function sweep(gen: number): Promise<void> {
  for (const t of [db.tracks, db.artists, db.albums, db.images, db.playlists, db.items, db.signals] as const)
    await (t as typeof db.tracks).where("gen").below(gen).delete();
}

const kv = async <T>(key: string) => (await db.kv.get(key))?.value as T | undefined;

let running: Promise<{ pages: number; changes: number; full: boolean }> | null = null;

/** Serialized: a WS `sync.changed` during a run waits for it, then runs once more. */
export function sync(fetch: Fetch = fetchPage, limit = 1000): Promise<{ pages: number; changes: number; full: boolean }> {
  const run = async () => {
    let cursor = (await kv<string>("sync.cursor")) ?? null;
    let full = cursor === null || cursor.startsWith(SNAP);
    let gen = (await kv<number>("sync.gen")) ?? 0;
    if (cursor === null) await db.kv.put({ key: "sync.gen", value: ++gen });
    let pages = 0;
    let changes = 0;
    for (;;) {
      let page: Page;
      try {
        page = await fetch(cursor?.replace(SNAP, "") ?? null, limit);
      } catch (e) {
        const status = (e as { status?: number }).status;
        if ((status === 400 || status === 422) && cursor !== null) {
          await db.transaction("rw", db.kv, async () => {
            await db.kv.delete("sync.cursor");
            await db.kv.put({ key: "sync.gen", value: ++gen });
          });
          cursor = null;
          full = true;
          continue;
        }
        throw e;
      }
      const snapshotting = full && page.hasMore;
      const next = snapshotting ? SNAP + page.cursor : page.cursor;
      await db.transaction("rw", db.tables, async () => {
        await apply(page.changes, gen);
        if (full && !page.hasMore) await sweep(gen);
        await db.kv.put({ key: "sync.cursor", value: next });
      });
      pages++;
      changes += page.changes.length;
      cursor = next;
      if (!page.hasMore) break;
    }
    return { pages, changes, full };
  };
  const p = (running ?? Promise.resolve()).catch(() => undefined).then(run);
  running = p;
  void p.finally(() => {
    if (running === p) running = null;
  });
  return p;
}
