import { expect, test, type Page } from "@playwright/test";
import type { PlayerState, QueueItem } from "../src/player/engine";

const base = process.env.MUSIX_WEB_URL ?? "http://127.0.0.1:5173";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C, D, E, F, H] = [1, 2, 3, 4, 5, 6, 7].map(id) as [string, string, string, string, string, string, string];
const item = (trackId: string): QueueItem => ({ trackId, title: trackId, artist: "Проверка очереди", contextType: "queue", durationMs: 45000 });
const track = (trackId: string) => ({ id: trackId, title: trackId, artistDisplay: "Проверка очереди", artists: [], durationMs: 45000 });
const chunk = (...ids: string[]) => ({ items: ids.map((id) => ({ track: track(id), pool: "test", reason: null })), images: {} });
type Debug = {
  player: { playTracks: (items: QueueItem[]) => Promise<void>; startStream: () => Promise<void>; next: (user?: boolean) => Promise<void>; stop: () => Promise<void>; enqueue: (item: QueueItem) => void };
  usePlayer: { getState: () => PlayerState };
};

function deferred() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return { ready, release };
}

function wav() {
  const rate = 8000, samples = rate * 45, body = Buffer.alloc(44 + samples * 2);
  body.write("RIFF", 0); body.writeUInt32LE(body.length - 8, 4); body.write("WAVEfmt ", 8);
  body.writeUInt32LE(16, 16); body.writeUInt16LE(1, 20); body.writeUInt16LE(1, 22);
  body.writeUInt32LE(rate, 24); body.writeUInt32LE(rate * 2, 28); body.writeUInt16LE(2, 32); body.writeUInt16LE(16, 34);
  body.write("data", 36); body.writeUInt32LE(samples * 2, 40);
  return body;
}

async function prepare(page: Page) {
  await page.route("**/api/v2/events/listens:batch", (route) => route.fulfill({ json: { accepted: 1, duplicates: 0 } }));
  // Only browser responses change: these tests do not write account settings or listeners.
  await page.route("**/api/v2/settings", (route) => route.fulfill({ json: { value: { playback: { autoplay: true } } } }));
  await page.route("**/api/v2/stream/autoplay", (route) => route.fulfill({ json: { tracks: [], images: {} } }));
  await page.route("**/api/v2/playback/manifest", (route) => route.fulfill({ json: { items: route.request().postDataJSON().trackIds.map((trackId: string) => ({
    trackId, url: `/m/queue-regression-${trackId}.wav`, tier: "lossless", codec: "pcm", durationMs: 45000,
    expiresAt: Math.floor(Date.now() / 1000) + 3600, fallbacks: [], gain: {}, sizeBytes: null, bitrateKbps: null,
  })) } }));
  const audio = wav();
  await page.route("**/m/queue-regression-*.wav", (route) => route.fulfill({ contentType: "audio/wav", body: audio }));
  await page.goto(base + "/login");
  await page.fill("input[type=email]", process.env.MUSIX_EMAIL ?? "mig-owner@example.com");
  await page.fill("input[type=password]", process.env.MUSIX_PASSWORD ?? "mig-pass-123");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(base + "/");
  await page.waitForFunction(() => !!(window as unknown as { __musix?: Debug }).__musix);
}

const play = (page: Page, ids: string[]) => page.evaluate((items) => (window as unknown as { __musix: Debug }).__musix.player.playTracks(items), ids.map(item));
const stop = (page: Page) => page.evaluate(() => (window as unknown as { __musix: Debug }).__musix.player.stop());
const state = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __musix: Debug }).__musix.usePlayer.getState();
  return { queue: s.queue.map((t) => t.trackId), current: s.queue[s.index]?.trackId ?? null, queued: s.queue.filter((t) => t.queued).map((t) => t.trackId), playing: s.playing };
});
async function releaseResponse(page: Page, held: ReturnType<typeof deferred>, url: string) {
  const response = page.waitForResponse((r) => r.url().includes(url));
  held.release();
  await response;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const action of ["stop", "replace", "enqueue"] as const) {
  test(`a delayed next chunk respects ${action} while waiting`, async ({ page }) => {
    const held = deferred();
    let calls = 0;
    await page.route("**/api/v2/stream/next?**", async (route) => {
      const n = ++calls;
      if (n === 3) await held.ready;
      return route.fulfill({ json: n === 1 ? chunk(A, B, C) : n === 3 ? chunk(D) : chunk() });
    });
    await prepare(page);
    await page.evaluate(() => (window as unknown as { __musix: Debug }).__musix.player.startStream());
    // The user skip keeps B but discards the preplanned C. Its refill returns empty,
    // so the following next() must await a fresh chunk rather than a queued item.
    await page.evaluate(() => (window as unknown as { __musix: Debug }).__musix.player.next());
    await expect.poll(() => calls).toBe(2);
    await expect.poll(async () => (await state(page)).current).toBe(B);
    await page.evaluate(() => { void (window as unknown as { __musix: Debug }).__musix.player.next(); });
    await expect.poll(() => calls).toBe(3);
    if (action === "stop") await stop(page);
    else if (action === "replace") await play(page, [E, F]);
    else await page.evaluate((queued) => (window as unknown as { __musix: Debug }).__musix.player.enqueue(queued), item(H));
    await releaseResponse(page, held, "/stream/next");
    if (action === "stop") expect(await state(page)).toEqual({ queue: [], current: null, queued: [], playing: false });
    else if (action === "replace") expect(await state(page)).toEqual({ queue: [E, F], current: E, queued: [], playing: true });
    else {
      await expect.poll(async () => (await state(page)).current).toBe(H);
      expect((await state(page)).queue).toEqual([A, B, H, D]);
      expect((await state(page)).queued).toEqual([H]);
    }
    await stop(page);
  });
}

