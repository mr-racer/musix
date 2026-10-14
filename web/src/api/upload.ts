import { refresh, useAuth } from "./auth";
import { api, ok } from "./client";

/** Resumable upload (phase 1 §5.2): hash in a Worker, `POST /uploads` (content the server has
 *  is never sent again), then 8 MB `PATCH`es at `Upload-Offset`, each over XHR so the bytes'
 *  progress and speed are known as they go (the library's inbox shows them). A dropped
 *  connection resumes from the server's offset (`GET /uploads/{id}`). After the last byte the
 *  server's own steps are followed by `GET /uploads?ids=` (library/inbox.ts). */
const CHUNK = 8 * 1024 * 1024;

export type Sending = { phase: "hash" | "send"; p: number; speed?: number };
/** Where a file ended up on the client's side: already in the library, or with the server. */
export type Sent = { kind: "dupe"; trackId: string | null } | { kind: "server"; id: string };

class Aborted extends Error {}
export const isAbort = (e: unknown) => e instanceof Aborted || (e instanceof DOMException && e.name === "AbortError");

function sha256(file: File, on: (f: number) => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("../lib/hash.worker.ts", import.meta.url), { type: "module" });
    const stop = () => { w.terminate(); reject(new Aborted()); };
    signal.addEventListener("abort", stop, { once: true });
    w.onmessage = (e) => {
      if (e.data.progress !== undefined) on(e.data.progress);
      if (e.data.sha256) {
        w.terminate();
        signal.removeEventListener("abort", stop);
        resolve(e.data.sha256);
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message));
    };
    w.postMessage(file);
  });
}

type Reply = { status: number; body: { offset?: number; state?: string; detail?: string } };
function patch(id: string, offset: number, body: Blob, onBytes: (n: number) => void, signal: AbortSignal): Promise<Reply> {
  const once = () => new Promise<Reply>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PATCH", `/api/v2/uploads/${id}`);
    x.setRequestHeader("authorization", `Bearer ${useAuth.getState().access}`);
    x.setRequestHeader("upload-offset", String(offset));
    x.setRequestHeader("content-type", "application/offset+octet-stream");
    x.upload.onprogress = (e) => onBytes(e.loaded);
    x.onload = () => { let b = {}; try { b = JSON.parse(x.responseText); } catch { /* empty */ } resolve({ status: x.status, body: b }); };
    x.onerror = () => reject(new Error("network"));
    const stop = () => { x.abort(); reject(new Aborted()); };
    signal.addEventListener("abort", stop, { once: true });
    x.onloadend = () => signal.removeEventListener("abort", stop);
    x.send(body);
  });
  return once().then(async (r) => (r.status === 401 && (await refresh()) ? once() : r));
}

export async function uploadFile(file: File, on: (s: Sending) => void, signal: AbortSignal): Promise<Sent> {
  const sha = await sha256(file, (p) => on({ phase: "hash", p }), signal);
  const up = await ok(api.POST("/api/v2/uploads", { body: { sha256: sha, size: file.size, filename: file.name } }));
  if (up.exists && !up.id) return { kind: "dupe", trackId: up.trackId ?? null };
  const id = up.id!;
  if (up.exists) return { kind: "server", id }; // the server has the content: only registered here
  let offset = up.offset ?? 0;
  let retries = 0;
  // the speed over the last couple of seconds, so it does not jump with every progress event
  const marks: [number, number][] = [];
  const speed = (bytes: number) => {
    const now = performance.now();
    marks.push([now, bytes]);
    while (marks.length > 2 && now - marks[0]![0] > 2500) marks.shift();
    const [t0, b0] = marks[0]!;
    return now - t0 > 200 ? (bytes - b0) / ((now - t0) / 1000) / 1048576 : undefined;
  };
  while (offset < file.size) {
    if (signal.aborted) throw new Aborted();
    on({ phase: "send", p: offset / file.size, speed: speed(offset) });
    let r: Reply;
    try {
      const at = offset;
      r = await patch(id, offset, file.slice(offset, offset + CHUNK), (n) => on({ phase: "send", p: (at + n) / file.size, speed: speed(at + n) }), signal);
    } catch (e) {
      if (isAbort(e)) throw e;
      if (++retries > 5) throw new Error("Связь пропала — попробуй ещё раз");
      await new Promise((res) => setTimeout(res, 1000 * retries));
      offset = (await ok(api.GET("/api/v2/uploads/{upload_id}", { params: { path: { upload_id: id } } }))).offset ?? offset;
      continue;
    }
    if (r.status === 409) {
      // the server has a different offset (a resumed or raced upload): continue from it
      offset = (await ok(api.GET("/api/v2/uploads/{upload_id}", { params: { path: { upload_id: id } } }))).offset ?? offset;
      continue;
    }
    if (r.status < 200 || r.status >= 300) throw new Error(r.body.detail ?? `Сервер ответил ${r.status}`);
    offset = r.body.offset ?? offset;
    retries = 0;
    if (r.body.state === "verifying") break;
  }
  return { kind: "server", id };
}
