import { api, ok } from "./client";
import { db } from "./db";

export type Settings = {
  quality?: { wifi?: string; cellular?: string };
  playback?: { normalize?: boolean };
  /** the city the home's sky follows; none means Istanbul (design/code/screens/home.md) */
  weather?: { place?: { name: string; country?: string | null; admin?: string | null; lat: number; lon: number } | null };
  [k: string]: unknown;
};

/** The account's settings live in the mirror (synced); a change writes the whole value
 *  (PUT is a replace) and updates the mirror at once so the UI does not wait for /sync. */
export async function readSettings(): Promise<Settings> {
  return ((await db.kv.get("settings"))?.value as Settings | undefined) ?? {};
}

export async function setSetting(path: string[], value: unknown): Promise<void> {
  const cur = structuredClone(await readSettings()) as Record<string, unknown>;
  let o = cur;
  for (const k of path.slice(0, -1)) o = (o[k] = typeof o[k] === "object" && o[k] ? { ...(o[k] as object) } : {}) as Record<string, unknown>;
  o[path.at(-1)!] = value;
  await db.kv.put({ key: "settings", value: cur });
  await ok(api.PUT("/api/v2/settings", { body: { value: cur } }));
}
