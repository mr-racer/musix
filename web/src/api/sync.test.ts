import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { sync, type Fetch } from "./sync";

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
  beforeEach(() => db.wipe());

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
});
