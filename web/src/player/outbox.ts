import { useAuth } from "../api/auth";
import { db } from "../api/db";
import type { ListenEvent } from "./listen";

/** Listens and reactions go through an IndexedDB outbox (the Android outbox): they survive
 *  a closed tab and a lost network, and each carries its client id, so a resend is a no-op
 *  on the server. Listens are batched; a closing page flushes with `keepalive`. */
export async function enqueueListen(e: ListenEvent): Promise<void> {
  await db.outbox.add({ kind: "listen", key: e.clientEventId, body: e, createdAt: Date.now() });
  schedule();
}

export async function enqueueSignal(trackId: string, kind: "fire" | "water", sessionId: string): Promise<string> {
  const clientEventId = crypto.randomUUID();
  await db.outbox.add({ kind: "signal", key: clientEventId, body: { trackId, kind, clientEventId, sessionId }, createdAt: Date.now() });
  return clientEventId;
}

let timer: ReturnType<typeof setTimeout> | undefined;
function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), 2000);
}

let flushing: Promise<void> | null = null;

async function send(path: string, body: unknown, keepalive: boolean): Promise<Response> {
  const token = useAuth.getState().access;
  return fetch(path, {
    method: "POST",
    keepalive,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

/** Sends everything queued. A 4xx other than 401 drops the row (it can never succeed);
 *  a network error or 5xx keeps it for the next flush. */
export function flush(keepalive = false): Promise<void> {
  flushing ??= (async () => {
    try {
      if (!useAuth.getState().access) return;
      const rows = await db.outbox.orderBy("id").toArray();
      const listens = rows.filter((r) => r.kind === "listen");
      for (let i = 0; i < listens.length; i += 100) {
        const chunk = listens.slice(i, i + 100);
        const r = await send("/api/v2/events/listens:batch", { events: chunk.map((c) => c.body) }, keepalive);
        if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429)) await db.outbox.bulkDelete(chunk.map((c) => c.id!));
        else return;
      }
      for (const s of rows.filter((r) => r.kind === "signal")) {
        const b = s.body as { trackId: string; kind: string; clientEventId: string; sessionId: string };
        const r = await send(`/api/v2/tracks/${b.trackId}/signals`, { kind: b.kind, clientEventId: b.clientEventId, sessionId: b.sessionId }, keepalive);
        if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429)) await db.outbox.delete(s.id!);
        else return;
      }
    } catch {
      /* offline: the rows wait for the next flush */
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

addEventListener("online", () => void flush());
addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void flush(true);
});
useAuth.subscribe((s, prev) => {
  if (s.access && !prev.access) void flush();
});
