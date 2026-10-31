import { deflateSync, gzipSync } from "node:zlib";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { PlayerState, QueueItem } from "../src/player/engine";

const base = process.env.MUSIX_WEB_URL ?? "http://127.0.0.1:5173";
const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002";
const item = (trackId: string): QueueItem => ({ trackId, title: trackId, artist: "Проверка ресурсов", contextType: "queue", durationMs: 60000 });
type Debug = { player: { playTracks: (items: QueueItem[]) => Promise<void>; next: () => Promise<void>; seek: (ms: number) => void; stop: () => Promise<void> }; usePlayer: { getState: () => PlayerState } };

function wav() {
  const rate = 8000, samples = rate * 60, body = Buffer.alloc(44 + samples * 2);
  body.write("RIFF", 0); body.writeUInt32LE(body.length - 8, 4); body.write("WAVEfmt ", 8);
  body.writeUInt32LE(16, 16); body.writeUInt16LE(1, 20); body.writeUInt16LE(1, 22);
  body.writeUInt32LE(rate, 24); body.writeUInt32LE(rate * 2, 28); body.writeUInt16LE(2, 32); body.writeUInt16LE(16, 34);
  body.write("data", 36); body.writeUInt32LE(samples * 2, 40);
  return body;
}

// Real Range responses matter: a 200-only mock makes Chrome reset a seek to zero,
// which would never reach the preload boundary and would give a false pass.
function audio(route: Route, body: Buffer) {
  const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(body.length - 1, Number(range[2])) : body.length - 1;
  return route.fulfill({ status: range ? 206 : 200, contentType: "audio/wav", body: body.subarray(start, end + 1),
    headers: { "accept-ranges": "bytes", ...(range ? { "content-range": `bytes ${start}-${end}/${body.length}` } : {}) } });
}

const manifest = (trackId: string, missing = false) => ({ trackId, url: missing ? "/m/performance-missing.wav" : `/m/performance-${trackId}.wav`, tier: "lossless", codec: "pcm", durationMs: 60000,
  expiresAt: Math.floor(Date.now() / 1000) + 3600, fallbacks: [], gain: {}, sizeBytes: null, bitrateKbps: null });

async function prepare(page: Page) {
  await page.route("**/api/v2/events/listens:batch", (route) => route.fulfill({ json: { accepted: 1, duplicates: 0 } }));
  await page.route("**/api/v2/stream/autoplay", (route) => route.fulfill({ json: { tracks: [], images: {} } }));
  await page.route("**/api/v2/playback/manifest", (route) => route.fulfill({ json: { items: route.request().postDataJSON().trackIds.map((id: string) => manifest(id)) } }));
  const body = wav();
  await page.route("**/m/performance-*.wav", (route) => route.request().url().endsWith("missing.wav") ? route.fulfill({ status: 404, body: "" }) : audio(route, body));
  await page.route("**/api/v2/player/context/*", (route) => route.fulfill({ json: { track: { id: A }, audio: { sampleRate: 8000, bitDepth: 16 }, knowledge: null, lyrics: null, images: {} } }));
  await page.goto(base + "/login");
  await page.fill("input[type=email]", process.env.MUSIX_EMAIL ?? "mig-owner@example.com");
  await page.fill("input[type=password]", process.env.MUSIX_PASSWORD ?? "mig-pass-123");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(base + "/");
  await page.waitForFunction(() => !!(window as unknown as { __musix?: Debug }).__musix);
}

const play = (page: Page) => page.evaluate((items) => (window as unknown as { __musix: Debug }).__musix.player.playTracks(items), [item(A), item(B)]);
const stop = (page: Page) => page.evaluate(() => (window as unknown as { __musix: Debug }).__musix.player.stop());

