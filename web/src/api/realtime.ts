import { refresh, useAuth } from "./auth";

/** One WebSocket for the whole app (spec §1). It authenticates with the in-memory access
 *  token, re-sends a fresh one after each refresh, and reconnects with backoff and the last
 *  seen `seq` so the server can say "sync" for whatever was missed. */
export type Event =
  | { type: "ready"; seq: number }
  | { type: "sync.changed"; seq: number; cursor: string }
  | { type: "job.progress" | "job.done"; job: string; done?: number; total?: number }
  | { type: "instance.status"; status: { llm?: string } }
  | { type: "device.presence"; deviceId: string; online: boolean }
  | { type: "playback.state"; device: string; trackId: string | null; playing: boolean; positionMs: number }
  | { type: "playback.take"; play: boolean; by: string }
  | { type: "playback.release"; to: string }
  | { type: "playback.command"; command: "play" | "pause" | "toggle" | "next" | "prev" | "seek" | "signal"; positionMs?: number; kind?: "fire" | "water"; by: string }
  | { type: "error"; for: string; detail: string }
  | { type: "ping" };

type Handler = (e: Event) => void;
const handlers = new Set<Handler>();
let ws: WebSocket | null = null;
let lastSeq: number | null = null;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let wanted = false;

export function subscribe(fn: Handler): () => void {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

function open(): void {
  const token = useAuth.getState().access;
  if (!wanted || !token) return;
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/v2/ws`;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => sock.send(JSON.stringify({ type: "auth", token, lastSeq }));
  sock.onmessage = (m) => {
    const e = JSON.parse(String(m.data)) as Event;
    if (e.type === "ready") retry = 0;
    if (e.type === "ready" || e.type === "sync.changed") lastSeq = Math.max(lastSeq ?? 0, e.seq);
    for (const h of handlers) h(e);
  };
  sock.onclose = (c) => {
    if (ws !== sock) return;
    ws = null;
    if (!wanted) return;
    const again = () => {
      timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
    };
    if (c.code === 4401) void refresh().then((ok) => ok && again());
    else again();
  };
}

/** A message to the server over the open socket (dropped while it reconnects: the handoff
 *  publishes its state again on `ready`). */
export function send(msg: Record<string, unknown>): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export function connect(): void {
  wanted = true;
  if (!ws) open();
}

export function disconnect(): void {
  wanted = false;
  clearTimeout(timer);
  ws?.close();
  ws = null;
  lastSeq = null;
}

// a refreshed access token goes to the open socket, so it is not dropped at expiry
useAuth.subscribe((s, prev) => {
  if (s.access && s.access !== prev.access && ws?.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: "auth", token: s.access }));
});
