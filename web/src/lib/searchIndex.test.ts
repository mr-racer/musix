import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, guard, type TrackRow } from "../api/db";
import { forgetIndex, loadSearchIndex } from "./searchIndex";

const events = vi.hoisted(() => ({
  account: new Set<(id: string | null) => void>(),
  sync: new Set<(result: { changes: number; full: boolean; pages: number }) => void>(),
  warm: vi.fn(),
}));
vi.mock("../api/auth", () => ({
  useAuth: { getState: () => ({ accountId: "a" }) },
  onAccountChange: (fn: (id: string | null) => void) => { events.account.add(fn); return () => events.account.delete(fn); },
}));
vi.mock("../api/sync", () => ({ onSyncComplete: (fn: (result: { changes: number; full: boolean; pages: number }) => void) => { events.sync.add(fn); return () => events.sync.delete(fn); } }));
vi.mock("./images", () => ({ warmFromMirror: events.warm }));

const track = (id: string, title = id): TrackRow => ({ id, title, sortTitle: title, artist: "Artist", artistIds: ["artist"], artists: [{ id: "artist", name: "Artist" }], albumId: "album", album: "Album", year: 2000, genre: null, durationMs: 1000, trackNo: 1, discNo: 1, coverImageId: null, addedAt: 0, gen: 1 });
const synced = (changes = 1, full = false) => { for (const fn of events.sync) fn({ changes, full, pages: 1 }); };
const account = (id: string | null) => { for (const fn of events.account) fn(id); };

describe("shared search index", () => {
  beforeEach(async () => {
    account("a");
    forgetIndex();
    events.warm.mockReset().mockResolvedValue(undefined);
    await db.wipe();
    await guard("a");
    await db.tracks.put(track("old"));
  });

  it("reuses one snapshot until the mirror changes", async () => {
    const first = await loadSearchIndex();
    synced(0);
    expect(await loadSearchIndex()).toBe(first);
    expect(events.warm).toHaveBeenCalledTimes(1);
  });

  it("reflects sync additions and deletions without reloading the page", async () => {
    expect((await loadSearchIndex()).tracks.map((t) => t.id)).toEqual(["old"]);
    await db.tracks.delete("old");
    await db.tracks.put(track("new"));
    synced();
    expect((await loadSearchIndex()).tracks.map((t) => t.id)).toEqual(["new"]);
  });

  it("follows another tab's committed cursor even when local sync has no changes", async () => {
    await loadSearchIndex();
    await db.transaction("rw", [db.tracks, db.kv], async () => {
      await db.tracks.delete("old");
      await db.tracks.put(track("from-another-tab"));
      await db.kv.put({ key: "sync.cursor", value: "another-tab-cursor" });
    });
    synced(0);
    await vi.waitFor(async () => {
      expect((await loadSearchIndex()).tracks.map((t) => t.id)).toEqual(["from-another-tab"]);
    });
  });

  it("does not reuse a previous account's snapshot", async () => {
    await loadSearchIndex();
    account("b");
    await guard("b");
    await db.tracks.put(track("other-account"));
    expect((await loadSearchIndex()).tracks.map((t) => t.id)).toEqual(["other-account"]);
  });

  it("rejects a read invalidated while image metadata was loading", async () => {
    let release!: () => void;
    events.warm.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve; }));
    const old = loadSearchIndex();
    await vi.waitFor(() => expect(events.warm).toHaveBeenCalledTimes(1));
    const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
    account("b");
    await guard("b");
    await db.tracks.put(track("new-owner"));
    release();
    await rejected;
    expect((await loadSearchIndex()).tracks.map((t) => t.id)).toEqual(["new-owner"]);
  });

  it("retries a failed index read", async () => {
    events.warm.mockRejectedValueOnce(new Error("read failed"));
    await expect(loadSearchIndex()).rejects.toThrow("read failed");
    expect((await loadSearchIndex()).tracks[0]?.id).toBe("old");
  });
});