test("the mobile mini player does not fetch or mount a spectrum and follows viewport changes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requested: string[] = [];
  await page.route("**/api/v2/tracks/*/spectrum?**", (route) => {
    requested.push(route.request().url());
    return route.fulfill({ contentType: "application/octet-stream", body: Buffer.concat([Buffer.from([77, 88, 83, 50, 30, 16]), deflateSync(Buffer.alloc(240 * 16, 1))]) });
  });
  await prepare(page);
  await play(page);
  const mini = page.getByRole("region", { name: "Сейчас играет" });
  await expect(mini).toBeVisible();
  await expect(mini.locator("canvas")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(requested).toHaveLength(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(mini.locator("canvas")).toBeVisible();
  await expect.poll(() => requested.length).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(mini.locator("canvas")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __musix: Debug }).__musix.player.next());
  await page.waitForTimeout(300);
  expect(requested).toHaveLength(1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(mini.locator("canvas")).toBeVisible();
  await expect.poll(() => requested.length).toBe(2);
  expect(requested[1]).toContain(B);
  await stop(page);
});

test("returning to a visible tab keeps the reduced-motion sound stage static", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.clearRect;
    (window as any).stageDraws = 0;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.getAttribute("aria-label") === "Сцена: где звучит каждая партия") (window as any).stageDraws++;
      return original.apply(this, args);
    };
  });
  await page.route("**/api/v2/tracks/*/spectrum?**", (route) => route.fulfill({ status: 404 }));
  await page.route("**/api/v2/tracks/*/sound", (route) => route.fulfill({ json: {
    ver: 1, hasStage: true, ratings: { tech: 55, space: 70, odd: 40, facets: {} }, echo: { key: "little", label: "в комнате" }, width: { key: "wide", label: "широкая сцена" },
    pace: null, feel: null, drums: null, vocals: null, signature: null, instruments: [], moments: [], sections: [], traits: [], stems: [],
    stage: [{ stem: "piano", name: { key: "piano", label: "фортепиано" }, entries: [] }],
  } }));
  let loaded = false;
  const stage = Buffer.alloc(600 * 2);
  for (let i = 0; i < 600; i++) stage[i * 2] = 246; // int8 -10: a continuously audible piano part
  await page.route("**/api/v2/tracks/*/sound/stage", (route) => {
    loaded = true;
    return route.fulfill({ contentType: "application/octet-stream", headers: { "X-Stage-Stems": "piano", "X-Stage-Fps": "10" }, body: gzipSync(stage) });
  });
  await prepare(page);
  await play(page);
  await page.getByRole("link", { name: "Плеер", exact: true }).first().click();
  await page.getByTitle("Звук песни", { exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Звук песни" })).toBeVisible();
  await expect.poll(() => loaded).toBe(true);
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => (window as any).stageDraws as number);
  expect(before).toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).stageDraws)).toBe(before);
  await stop(page);
});

for (const failure of ["manifest", "audio"] as const) {
  test(`a failed speculative ${failure} backs off without blocking an explicit next`, async ({ page }) => {
    await prepare(page);
    let initial = true, available = false, attempts = 0;
    await page.route("**/api/v2/playback/manifest", (route) => {
      const ids: string[] = route.request().postDataJSON().trackIds;
      if (initial) { initial = false; return route.fulfill({ json: { items: [manifest(A)] } }); }
      attempts++;
      if (!available && failure === "manifest") return route.fulfill({ status: 503, json: { detail: "Unavailable" } });
      return route.fulfill({ json: { items: ids.map((id) => manifest(id, !available)) } });
    });
    await play(page);
    await page.evaluate(() => (window as unknown as { __musix: Debug }).__musix.player.seek(40000));
    await page.waitForFunction(() => (window as unknown as { __musix: Debug }).__musix.usePlayer.getState().positionMs > 35000);
    await page.waitForTimeout(6000);
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(attempts).toBeLessThanOrEqual(3); // previously ~23 requests in the same six seconds
    expect(await page.evaluate(() => (window as unknown as { __musix: Debug }).__musix.usePlayer.getState().playing)).toBe(true);
    const before = attempts;
    available = true;
    await page.getByRole("region", { name: "Сейчас играет" }).getByRole("button", { name: "Следующий", exact: true }).click();
    await page.waitForFunction((id) => {
      const s = (window as unknown as { __musix: Debug }).__musix.usePlayer.getState();
      return s.queue[s.index]?.trackId === id && s.playing;
    }, B);
    expect(attempts).toBe(before + 1);
    await stop(page);
  });
}
