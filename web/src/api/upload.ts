import { refresh, useAuth } from "./auth";
import { api, ok } from "./client";

/** Resumable upload (phase 1 §5.2): hash in a Worker, `POST /uploads` (a known sha =
 *  instant, the server registers it), then 8 MB `PATCH`es at `Upload-Offset`. A dropped
 *  connection resumes from the server's offset (`GET /uploads/{id}`). */
const CHUNK = 8 * 1024 * 1024;

export type Progress = { phase: "hash" | "send" | "verify" | "done" | "error"; fraction: number; error?: string };

function sha256(file: File, on: (f: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("../lib/hash.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e) => {
      if (e.data.progress !== undefined) on(e.data.progress);
      if (e.data.sha256) {
        w.terminate();
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

async function patch(id: string, offset: number, body: Blob): Promise<Response> {
  const send = () =>
    fetch(`/api/v2/uploads/${id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${useAuth.getState().access}`, "upload-offset": String(offset), "content-type": "application/offset+octet-stream" },
      body,
    });
  const r = await send();
  return r.status === 401 && (await refresh()) ? send() : r;
}

export async function uploadFile(file: File, on: (p: Progress) => void): Promise<void> {
  const sha = await sha256(file, (f) => on({ phase: "hash", fraction: f }));
  let up = await ok(api.POST("/api/v2/uploads", { body: { sha256: sha, size: file.size, filename: file.name } }));
  if (up.exists || !up.id) return on({ phase: "done", fraction: 1 });
  const id = up.id;
  let offset = up.offset ?? 0;
  let retries = 0;
  while (offset < file.size) {
    on({ phase: "send", fraction: offset / file.size });
    let r: Response;
    try {
      r = await patch(id, offset, file.slice(offset, offset + CHUNK));
    } catch {
      if (++retries > 5) throw new Error("связь пропала");
      await new Promise((res) => setTimeout(res, 1000 * retries));
      offset = (await ok(api.GET("/api/v2/uploads/{upload_id}", { params: { path: { upload_id: id } } }))).offset ?? offset;
      continue;
    }
    if (r.status === 409) {
      // the server has a different offset (a resumed or raced upload): continue from it
      offset = (await ok(api.GET("/api/v2/uploads/{upload_id}", { params: { path: { upload_id: id } } }))).offset ?? offset;
      continue;
    }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `HTTP ${r.status}`);
    const out = (await r.json()) as { offset: number; state: string };
    offset = out.offset;
    retries = 0;
    if (out.state === "verifying") break;
  }
  on({ phase: "verify", fraction: 1 });
}
