/**
 * One continuous listen = exactly ONE listen event whose `playedMs` is the time actually
 * heard, not the playhead (the Android `ListenAccumulator`, itself v1's): position deltas
 * count only while playing and only when small — a seek or a gap in ticks is not listening.
 * The recommender must not tell a web listen from a native one.
 */
export type ContextType = "stream" | "album" | "playlist" | "search" | "artist" | "queue";

export interface ListenItem {
  trackId: string;
  durationMs: number | null;
  source: string | null;
  contextType: ContextType | null;
  contextId?: string | null;
  influence?: boolean;
}

export interface ListenEvent {
  clientEventId: string;
  sessionId: string;
  trackId: string;
  startedAt: string;
  playedMs: number;
  durationMs?: number;
  endReason: "completed" | "skipped" | "stopped" | "error";
  skippedEarly: boolean;
  interacted: boolean;
  influence: boolean;
  source?: string;
  contextType?: ContextType;
  contextId?: string;
}

/** Ticks come at ~4 Hz from `timeupdate`; a bigger step is a seek or a stall. */
export const MAX_STEP_MS = 2000;

export class ListenAccumulator {
  item: ListenItem | null = null;
  private startedAt = 0;
  private acc = 0;
  private last = 0;
  private duration: number | null = null;
  private touched = false;

  begin(i: ListenItem, positionMs: number, now = Date.now()): void {
    this.item = i;
    this.startedAt = now;
    this.acc = 0;
    this.last = positionMs;
    this.duration = i.durationMs;
    this.touched = false;
  }

  tick(positionMs: number, playing: boolean, durationMs?: number | null): void {
    const dt = positionMs - this.last;
    if (playing && dt > 0 && dt < MAX_STEP_MS) this.acc += dt;
    this.last = positionMs;
    if (durationMs && durationMs > 0 && Number.isFinite(durationMs)) this.duration = durationMs;
  }

  /** The track ran out: credit the tail between the last tick and the end. */
  completeToEnd(): void {
    if (!this.duration) return;
    const dt = this.duration - this.last;
    if (dt > 0 && dt < MAX_STEP_MS) this.acc += dt;
    this.last = this.duration;
  }

  /** Any control the listener touched: pause, seek, skip, огонёк/вода. */
  markInteracted(): void {
    if (this.item) this.touched = true;
  }

  get heardMs(): number {
    return this.acc;
  }

  /** Ends the listen; null under a second heard. `completed` at ≥ 90 % heard, `skipped`
   *  when the listener moved on, else `stopped`; early skip = < 30 s and < 30 %. */
  finish(skipped: boolean, sessionId: string, error = false): ListenEvent | null {
    const i = this.item;
    this.item = null;
    if (!i || this.acc < 1000) return null;
    const d = this.duration && this.duration > 0 ? this.duration : null;
    const endReason = error ? "error" : d !== null && this.acc >= 0.9 * d ? "completed" : skipped ? "skipped" : "stopped";
    const skippedEarly = skipped && this.acc < 30_000 && (d === null || this.acc / d < 0.3);
    return {
      clientEventId: crypto.randomUUID(),
      sessionId,
      trackId: i.trackId,
      startedAt: new Date(this.startedAt).toISOString(),
      playedMs: Math.round(this.acc),
      ...(d !== null ? { durationMs: Math.round(d) } : {}),
      endReason,
      skippedEarly,
      interacted: this.touched,
      influence: i.influence ?? true,
      ...(i.source ? { source: i.source } : {}),
      ...(i.contextType ? { contextType: i.contextType } : {}),
      ...(i.contextId ? { contextId: i.contextId } : {}),
    };
  }
}

/** The next track is preloaded once the current one passes half (spec §3). */
export function shouldPreload(positionMs: number, durationMs: number | null): boolean {
  return !!durationMs && durationMs > 0 && positionMs >= durationMs / 2;
}
