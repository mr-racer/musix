import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, guard } from "./db";
import { readSettings, setSetting } from "./settings";

const state = vi.hoisted(() => ({
  account: "a" as string | null,
  change: (() => {}) as () => void,
  put: vi.fn(),
}));
vi.mock("./auth", () => ({
  useAuth: { getState: () => ({ accountId: state.account }) },
  onAccountChange: (fn: () => void) => { state.change = fn; },
}));
vi.mock("./client", () => ({ api: { PUT: state.put }, ok: (p: Promise<unknown>) => p }));

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("settings writes", () => {
  beforeEach(async () => {
    state.change();
    state.account = "a";
    state.put.mockReset();
    await db.wipe();
    await guard("a");
    await db.kv.put({ key: "settings", value: { playback: { normalize: true }, home: { precip: true } } });
  });

  it("rolls back a rejected optimistic change and reports its failure", async () => {
    const request = deferred();
    state.put.mockReturnValueOnce(request.promise);
    const saved = setSetting(["playback", "normalize"], false);
    const rejected = expect(saved).rejects.toThrow("offline");
    await vi.waitFor(async () => expect((await readSettings()).playback?.normalize).toBe(false));
    request.reject(new Error("offline"));
    await rejected;
    expect(await readSettings()).toEqual({ playback: { normalize: true }, home: { precip: true } });
  });

  it("serializes full PUTs and rebases later edits after a failure", async () => {
    const first = deferred(), second = deferred();
    state.put.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = setSetting(["playback", "normalize"], false);
    const rejected = expect(a).rejects.toThrow("offline");
    await vi.waitFor(() => expect(state.put).toHaveBeenCalledTimes(1));
    const b = setSetting(["home", "precip"], false);
    await vi.waitFor(async () => expect(await readSettings()).toEqual({ playback: { normalize: false }, home: { precip: false } }));
    expect(state.put).toHaveBeenCalledTimes(1);
    first.reject(new Error("offline"));
    await rejected;
    await vi.waitFor(() => expect(state.put).toHaveBeenCalledTimes(2));
    expect(state.put.mock.calls[1]![1].body.value).toEqual({ playback: { normalize: true }, home: { precip: false } });
    second.resolve();
    await b;
    expect(await readSettings()).toEqual({ playback: { normalize: true }, home: { precip: false } });
  });

  it("keeps the last rapid edit to the same setting", async () => {
    const first = deferred();
    state.put.mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined);
    const a = setSetting(["playback", "normalize"], false);
    await vi.waitFor(() => expect(state.put).toHaveBeenCalledTimes(1));
    const b = setSetting(["playback", "normalize"], true);
    await vi.waitFor(async () => expect((await readSettings()).playback?.normalize).toBe(true));
    first.resolve();
    await Promise.all([a, b]);
    expect(state.put.mock.calls[1]![1].body.value.playback.normalize).toBe(true);
    expect((await readSettings()).playback?.normalize).toBe(true);
  });

  it("cancels queued writes on account change without altering the new mirror", async () => {
    const request = deferred();
    state.put.mockReturnValueOnce(request.promise);
    const a = setSetting(["playback", "normalize"], false);
    const aRejected = expect(a).rejects.toThrow("account changed");
    await vi.waitFor(() => expect(state.put).toHaveBeenCalledTimes(1));
    const b = setSetting(["home", "precip"], false);
    const bRejected = expect(b).rejects.toThrow("account changed");
    state.change();
    state.account = "b";
    await guard("b");
    await db.kv.put({ key: "settings", value: { quality: { wifi: "lossless" } } });
    request.resolve();
    await Promise.all([aRejected, bRejected]);
    await new Promise((r) => setTimeout(r, 10));
    expect(state.put).toHaveBeenCalledTimes(1);
    expect(await readSettings()).toEqual({ quality: { wifi: "lossless" } });
    expect(state.put.mock.calls[0]![1].signal.aborted).toBe(true);
  });
});
