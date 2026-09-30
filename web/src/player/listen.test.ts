import { describe, expect, it } from "vitest";
import { ListenAccumulator, shouldPreload } from "./listen";

const item = { trackId: "t1", durationMs: 200_000, source: "manual", contextType: "album" as const };

function play(acc: ListenAccumulator, from: number, to: number, step = 250): void {
  for (let p = from + step; p <= to; p += step) acc.tick(p, true, 200_000);
}

describe("the web player", () => {
  it("accounts a listen like the Android ListenAccumulator and arms the preload at half", () => {
    // heard time, not the playhead: a seek and a paused stretch add nothing
    const acc = new ListenAccumulator();
    acc.begin(item, 0);
    play(acc, 0, 20_000);
    acc.tick(150_000, true); // a seek forward: one big step
    play(acc, 150_000, 160_000);
    acc.tick(160_000, false);
    acc.tick(170_000, false); // paused
    const e = acc.finish(true, "s1")!;
    expect(e.playedMs).toBe(30_000);
    expect(e.endReason).toBe("skipped");
    expect(e.skippedEarly).toBe(false); // 30 s heard is not an early skip

    // completed at ≥ 90 % heard, the tail credited at `ended`
    acc.begin(item, 0);
    play(acc, 0, 199_000);
    acc.completeToEnd();
    const done = acc.finish(false, "s1")!;
    expect([done.playedMs, done.endReason]).toEqual([200_000, "completed"]);

    // an early skip (< 30 s and < 30 %) with a touch; a sub-second listen is no listen
    acc.begin(item, 0);
    play(acc, 0, 8_000);
    acc.markInteracted();
    const early = acc.finish(true, "s1")!;
    expect([early.endReason, early.skippedEarly, early.interacted]).toEqual(["skipped", true, true]);
    acc.begin(item, 0);
    acc.tick(500, true);
    expect(acc.finish(true, "s1")).toBeNull();

    // the boundary: the next track preloads once the current passes half
    expect(shouldPreload(99_000, 200_000)).toBe(false);
    expect(shouldPreload(100_000, 200_000)).toBe(true);
    expect(shouldPreload(100_000, null)).toBe(false);
  });
});
