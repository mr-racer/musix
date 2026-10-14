import { create } from "zustand";
import { api, ok } from "../api/client";
import { subscribe } from "../api/realtime";
import { isAbort, uploadFile } from "../api/upload";

/** Everything coming into the library (design/reference/settings, round 2): files from the
 *  computer and the Yandex top-up. One row per song, one status at a time, in the order the
 *  server works (the owner: «чтобы не было такого, что несколько статусов одновременно»):
 *  в очереди → проверяю файл → отправляю → обрабатываю звук → собираю факты → готово; or
 *  «уже в библиотеке», or an error with a retry. The client knows the first three; the
 *  server's steps come from `GET /uploads?ids=` — asked when the mirror changes (`sync`) and
 *  every few seconds while a song is still on the server's side. It lives outside the page:
 *  leaving the library never stops an upload. */

export type Phase = "queue" | "hash" | "send" | "sound" | "facts" | "done" | "dupe" | "error";
export type Row = {
  key: number; name: string; hue: number; phase: Phase; p: number; speed: number;
  uploadId?: string; trackId?: string | null; err?: string; failedAt?: number; facts?: number; gone?: boolean;
};
type Sync = { job: string; done: number; total: number; finished: boolean };
type State = { rows: Row[]; sync: Sync | null; added: number; gulp: number };

export const useInbox = create<State>(() => ({ rows: [], sync: null, added: 0, gulp: 0 }));
const files = new Map<number, File>();
const aborts = new Map<number, AbortController>();
let seq = 0;

