import { create } from "zustand";
import { onAccountChange } from "../api/auth";
import { api, mediaUrl, ok, type Schemas } from "../api/client";
import { db } from "../api/db";
import { imageUrl, remember } from "../lib/images";
import { ListenAccumulator, shouldPreload, type ContextType } from "./listen";
import { enqueueListen, enqueueSignal, flush } from "./outbox";
import { sessionId } from "./session";

/**
 * The browser player (spec §3). One store, two `<audio>` elements: the current one and a
 * preloader that takes the next track once the current passes half, so a boundary is a
 * swap, not a fetch (v1 prefetched whole tracks into memory blobs instead).
 *
 * - Sources: `POST /playback/manifest` for the current + next five, cached until 60 s
 *   before their signature expires. A media error re-resolves once, then walks the
 *   item's fallbacks, then gives up on the track (an `error` listen) and moves on.
 * - «Поток» (`/stream/next`) keeps ≥ 2 upcoming; a reaction or a skip drops the tail the
 *   server planned before it and refills (the Android QueuePolicy). A list tops up from
 *   `/stream/autoplay` when its last track starts.
 * - Normalization: desktop routes both elements through a GainNode (the context is
 *   created in the first play gesture). Mobile browsers never get an AudioContext — a
 *   suspended one is silence (the v1 lesson) — only element-volume attenuation.
 */
export interface QueueItem {
  trackId: string;
  title: string;
  artist: string;
  artistId?: string | null;
  album?: string | null;
  albumId?: string | null;
  coverImageId?: string | null;
  durationMs?: number | null;
  source?: string | null; // «Поток»'s pool label, else "manual"
  reason?: string | null;
  contextType: ContextType;
  contextId?: string | null;
}

export interface PlayerState {
  queue: QueueItem[];
  index: number;
  mode: "list" | "stream";
  playing: boolean;
  buffering: boolean;
  positionMs: number;
  durationMs: number;
  tier: string | null;
  codec: string | null;
  gainDb: number | null;
  taste: { kind: "fire" | "water"; locked: boolean } | null;
  error: string | null;
}

const initial: PlayerState = {
  queue: [], index: -1, mode: "list", playing: false, buffering: false, positionMs: 0, durationMs: 0,
  tier: null, codec: null, gainDb: null, taste: null, error: null,
};
export const usePlayer = create<PlayerState>(() => initial);
const set = usePlayer.setState;
const get = usePlayer.getState;

type Manifest = Schemas["ManifestItem"];
const STREAM_REFILL_BELOW = 2;
const STREAM_CHUNK = 3;
const HISTORY_KEEP = 20;
const AHEAD = 5;

function readVolume(): number {
  try {
    const v = Number(localStorage.getItem("musix.volume") ?? "1");
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  } catch {
    return 1;
  }
}

export const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

function network(): "wifi" | "cellular" {
  const c = (navigator as Navigator & { connection?: { type?: string; effectiveType?: string } }).connection;
  if (c?.type === "cellular") return "cellular";
  if (c?.type === undefined && c?.effectiveType && c.effectiveType !== "4g") return "cellular";
  return "wifi";
}

async function normalizeOn(): Promise<boolean> {
  const s = (await db.kv.get("settings"))?.value as { playback?: { normalize?: boolean } } | undefined;
  return s?.playback?.normalize ?? true;
}

class Engine {
  private els: [HTMLAudioElement, HTMLAudioElement];
  private cur = 0;
  private held: { trackId: string; url: string } | null = null; // what the idle element preloaded
  private manifests = new Map<string, { m: Manifest; source: number }>();
  private acc = new ListenAccumulator();
  private attempts = 0;
  private ctx: AudioContext | null = null;
  private gains: GainNode[] = [];
  private refilling = false;
  private toppedUpFrom: string | null = null;
  private played: string[] = [];
  private lastPosUpdate = 0;
  private userVolume = readVolume();

  constructor() {
    this.els = [this.make(0), this.make(1)];
    addEventListener("pagehide", () => {
      this.endListen(false);
      void flush(true);
    });
    const ms = navigator.mediaSession;
    if (ms) {
      ms.setActionHandler("play", () => this.play());
      ms.setActionHandler("pause", () => this.pause());
      ms.setActionHandler("nexttrack", () => this.next());
      ms.setActionHandler("previoustrack", () => this.prev());
      ms.setActionHandler("seekto", (d) => {
        if (d.seekTime != null) this.seek(d.seekTime * 1000);
      });
    }
    onAccountChange(() => void this.stop());
  }