test("an automatic stream refill cannot append tracks after stop", async ({ page }) => {
  const held = deferred();
  let calls = 0;
  await page.route("**/api/v2/stream/next?**", async (route) => {
    const n = ++calls;
    if (n === 2) await held.ready;
    return route.fulfill({ json: n === 1 ? chunk(A, B, C) : chunk(D) });
  });
  await prepare(page);
  await page.evaluate(() => (window as unknown as { __musix: Debug }).__musix.player.startStream());
  await page.evaluate(() => (window as unknown as { __musix: Debug }).__musix.player.next(false));
  await expect.poll(() => calls).toBe(2);
  await stop(page);
  await releaseResponse(page, held, "/stream/next");
  expect(await state(page)).toEqual({ queue: [], current: null, queued: [], playing: false });
});

test("an automatic list refill cannot append tracks after stop", async ({ page }) => {
  await prepare(page);
  const held = deferred();
  let waiting = false;
  await page.route("**/api/v2/stream/autoplay", async (route) => {
    waiting = true;
    await held.ready;
    return route.fulfill({ json: { tracks: [track(D)], images: {} } });
  });
  await play(page, [A]);
  await expect.poll(() => waiting).toBe(true);
  await stop(page);
  await releaseResponse(page, held, "/stream/autoplay");
  expect(await state(page)).toEqual({ queue: [], current: null, queued: [], playing: false });
});

test("a replacement list refills while the old request is pending and keeps hand-picked items", async ({ page }) => {
  await prepare(page);
  const old = deferred(), fresh = deferred();
  const seeds: string[] = [];
  await page.route("**/api/v2/stream/autoplay", async (route) => {
    const seed = route.request().postDataJSON().seedTrackId;
    seeds.push(seed);
    await (seed === A ? old : fresh).ready;
    return route.fulfill({ json: { tracks: [track(seed === A ? D : F)], images: {} } });
  });
  await play(page, [A]);
  await expect.poll(() => seeds).toEqual([A]);
  await play(page, [E]);
  // The old request must neither block the new refill nor release its claim on return.
  await expect.poll(() => seeds).toEqual([A, E]);
  await page.evaluate((queued) => (window as unknown as { __musix: Debug }).__musix.player.enqueue(queued), item(H));
  await releaseResponse(page, old, "/stream/autoplay");
  expect((await state(page)).queue).toEqual([E, H]);
  await releaseResponse(page, fresh, "/stream/autoplay");
  expect(await state(page)).toEqual({ queue: [E, H, F], current: E, queued: [H], playing: true });
  await stop(page);
});

test("a failed next chunk pauses the old track and retry requests the continuation", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/v2/stream/next?**", (route) => {
    const n = ++calls;
    return n === 3
      ? route.fulfill({ status: 503, json: { detail: "Unavailable" } })
      : route.fulfill({ json: n === 1 ? chunk(A, B, C) : n === 4 ? chunk(D, E, F) : chunk() });
  });
  await prepare(page);
  await page.evaluate(() => (window as unknown as { __musix: Debug }).__musix.player.startStream());
  await page.evaluate(() => (window as unknown as { __musix: Debug }).__musix.player.next());
  await expect.poll(() => calls).toBe(2);
  await page.evaluate(() => (window as unknown as { __musix: Debug }).__musix.player.next());
  const mini = page.getByRole("region", { name: "Сейчас играет" });
  await expect(mini.getByRole("alert")).toContainText("Не удалось загрузить продолжение потока");
  expect((await state(page)).playing).toBe(false);
  expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe("paused");
  await mini.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect.poll(async () => (await state(page)).current).toBe(D);
  await expect.poll(async () => (await state(page)).playing).toBe(true);
  expect(calls).toBe(4);
  expect((await state(page)).queue).toEqual([A, B, D, E, F]);
  await expect(mini.getByRole("alert")).toHaveCount(0);
  await stop(page);
});
