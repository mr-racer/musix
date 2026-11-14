import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, guard } from "./db";
import { onSyncComplete, sync, type Fetch, type SyncResult } from "./sync";

const account = vi.hoisted(() => ({ id: "a" as string | null, change: (() => {}) as () => void }));
vi.mock("./auth", () => ({
  useAuth: { getState: () => ({ accountId: account.id }) },
  onAccountChange: (fn: () => void) => { account.change = fn; },
  refresh: async () => true,
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}

const track = (id: string, title: string) => ({
  entity: "track" as const, id, op: "upsert" as const,
  data: { id, title, titleDisplay: null, artistDisplay: "A", artists: [{ id: "a1", name: "A", role: "primary" }], albumId: "al1", album: "Al", year: 2001, genre: null, trackNo: 1, discNo: 1, durationMs: 1000, coverImageId: null, addedAt: "2026-09-30T00:00:00Z" },
});
const gone = (id: string) => ({ entity: "track" as const, id, op: "delete" as const, data: null });

function server(pages: Record<string, { changes: unknown[]; cursor: string; hasMore: boolean } | { status: number }>): { fetch: Fetch; asked: (string | null)[] } {
  const asked: (string | null)[] = [];
  const fetch: Fetch = async (cursor) => {
    asked.push(cursor);
    const p = pages[cursor ?? "start"];
    if (!p) throw new Error("unexpected cursor " + cursor);
    if ("status" in p) throw Object.assign(new Error("refused"), { status: p.status });
    return p as never;
  };
  return { fetch, asked };
}

describe("the /sync mirror (the Android SyncEngine's rules)", () => {
  beforeEach(async () => {
    account.change();
    account.id = "a";
    await db.wipe();
    await guard("a");
  });

  it("pages a snapshot, applies a delta with a delete, and a refused cursor resyncs with a sweep", async () => {
    const a = server({
      start: { changes: [track("t1", "One"), track("t2", "Two")], cursor: "c1", hasMore: true },
      c1: { changes: [track("t3", "Three")], cursor: "c2", hasMore: false },
    });
    expect(await sync(a.fetch)).toMatchObject({ pages: 2, full: true });
    expect((await db.tracks.toArray()).map((t) => t.id).sort()).toEqual(["t1", "t2", "t3"]);

    const b = server({ c2: { changes: [gone("t2"), track("t1", "One (remaster)")], cursor: "c3", hasMore: false } });
    expect(await sync(b.fetch)).toMatchObject({ pages: 1, full: false });
    expect((await db.tracks.get("t1"))?.title).toBe("One (remaster)");
    expect(await db.tracks.get("t2")).toBeUndefined();

    // the server refuses the cursor: a new snapshot, and what it no longer lists is swept
    const c = server({ c3: { status: 400 }, start: { changes: [track("t3", "Three")], cursor: "c9", hasMore: false } });
    expect(await sync(c.fetch)).toMatchObject({ full: true });
    expect(c.asked).toEqual(["c3", null]);
    expect((await db.tracks.toArray()).map((t) => t.id)).toEqual(["t3"]);
  });

  it("coalesces twenty callers into the held pass and one catch-up, then notifies once", async () => {
    const held = deferred(), entered = deferred(), asked: (string | null)[] = [];
    const complete: SyncResult[] = [];
    const off = onSyncComplete((result) => complete.push(result));
    const fetch: Fetch = async (cursor) => {
      asked.push(cursor);
      if (asked.length === 1) {
        entered.resolve();
        await held.promise;
        return { changes: [track("first", "First snapshot")], cursor: "c1", hasMore: false } as never;
      }
      return { changes: [track("after", "Added while the snapshot was in flight")], cursor: "c2", hasMore: false } as never;
    };
    try {
      const first = sync(fetch);
      await entered.promise;
      const callers = [first, ...Array.from({ length: 19 }, () => sync(fetch))];
      held.resolve();
      const results = await Promise.all(callers);
      expect(asked).toEqual([null, "c1"]);
      expect(results).toEqual(Array.from({ length: 20 }, () => ({ pages: 2, changes: 2, full: true })));
      expect(complete).toEqual([{ pages: 2, changes: 2, full: true }]);
      expect((await db.tracks.toArray()).map((t) => t.id).sort()).toEqual(["after", "first"]);
      expect((await db.kv.get("sync.cursor"))?.value).toBe("c2");
    } finally { held.resolve(); off(); }
  });

  it("rejects a failed burst without an orphan rejection and retries from the last committed cursor", async () => {
    await sync(server({ start: { changes: [track("kept", "Before")], cursor: "saved", hasMore: false } }).fetch);
    const held = deferred(), entered = deferred();
    let calls = 0;
    const complete: SyncResult[] = [], unhandled: unknown[] = [];
    const off = onSyncComplete((result) => complete.push(result));
    const onUnhandled = (error: unknown) => { unhandled.push(error); };
    process.on("unhandledRejection", onUnhandled);
    const fetch: Fetch = async () => {
      calls++; entered.resolve();
      await held.promise;
      throw new Error("offline");
    };
    try {
      const first = sync(fetch);
      await entered.promise;
      const outcomes = Promise.allSettled([first, ...Array.from({ length: 19 }, () => sync(fetch))]);
      held.resolve();
      expect((await outcomes).every((result) => result.status === "rejected")).toBe(true);
      expect(calls).toBe(1);
      expect(complete).toEqual([]);
      expect((await db.kv.get("sync.cursor"))?.value).toBe("saved");
      const retry = server({ saved: { changes: [track("kept", "After retry")], cursor: "fresh", hasMore: false } });
      expect(await sync(retry.fetch)).toEqual({ pages: 1, changes: 1, full: false });
      expect(retry.asked).toEqual(["saved"]);
      expect((await db.tracks.get("kept"))?.title).toBe("After retry");
      expect(complete).toEqual([{ pages: 1, changes: 1, full: false }]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally { held.resolve(); off(); process.off("unhandledRejection", onUnhandled); }
  });

  it("notifies committed data once when the follow-up request fails", async () => {
    const held = deferred(), entered = deferred(), complete: SyncResult[] = [];
    const off = onSyncComplete((result) => complete.push(result));
    let calls = 0;
    const fetch: Fetch = async () => {
      if (++calls > 1) throw new Error("follow-up offline");
      entered.resolve(); await held.promise;
      return { changes: [track("committed", "Available despite the later failure")], cursor: "committed-cursor", hasMore: false } as never;
    };
    try {
      const first = sync(fetch);
      const rejected = expect(first).rejects.toThrow("follow-up offline");
      await entered.promise;
      const followup = sync(fetch);
      const followupRejected = expect(followup).rejects.toThrow("follow-up offline");
      held.resolve();
      await Promise.all([rejected, followupRejected]);
      expect(calls).toBe(2);
      expect((await db.tracks.get("committed"))?.title).toBe("Available despite the later failure");
      expect((await db.kv.get("sync.cursor"))?.value).toBe("committed-cursor");
      expect(complete).toEqual([{ pages: 1, changes: 1, full: true }]);
    } finally { held.resolve(); off(); }
  });

  it("discards an old account response and its queued work after the new account has synced", async () => {
    const held = deferred(), entered = deferred();
    let oldCalls = 0;
    const complete: SyncResult[] = [];
    const off = onSyncComplete((result) => complete.push(result));
    const oldFetch: Fetch = async () => {
      oldCalls++; entered.resolve(); await held.promise;
      return { changes: [track("private-a", "Previous account")], cursor: "old-account-cursor", hasMore: false } as never;
    };
    try {
      const old = sync(oldFetch);
      const rejected = expect(old).rejects.toThrow("account changed");
      await entered.promise;
      const queued = sync(oldFetch);
      const queuedRejected = expect(queued).rejects.toThrow("account changed");
      account.change(); account.id = "b";
      await guard("b");
      await sync(server({ start: { changes: [track("private-b", "Current account")], cursor: "new-account-cursor", hasMore: false } }).fetch);
      held.resolve();
      await Promise.all([rejected, queuedRejected]);
      expect(oldCalls).toBe(1);
      expect((await db.tracks.toArray()).map((t) => t.id)).toEqual(["private-b"]);
      expect((await db.kv.get("sync.cursor"))?.value).toBe("new-account-cursor");
      expect((await db.kv.get("account"))?.value).toBe("b");
      expect(complete).toEqual([{ pages: 1, changes: 1, full: true }]);
    } finally { held.resolve(); off(); }
  });

  it("does not write a late response if another tab changed the mirror owner", async () => {
    const held = deferred(), entered = deferred();
    const fetch: Fetch = async () => {
      entered.resolve(); await held.promise;
      return { changes: [track("wrong-owner", "Stale response")], cursor: "wrong-cursor", hasMore: false } as never;
    };
    const pending = sync(fetch);
    const rejected = expect(pending).rejects.toThrow("mirror account changed");
    await entered.promise;
    // This tab's auth is still account A; IndexedDB is shared with the other tab.
    await guard("b");
    held.resolve();
    await rejected;
    expect(await db.tracks.count()).toBe(0);
    expect(await db.kv.get("sync.cursor")).toBeUndefined();
    expect((await db.kv.get("account"))?.value).toBe("b");
  });

});