  private get el(): HTMLAudioElement {
    return this.els[this.cur]!;
  }

  private make(i: number): HTMLAudioElement {
    const a = new Audio();
    a.preload = "auto";
    const mine = () => this.els[this.cur] === a;
    a.addEventListener("timeupdate", () => mine() && this.onTime());
    a.addEventListener("playing", () => {
      if (!mine()) return;
      set({ playing: true, buffering: false, error: null });
      if (navigator.mediaSession) navigator.mediaSession.playbackState = "playing";
    });
    a.addEventListener("pause", () => {
      if (!mine()) return;
      this.acc.tick(a.currentTime * 1000, false);
      set({ playing: false });
      if (navigator.mediaSession) navigator.mediaSession.playbackState = "paused";
    });
    a.addEventListener("waiting", () => mine() && set({ buffering: true }));
    a.addEventListener("ended", () => mine() && this.onEnded());
    a.addEventListener("error", () => (mine() ? void this.recover() : this.dropHeld()));
    a.addEventListener("durationchange", () => mine() && Number.isFinite(a.duration) && set({ durationMs: a.duration * 1000 }));
    void i;
    return a;
  }

  // ── sources ────────────────────────────────────────────────────────────────
  private fresh(trackId: string): { m: Manifest; source: number } | undefined {
    const e = this.manifests.get(trackId);
    return e && e.m.expiresAt * 1000 - 60_000 > Date.now() ? e : undefined;
  }

  private async resolve(ids: string[]): Promise<void> {
    const need = ids.filter((id) => !this.fresh(id));
    if (!need.length) return;
    const out = await ok(api.POST("/api/v2/playback/manifest", { body: { trackIds: need.slice(0, 20), network: network() } }));
    for (const m of out.items) this.manifests.set(m.trackId, { m, source: 0 });
  }

  private urlOf(trackId: string): { url: string; tier: string; codec: string | null } | null {
    const e = this.fresh(trackId);
    if (!e) return null;
    const all = [e.m, ...e.m.fallbacks];
    const s = all[Math.min(e.source, all.length - 1)]!;
    return { url: mediaUrl(s.url), tier: s.tier, codec: s.codec ?? null };
  }

  private ahead(): string[] {
    const { queue, index } = get();
    return queue.slice(Math.max(0, index), index + 1 + AHEAD).map((q) => q.trackId);
  }

  // ── gain ───────────────────────────────────────────────────────────────────
  private graph(): void {
    if (isMobile || this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.gains = this.els.map((a) => {
        const g = this.ctx!.createGain();
        this.ctx!.createMediaElementSource(a).connect(g).connect(this.ctx!.destination);
        return g;
      });
    } catch {
      this.ctx = null; // no Web Audio: attenuation through the element only
    }
  }

  private async applyGain(el: HTMLAudioElement, trackId: string): Promise<void> {
    const e = this.fresh(trackId);
    const ctxType = get().queue[get().index]?.contextType;
    const db = (await normalizeOn()) ? ((ctxType === "album" ? e?.m.gain.albumDb : null) ?? e?.m.gain.trackDb ?? null) : null;
    set({ gainDb: db });
    const linear = db == null ? 1 : Math.pow(10, db / 20);
    const g = this.gains[this.els.indexOf(el)];
    if (g && this.ctx) {
      g.gain.value = Math.min(linear, 4); // a boost is capped by the server at −1 dBTP
      el.volume = this.userVolume;
    } else {
      el.volume = Math.min(1, linear) * this.userVolume; // mobile: attenuation only
    }
    this.linear.set(el, linear);
  }

  private linear = new WeakMap<HTMLAudioElement, number>();

  volume(): number {
    return this.userVolume;
  }

  setVolume(v: number): void {
    this.userVolume = Math.min(1, Math.max(0, v));
    try {
      localStorage.setItem("musix.volume", String(this.userVolume));
    } catch {
      /* private mode */
    }
    for (const el of this.els) el.volume = (this.ctx ? 1 : Math.min(1, this.linear.get(el) ?? 1)) * this.userVolume;
  }

