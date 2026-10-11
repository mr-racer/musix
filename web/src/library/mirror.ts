import { onAccountChange } from "../api/auth";
import { type AlbumRow, type ArtistRow, db, type TrackRow } from "../api/db";
import { warmFromMirror } from "../lib/images";

/** The library's slice of the mirror, kept between visits. A page change photographs the new
 *  page's first render (lib/pageMotion.ts), so that render must already hold the wall: the
 *  route's loader reads it before the change, the page's live query refreshes it after. */
export interface Mirror { tracks: TrackRow[]; albums: AlbumRow[]; artists: ArtistRow[] }
let last: Mirror | undefined;
onAccountChange(() => { last = undefined; });

export const lastMirror = (): Mirror | undefined => last;

export async function readMirror(): Promise<Mirror> {
  const [tracks, albums, artists] = await Promise.all([db.tracks.toArray(), db.albums.toArray(), db.artists.toArray()]);
  // the covers' urls and palettes come from the mirror: without this the wall stays blank
  // until some other screen has remembered them
  await warmFromMirror([...albums.map((a) => a.coverImageId), ...artists.map((a) => a.imageId), ...tracks.map((t) => t.coverImageId)]);
  return (last = { tracks, albums, artists });
}
