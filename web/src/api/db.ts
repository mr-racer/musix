import Dexie, { type Table } from "dexie";

/** The local mirror of `/sync` (spec §1): the library renders from here on revisit, with
 *  no request. One database per browser profile; its owner is recorded and a different
 *  account wipes it first (as the Android AccountGuard). */
export interface TrackRow {
  id: string;
  title: string;
  sortTitle: string;
  artist: string;
  artistIds: string[];
  artists: { id: string; name: string }[];
  albumId: string | null;
  album: string | null;
  year: number | null;
  genre: string | null;
  durationMs: number;
  trackNo: number | null;
  discNo: number | null;
  coverImageId: string | null;
  addedAt: number;
  gen: number;
}
export interface ArtistRow { id: string; name: string; sortName: string; imageId: string | null; gen: number }
export interface AlbumRow { id: string; title: string; year: number | null; albumArtistId: string | null; coverImageId: string | null; gen: number }
export interface ImageRow { id: string; blurhash: string | null; urls: Record<string, string>; palette: unknown; gen: number }
export interface PlaylistRow { id: string; name: string; itemCount: number; updatedAt: string; gen: number; [k: string]: unknown }
export interface ItemRow { id: string; playlistId: string; trackId: string; position: string; gen: number }
export interface SignalRow { trackId: string; kind: "fire" | "water"; createdAt: string; gen: number }
export interface KvRow { key: string; value: unknown }
export interface OutboxRow { id?: number; kind: string; key: string; body: unknown; createdAt: number }

export class MusixDb extends Dexie {
  tracks!: Table<TrackRow, string>;
  artists!: Table<ArtistRow, string>;
  albums!: Table<AlbumRow, string>;
  images!: Table<ImageRow, string>;
  playlists!: Table<PlaylistRow, string>;
  items!: Table<ItemRow, string>;
  signals!: Table<SignalRow, string>;
  kv!: Table<KvRow, string>;
  outbox!: Table<OutboxRow, number>;

  constructor(name = "musix") {
    super(name);
    this.version(1).stores({
      tracks: "id, sortTitle, albumId, *artistIds, addedAt, gen",
      artists: "id, sortName, gen",
      albums: "id, title, year, albumArtistId, gen",
      images: "id, gen",
      playlists: "id, gen",
      items: "id, playlistId, [playlistId+position], gen",
      signals: "trackId, gen",
      kv: "key",
      outbox: "++id, kind",
    });
  }

  async wipe(): Promise<void> {
    await this.transaction("rw", this.tables, async () => {
      for (const t of this.tables) await t.clear();
    });
  }
}

export const db = new MusixDb();

/** Called on every sign-in/out: a different account (or none) leaves nothing behind. */
export async function guard(accountId: string | null): Promise<void> {
  const owner = (await db.kv.get("account"))?.value as string | undefined;
  if (owner === accountId) return;
  await db.wipe();
  if (accountId) await db.kv.put({ key: "account", value: accountId });
}

/** A mirror row in the API's track shape, for components shared with API screens. */
export function rowToTrack(t: TrackRow): import("./client").Schemas["TrackOut"] {
  return {
    id: t.id, title: t.title, titleDisplay: null, artistDisplay: t.artist, artists: t.artists.map((a) => ({ ...a, role: "primary" })),
    albumId: t.albumId, album: t.album, year: t.year, genre: t.genre, trackNo: t.trackNo, discNo: t.discNo,
    durationMs: t.durationMs, coverImageId: t.coverImageId, addedAt: new Date(t.addedAt).toISOString(),
  };
}
