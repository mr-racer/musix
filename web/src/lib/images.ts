import { mediaUrl, type Schemas } from "../api/client";
import { db } from "../api/db";

/** Image variants by id. Screens hand over the `images` maps their responses carry; the
 *  mirror fills in the rest. URLs are content-addressed and signed for a year. */
type Img = { urls: Record<string, string>; blurhash?: string | null; palette?: Schemas["ImageData"]["palette"] | null };
const known = new Map<string, Img>();

export function remember(images: Record<string, Schemas["ImageData"]> | undefined | null): void {
  if (!images) return;
  for (const [id, v] of Object.entries(images)) known.set(id, { urls: v.urls, blurhash: v.blurhash, palette: v.palette });
}

export function image(id: string | null | undefined): Img | undefined {
  return id ? known.get(id) : undefined;
}

/** The smallest variant at least `px` wide (the largest if none is). */
export function imageUrl(id: string | null | undefined, px: number): string | null {
  const img = image(id);
  if (!img) return null;
  const sizes = Object.keys(img.urls).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sizes.length) return null;
  const pick = sizes.find((s) => s >= px) ?? sizes.at(-1)!;
  return mediaUrl(img.urls[String(pick)]!);
}

export async function warmFromMirror(ids: (string | null | undefined)[]): Promise<void> {
  const need = [...new Set(ids.filter((i): i is string => !!i && !known.has(i)))];
  if (!need.length) return;
  for (const row of await db.images.bulkGet(need)) if (row) known.set(row.id, { urls: row.urls, blurhash: row.blurhash, palette: row.palette as Img["palette"] });
}