export const AUDIO = /\.(flac|mp3|m4a|aac|ogg|oga|opus|wav|aiff?|alac|wv|ape|mp4)$/i;
const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const edit = (key: number, patch: Partial<Row>) => useInbox.setState((s) => ({ rows: s.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
const row = (key: number) => useInbox.getState().rows.find((r) => r.key === key);

/** A song became playable here: the badge counts it and «+» gulps. */
function landed(n: number): void {
  useInbox.setState((s) => ({ added: s.added + n, gulp: s.gulp + 1 }));
}
export function seen(): void {
  useInbox.setState({ added: 0 });
}

export function addFiles(list: File[]): number {
  const ok = list.filter((f) => AUDIO.test(f.name));
  const rows: Row[] = ok.map((f) => {
    const key = ++seq;
    files.set(key, f);
    return { key, name: f.name, hue: hueOf(f.name), phase: "queue", p: 0, speed: 0 };
  });
  useInbox.setState((s) => ({ rows: [...s.rows, ...rows] }));
  pump();
  return ok.length;
}

/** Two files are hashed and sent at a time; the rest wait their turn. */
function pump(): void {
  const rows = useInbox.getState().rows.filter((r) => !r.gone);
  let busy = rows.filter((r) => r.phase === "hash" || r.phase === "send").length;
  for (const r of rows) {
    if (busy >= 2) break;
    if (r.phase !== "queue") continue;
    busy++;
    void send(r.key);
  }
}

async function send(key: number): Promise<void> {
  const f = files.get(key);
  if (!f) return;
  const ctl = new AbortController();
  aborts.set(key, ctl);
  edit(key, { phase: "hash", p: 0, err: undefined, failedAt: undefined });
  let last = 0;
  try {
    const out = await uploadFile(f, (s) => {
      const now = performance.now();
      if (now - last < 120 && s.p < 1) return; // a calm number, not a flicker
      last = now;
      edit(key, { phase: s.phase, p: s.p, speed: s.speed ?? row(key)?.speed ?? 0 });
    }, ctl.signal);
    if (out.kind === "dupe") {
      edit(key, { phase: "dupe", p: 1, trackId: out.trackId });
      files.delete(key);
    } else {
      edit(key, { phase: "sound", p: 1, uploadId: out.id });
      files.delete(key);
      follow();
    }
  } catch (e) {
    if (!isAbort(e)) edit(key, { phase: "error", failedAt: 0, err: (e as Error).message || "Не отправился" });
  } finally {
    aborts.delete(key);
    pump();
  }
}

export function cancel(key: number): void {
  aborts.get(key)?.abort();
  files.delete(key);
  edit(key, { gone: true });
  pump();
}

export function retry(key: number): void {
  const r = row(key);
  if (!r) return;
  if (files.has(key)) { edit(key, { phase: "queue", p: 0, err: undefined, failedAt: undefined }); pump(); }
  else edit(key, { gone: true }); // a server-side failure: the file must be chosen again
}

export function clearDone(): void {
  useInbox.setState((s) => ({ rows: s.rows.map((r) => (r.phase === "done" || r.phase === "dupe" ? { ...r, gone: true } : r)) }));
}

/* ── the server's steps ─────────────────────────────────────────────────── */
const ERR: Record<string, string> = { mismatch: "Файл пришёл с ошибкой — отправь ещё раз", unreadable: "Не прочитался: файл повреждён" };
let timer: ReturnType<typeof setTimeout> | undefined;
let asking = false;

async function poll(): Promise<void> {
  const want = useInbox.getState().rows.filter((r) => !r.gone && r.uploadId && (r.phase === "sound" || r.phase === "facts"));
  if (!want.length || asking) return;
  asking = true;
  try {
    const got = await ok(api.GET("/api/v2/uploads", { params: { query: { ids: want.map((r) => r.uploadId).join(",") } } }));
    let n = 0;
    for (const st of got) {
      const r = useInbox.getState().rows.find((x) => x.uploadId === st.id);
      if (!r) continue;
      const phase: Phase = st.stage === "send" ? "sound" : st.stage;
      if (phase === r.phase && st.trackId === r.trackId && st.facts === r.facts) continue;
      if (r.phase === "sound" && (phase === "facts" || phase === "done")) n++;
      edit(r.key, { phase, trackId: st.trackId ?? r.trackId, facts: st.facts, ...(phase === "error" ? { err: ERR[st.error ?? "unreadable"], failedAt: 1 } : {}) });
    }
    if (n) landed(n);
  } catch {
    /* the next turn asks again */
  } finally {
    asking = false;
  }
}

/** Asks now and keeps asking while anything is on the server's side: every 3 s while the sound
 *  is processed, every 8 s while only facts are awaited (they may wait for the AI for hours). */
function follow(delay = 600): void {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await poll();
    const rows = useInbox.getState().rows.filter((r) => !r.gone);
    if (rows.some((r) => r.phase === "sound")) follow(3000);
    else if (rows.some((r) => r.phase === "facts")) follow(8000);
  }, delay);
}
subscribe((e) => {
  if (e.type === "sync.changed") { if (useInbox.getState().rows.some((r) => !r.gone && (r.phase === "sound" || r.phase === "facts"))) follow(400); }
  const s = useInbox.getState().sync;
  if ((e.type === "job.progress" || e.type === "job.done") && s && e.job === s.job) {
    const done = e.done ?? s.done;
    if (done > s.done) landed(done - s.done);
    useInbox.setState({ sync: { ...s, done, total: e.total ?? s.total, finished: e.type === "job.done" } });
  }
});

/* ── the Yandex top-up shares the ring ──────────────────────────────────── */
export function trackSync(job: string, total: number): void {
  useInbox.setState({ sync: { job, done: 0, total, finished: false } });
}

/** The ring around «+»: everything coming in, a song counted once it can be played (sent and
 *  its sound processed); facts come later and never hold the ring. */
export function readiness(r: Row): number {
  switch (r.phase) {
    case "queue": return 0;
    case "hash": return 0.05 * r.p;
    case "send": return 0.05 + 0.6 * r.p;
    case "sound": return 0.65;
    default: return 1;
  }
}
export function ringOf(s: State): { p: number; busy: boolean } {
  const parts = s.rows.filter((r) => !r.gone).map(readiness);
  if (s.sync && !s.sync.finished) parts.push(s.sync.total ? s.sync.done / s.sync.total : 0);
  return { p: parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0, busy: parts.some((x) => x < 1) };
}
