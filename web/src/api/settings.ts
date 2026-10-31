import { api, ok } from "./client";
import { onAccountChange, useAuth } from "./auth";
import { db } from "./db";

export type Settings = {
  quality?: { wifi?: string; cellular?: string };
  /** `autoplay`: «Автоплейлист», a finished list or album goes on with similar songs */
  playback?: { normalize?: boolean; autoplay?: boolean };
  /** the city the home's sky follows; none means Istanbul (design/code/screens/home.md) */
  weather?: { place?: { name: string; country?: string | null; admin?: string | null; lat: number; lon: number; timezone?: string | null } | null };
  /** `precip`: snow and rain fall on the home (off: only the sky's colour stays) */
  home?: { precip?: boolean };
  /** `achievements`: the quiet «бульк» when an achievement arrives */
  sound?: { achievements?: boolean };
  /** «Слушать инкогнито»: listens inside [from, until) stay out of the history (the server drops them) */
  privacy?: { incognito?: { from: string; until: string } | null };
  [k: string]: unknown;
};

/** The incognito window's end while it is on, else null. */
export function incognitoUntil(s: Settings | undefined, now = Date.now()): number | null {
  const w = s?.privacy?.incognito;
  if (!w) return null;
  const a = Date.parse(w.from), b = Date.parse(w.until);
  return a <= now && now < b ? b : null;
}

/** The account's settings live in the mirror (synced); a change writes the whole value
 *  (PUT is a replace) and updates the mirror at once so the UI does not wait for /sync. */
export async function readSettings(): Promise<Settings> {
  return ((await db.kv.get("settings"))?.value as Settings | undefined) ?? {};
}

function changed(settings: Settings, path: string[], value: unknown): Settings {
  const cur = structuredClone(settings) as Record<string, unknown>;
  let o = cur;
  for (const k of path.slice(0, -1)) o = (o[k] = typeof o[k] === "object" && o[k] ? { ...(o[k] as object) } : {}) as Record<string, unknown>;
  o[path.at(-1)!] = value;
  return cur;
}

type Edit = { path: string[]; value: unknown; resolve: () => void; reject: (error: unknown) => void };
type Queue = { account: string; base: Settings; ready: Promise<void>; mirror: Promise<void>; edits: Edit[]; abort: AbortController };
let pending: Queue | null = null;

// A queued full PUT must never inherit a change that the preceding PUT failed to save.
// The mirror projects every pending edit; the server sees one edit at a time.
function project(q: Queue): Promise<void> {
  q.mirror = q.mirror.catch(() => undefined).then(() => db.transaction("rw", db.kv, async () => {
    if (pending !== q || useAuth.getState().accountId !== q.account) return;
    if ((await db.kv.get("account"))?.value !== q.account) return;
    const value = q.edits.reduce((s, e) => changed(s, e.path, e.value), q.base);
    await db.kv.put({ key: "settings", value });
  }));
  return q.mirror;
}

onAccountChange(() => {
  const q = pending;
  pending = null;
  if (!q) return;
  q.abort.abort();
  for (const edit of q.edits) edit.reject(new Error("The account changed before settings were saved"));
  q.edits = [];
});

async function save(q: Queue): Promise<void> {
  try {
    await q.ready;
    while (pending === q && q.edits.length) {
      await project(q);
      if (pending !== q) return;
      const edit = q.edits[0]!;
      const value = changed(q.base, edit.path, edit.value);
      let failed = false, error: unknown;
      try {
        await ok(api.PUT("/api/v2/settings", { body: { value }, signal: q.abort.signal }));
        if (pending === q) q.base = value;
      } catch (e) { failed = true; error = e; }
      if (pending !== q) return;
      q.edits.shift();
      try { await project(q); }
      catch (e) { edit.reject(e); throw e; }
      if (pending !== q) { edit.reject(new Error("The account changed before settings were saved")); return; }
      if (failed) edit.reject(error); else edit.resolve();
    }
  } catch (error) {
    for (const edit of q.edits) edit.reject(error);
  } finally {
    if (pending === q) pending = null;
  }
}

export function setSetting(path: string[], value: unknown): Promise<void> {
  const account = useAuth.getState().accountId;
  if (!account) return Promise.reject(new Error("Sign in before changing settings"));
  if (!pending) {
    const q: Queue = { account, base: {}, ready: Promise.resolve(), mirror: Promise.resolve(), edits: [], abort: new AbortController() };
    pending = q;
    q.ready = readSettings().then((s) => { q.base = s; });
    void save(q);
  }
  const q = pending;
  const result = new Promise<void>((resolve, reject) => q.edits.push({ path: [...path], value: structuredClone(value), resolve, reject }));
  // New clicks remain immediate even while the previous request is in flight.
  void q.ready.then(() => project(q)).catch(() => undefined);
  return result;
}