  /** v1's shuffle button: the upcoming part of a list, reordered once. */
  shuffleUpcoming(): void {
    const { queue, index, mode } = get();
    if (mode === "stream") return;
    const head = queue.slice(0, index + 1), rest = queue.slice(index + 1);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j]!, rest[i]!];
    }
    set({ queue: [...head, ...rest] });
    this.dropHeld();
  }

  // ── transport ──────────────────────────────────────────────────────────────
  /** A new list: the album, the playlist, a search result. */
  async playTracks(items: QueueItem[], index = 0): Promise<void> {
    this.endListen(true);
    this.toppedUpFrom = null;
    set({ queue: items, index, mode: "list", error: null });
    await this.load(index);
  }

  /** Handoff: another device's queue, continued here from where it was (phase 8). */
  async adopt(items: QueueItem[], index: number, positionMs: number, mode: "list" | "stream", play: boolean): Promise<void> {
    this.endListen(true);
    this.toppedUpFrom = null;
    set({ queue: items, index, mode, error: null });
    await this.load(index, positionMs);
    if (!play) this.pause();
  }

  /** «Поток»: the server's session plans the chunk; the first track starts at once. */
  async startStream(): Promise<void> {
    this.endListen(true);
    set({ queue: [], index: -1, mode: "stream", error: null, buffering: true });
    const items = await this.streamChunk(STREAM_CHUNK);
    if (!items.length) {
      set({ buffering: false, error: "Поток пока пуст: нужно больше прослушиваний" });
      return;
    }
    set({ queue: items, index: 0 });
    await this.load(0);
  }

  private async streamChunk(n: number): Promise<QueueItem[]> {
    const out = await ok(api.GET("/api/v2/stream/next", {
      params: { query: { sessionId: sessionId(), n, lang: "ru", tzOffsetMinutes: -new Date().getTimezoneOffset() } },
    }));
    remember(out.images);
    return out.items.filter((i) => i.track).map((i) => ({ ...fromTrack(i.track!, "stream"), source: i.pool, reason: i.reason?.text ?? null }));
  }

  /** The newest `load` wins. Each one takes a number; after every wait it checks that it is
   *  still the newest and gives up otherwise. Without it two picks in a row raced: the screen
   *  showed the second song while the first one's address arrived later and took the sound
   *  (the owner's report, 2026-10-05). */
  private loads = 0;
  /** From a load's start until the new source is in the element: the old element's last
   *  `timeupdate` must not write its position under the new track. */
  private switching = false;

  private async load(index: number, positionMs = 0): Promise<void> {
    const item = get().queue[index];
    if (!item) return;
    const mine = ++this.loads;
    const stale = () => mine !== this.loads;
    this.graph();
    this.switching = true;
    set({ index, positionMs, durationMs: item.durationMs ?? 0, buffering: true, taste: null, error: null });
    // The old track stops now, not when the new one's address has arrived: over a slow link it
    // went on sounding, and moving the seek line and the spectrum, under the new cover.
    this.el.pause();
    this.attempts = 0;
    try {
      await this.resolve(this.ahead());
    } catch {
      if (stale()) return;
      this.switching = false;
      set({ buffering: false, error: "Нет связи с сервером" });
      return;
    }
    if (stale()) return;
    const src = this.urlOf(item.trackId);
    if (!src) {
      this.switching = false;
      this.onUnplayable(item);
      return;
    }
    // the preloader already holds this track: swap, and the boundary costs nothing
    this.el.pause();
    if (this.held?.trackId === item.trackId && this.held.url && positionMs === 0) {
      this.cur = 1 - this.cur;
    } else {
      this.el.src = src.url;
      if (positionMs) this.el.currentTime = positionMs / 1000;
    }
    this.held = null;
    this.switching = false;
    const idle = this.els[1 - this.cur]!; // the one that just finished (or the stale preload)
    idle.removeAttribute("src");
    idle.load();
    set({ tier: src.tier, codec: src.codec });
    await this.applyGain(this.el, item.trackId);
    if (stale()) return;
    this.acc.begin({ trackId: item.trackId, durationMs: item.durationMs ?? null, source: item.source ?? "manual", contextType: item.contextType, contextId: item.contextId ?? null }, positionMs);
    this.played.push(item.trackId);
    this.mediaSession(item);
    void this.tasteOf(item.trackId);
    await this.play();
    void this.maintainQueue();
  }

  async play(): Promise<void> {
    this.graph();
    if (this.ctx?.state === "suspended") await this.ctx.resume().catch(() => undefined);
    if (!this.el.src) {
      if (get().index >= 0) return this.load(get().index, get().positionMs);
      return;
    }
    try {
      await this.el.play();
    } catch (e) {
      // autoplay refused (no gesture yet): show paused, the next click plays
      if ((e as DOMException).name === "NotAllowedError") set({ playing: false, buffering: false });
    }
  }

  pause(): void {
    this.acc.markInteracted();
    this.el.pause();
  }

  toggle(): void {
    if (this.el.paused) void this.play();
    else this.pause();
  }

  seek(ms: number): void {
    this.acc.markInteracted();
    this.el.currentTime = ms / 1000;
    this.acc.tick(ms, false); // a seek is not listening
    set({ positionMs: ms });
  }

  async next(user = true): Promise<void> {
    const { queue, index, mode } = get();
    if (user) this.acc.markInteracted();
    this.endListen(user);
    if (mode === "stream" && user) this.dropTail("skip");
    if (index + 1 < get().queue.length) return this.load(index + 1);
    if (mode === "stream") {
      const more = await this.streamChunk(STREAM_CHUNK).catch(() => []);
      set({ queue: [...queue, ...more] });
      if (more.length) return this.load(index + 1);
    }
    set({ playing: false });
  }

  async prev(): Promise<void> {
    if (this.el.currentTime > 3 || get().index <= 0) return this.seek(0);
    this.acc.markInteracted();
    this.endListen(true);
    await this.load(get().index - 1);
  }

  async jump(i: number): Promise<void> {
    this.acc.markInteracted();
    this.endListen(true);
    await this.load(i);
  }

  remove(i: number): void {
    const { queue, index } = get();
    if (i === index || i < 0 || i >= queue.length) return;
    set({ queue: queue.filter((_, k) => k !== i), index: i < index ? index - 1 : index });
    if (this.held && queue[i]?.trackId === this.held.trackId) this.dropHeld();
  }

  move(from: number, to: number): void {
    const { queue, index } = get();
    if (from === index || to <= index) return;
    const q = [...queue];
    const [it] = q.splice(from, 1);
    q.splice(to, 0, it!);
    set({ queue: q });
    this.dropHeld();
  }

  playNext(items: QueueItem[]): void {
    const { queue, index } = get();
    if (index < 0) return void this.playTracks(items, 0);
    set({ queue: [...queue.slice(0, index + 1), ...items, ...queue.slice(index + 1)] });
    this.dropHeld();
  }

  stop(): Promise<void> {
    const pending = this.endListen(false);
    for (const a of this.els) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    this.held = null;
    this.manifests.clear();
    this.played = [];
    set(initial);
    if (navigator.mediaSession) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }
    return pending;
  }

  /** огонёк / вода. In «Поток» the tail was planned before the signal: it is dropped
   *  and re-planned once the signal has reached the server. */
  async react(kind: "fire" | "water"): Promise<void> {
    const item = get().queue[get().index];
    if (!item || get().taste?.locked) return;
    this.acc.markInteracted();
    set({ taste: { kind, locked: true } });
    await enqueueSignal(item.trackId, kind, sessionId());
    await flush();
    if (get().mode === "stream") {
      this.dropTail("reaction");
      void this.maintainQueue();
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────
  private dropTail(signal: "reaction" | "skip"): void {
    const { queue, index } = get();
    const keep = signal === "skip" ? index + 1 : index;
    if (keep + 1 < queue.length) set({ queue: queue.slice(0, keep + 1) });
    this.dropHeld();
  }

  private dropHeld(): void {
    if (!this.held) return;
    this.held = null;
    const idle = this.els[1 - this.cur]!;
    idle.removeAttribute("src");
    idle.load();
  }

  /** Ends the listen in progress; resolves once it is in the outbox. */
  private endListen(skipped: boolean, error = false): Promise<void> {
    if (!this.acc.item) return Promise.resolve();
    this.acc.tick(this.el.currentTime * 1000, !this.el.paused);
    const e = this.acc.finish(skipped, sessionId(), error);
    return e ? enqueueListen(e) : Promise.resolve();
  }

  private onTime(): void {
    if (this.switching) return;
    const a = this.el;
    const pos = a.currentTime * 1000;
    const dur = Number.isFinite(a.duration) ? a.duration * 1000 : get().durationMs;
    this.acc.tick(pos, !a.paused, dur);
    const now = performance.now();
    if (now - this.lastPosUpdate > 240) {
      this.lastPosUpdate = now;
      set({ positionMs: pos });
      navigator.mediaSession?.setPositionState?.({ duration: dur / 1000 || 0, position: Math.min(a.currentTime, dur / 1000 || a.currentTime), playbackRate: 1 });
    }
    if (!this.held && shouldPreload(pos, dur)) void this.preloadNext();
  }

  private async preloadNext(): Promise<void> {
    const nextItem = get().queue[get().index + 1];
    if (!nextItem || this.held) return;
    this.held = { trackId: nextItem.trackId, url: "" }; // claimed: one preload at a time
    try {
      await this.resolve([nextItem.trackId]);
      const src = this.urlOf(nextItem.trackId);
      if (!src || this.held?.trackId !== nextItem.trackId) return;
      const idle = this.els[1 - this.cur]!;
      idle.src = src.url;
      idle.load();
      this.held.url = src.url;
      await this.applyGain(idle, nextItem.trackId);
    } catch {
      this.held = null;
    }
  }

  private onEnded(): void {
    this.acc.completeToEnd();
    this.endListen(false);
    void this.next(false);
  }

  /** 1st error: a fresh manifest (the signature may have expired) at the same position;
   *  then the next fallback; then the track is given up on. */
  private async recover(): Promise<void> {
    const item = get().queue[get().index];
    if (!item) return;
    const pos = this.el.currentTime * 1000, during = this.loads;
    this.attempts++;
    const e = this.manifests.get(item.trackId);
    if (this.attempts === 1) this.manifests.delete(item.trackId);
    else if (e && e.source < e.m.fallbacks.length) e.source++;
    else return this.onUnplayable(item);
    try {
      await this.resolve([item.trackId]);
    } catch {
      set({ error: "Нет связи с сервером", buffering: false });
      return;
    }
    if (during !== this.loads) return; // another track was chosen while the address was on its way
    const src = this.urlOf(item.trackId);
    if (!src) return this.onUnplayable(item);
    this.el.src = src.url;
    this.el.currentTime = pos / 1000;
    set({ tier: src.tier, codec: src.codec });
    await this.play();
  }

  private onUnplayable(item: QueueItem): void {
    this.acc.tick(this.el.currentTime * 1000, false);
    const ev = this.acc.finish(false, sessionId(), true);
    if (ev) void enqueueListen(ev);
    set({ error: `Не удалось воспроизвести «${item.title}»`, buffering: false });
    if (get().index + 1 < get().queue.length) void this.load(get().index + 1);
  }

  private async maintainQueue(): Promise<void> {
    if (this.refilling) return;
    const { queue, index, mode } = get();
    this.refilling = true;
    try {
      if (mode === "stream" && queue.length - 1 - index < STREAM_REFILL_BELOW) {
        const more = await this.streamChunk(STREAM_CHUNK);
        const have = new Set(get().queue.map((q) => q.trackId));
        set({ queue: [...get().queue, ...more.filter((m) => !have.has(m.trackId))] });
      }
      if (mode === "list" && queue.length > 0 && index >= queue.length - 1) {
        const seed = queue[index]!.trackId;
        if (seed !== this.toppedUpFrom) {
          this.toppedUpFrom = seed;
          const out = await ok(api.POST("/api/v2/stream/autoplay", { body: { seedTrackId: seed, excludeIds: this.played.slice(-200), limit: 20 } }));
          remember(out.images);
          set({ queue: [...get().queue, ...out.tracks.map((t) => ({ ...fromTrack(t, "queue"), source: "autoplay" }))] });
        }
      }
      // history: keep 20 played items before the current one
      const over = get().index - HISTORY_KEEP;
      if (over > 0) set({ queue: get().queue.slice(over), index: get().index - over });
    } catch {
      /* a refill failure is retried at the next boundary */
    } finally {
      this.refilling = false;
    }
  }

  private async tasteOf(trackId: string): Promise<void> {
    const s = await db.signals.get(trackId);
    if (!s || get().queue[get().index]?.trackId !== trackId) return;
    const age = (Date.now() - Date.parse(s.createdAt)) / 86_400_000;
    const charge = Math.pow(0.5, age);
    set({ taste: { kind: s.kind, locked: charge > 0.5 } });
  }

  private mediaSession(item: QueueItem): void {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const art = [96, 256, 512].map((px) => imageUrl(item.coverImageId, px)).filter((u): u is string => !!u);
    ms.metadata = new MediaMetadata({
      title: item.title,
      artist: item.artist,
      album: item.album ?? "",
      artwork: art.map((src, i) => ({ src: new URL(src, location.href).href, sizes: ["96x96", "256x256", "512x512"][i]! })),
    });
  }
}

export function fromTrack(t: Schemas["TrackOut"], contextType: ContextType, contextId?: string | null): QueueItem {
  return {
    trackId: t.id,
    title: t.titleDisplay ?? t.title,
    artist: t.artistDisplay,
    artistId: t.artists[0]?.id ?? null,
    album: t.album ?? null,
    albumId: t.albumId ?? null,
    coverImageId: t.coverImageId ?? null,
    durationMs: t.durationMs ?? null,
    source: "manual",
    contextType,
    contextId: contextId ?? null,
  };
}

export const player = new Engine();
