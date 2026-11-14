import { expect, test } from "@playwright/test";
import type { QueueItem } from "../src/player/engine";

const base = process.env.MUSIX_WEB_URL ?? "http://127.0.0.1:5173";
type Debug = { player: { playTracks: (items: QueueItem[]) => Promise<void> }; usePlayer: { getState: () => { queue: QueueItem[]; index: number } } };
const count = 1500;
function wav() {
  const rate = 8000, samples = rate * 60, body = Buffer.alloc(44 + samples * 2);
  body.write("RIFF", 0); body.writeUInt32LE(body.length - 8, 4); body.write("WAVEfmt ", 8);
  body.writeUInt32LE(16, 16); body.writeUInt16LE(1, 20); body.writeUInt16LE(1, 22);
  body.writeUInt32LE(rate, 24); body.writeUInt32LE(rate * 2, 28); body.writeUInt16LE(2, 32); body.writeUInt16LE(16, 34);
  body.write("data", 36); body.writeUInt32LE(samples * 2, 40);
  return body;
}

test("a long queue mounts on demand and remains usable by scrolling, keyboard and drag", async ({ page }) => {
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/v2/events/listens:batch", (r) => r.fulfill({ json: { accepted: 1, duplicates: 0 } }));
  await page.route("**/api/v2/stream/autoplay", (r) => r.fulfill({ json: { tracks: [], images: {} } }));
  await page.route("**/api/v2/playback/manifest", (r) => r.fulfill({ json: { items: r.request().postDataJSON().trackIds.map((trackId: string) => ({
    trackId, url: "/m/queue-perf.wav", tier: "lossless", codec: "pcm", durationMs: 60000,
    expiresAt: Date.now() / 1000 + 3600, fallbacks: [], gain: {}, sizeBytes: null, bitrateKbps: null,
  })) } }));
  await page.route("**/m/queue-perf.wav", (r) => r.fulfill({ contentType: "audio/wav", body: wav() }));
  await page.goto(base + "/login");
  await page.fill("input[type=email]", process.env.MUSIX_EMAIL ?? "mig-owner@example.com");
  await page.fill("input[type=password]", process.env.MUSIX_PASSWORD ?? "mig-pass-123");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(base + "/");
  await page.waitForFunction(() => !!(window as unknown as { __musix?: Debug }).__musix);
  await page.evaluate(async (count) => {
    const items: QueueItem[] = Array.from({ length: count }, (_, i) => ({
      trackId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      title: `Длинная очередь ${i + 1}`, artist: "Проверка", contextType: "queue", durationMs: 60000,
    }));
    await (window as unknown as { __musix: Debug }).__musix.player.playTracks(items);
  }, count);
  await page.getByRole("link", { name: "Плеер", exact: true }).first().click();
  await page.locator("[data-player-cover]").waitFor();
  const queue = page.locator('aside[aria-label="Очередь"]');
  await expect(queue.locator("li")).toHaveCount(0);
  await page.getByRole("button", { name: "Открыть очередь", exact: true }).first().click();
  await expect(queue).toBeVisible();
  await expect.poll(() => queue.locator("li").count()).toBeGreaterThan(0);
  expect(await queue.locator("li").count()).toBeLessThan(40);
  const at = (i: number) => queue.locator(`[data-queue-index="${i}"]`);
  await at(2).dragTo(at(1));
  await expect(at(1)).toContainText("Длинная очередь 3");
  await at(1).getByRole("button", { name: "Убрать «Длинная очередь 3» из очереди" }).click();
  await expect(at(1)).toContainText("Длинная очередь 2");
  await at(1).getByRole("button").first().focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => Number(document.activeElement?.closest("[data-queue-index]")?.getAttribute("data-queue-index")))).toBeGreaterThan(12);
  await page.keyboard.press("End");
  const last = at(count - 2);
  await expect(last).toContainText(`Длинная очередь ${count}`);
  await expect(last.getByRole("button").first()).toBeFocused();
  await expect(last).toBeInViewport();
  await page.keyboard.press("ArrowUp");
  await expect(at(count - 3).getByRole("button").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: `Длинная очередь ${count - 1}`, exact: true })).toBeVisible();
  expect(await queue.locator("li").count()).toBeLessThan(40);
  // The closing animation keeps its rows, and reopening retains the scroll position.
  const scroll = queue.getByLabel("Треки в очереди");
  // Selecting a distant item trims played history asynchronously; let the browser clamp
  // the shorter list before comparing a close/reopen at that same queue position.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __musix: Debug }).__musix.usePlayer.getState().queue.length)).toBeLessThan(count - 1);
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop <= el.scrollHeight - el.clientHeight + 1)).toBe(true);
  const top = await scroll.evaluate((el) => el.scrollTop);
  await queue.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Открыть очередь", exact: true }).first().click();
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(top);
  await page.setViewportSize({ width: 840, height: 900 });
  await expect(page.locator('button[aria-keyshortcuts="Shift+Enter"]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(queue.getByRole("button", { name: "Закрыть", exact: true })).toBeInViewport();
  await scroll.evaluate((el) => { el.scrollTop = 0; });
  await queue.locator("li button").first().focus();
  await page.keyboard.press("End");
  await expect(queue.locator("li").filter({ hasText: `Длинная очередь ${count}` })).toBeInViewport();
  expect(await queue.locator("li").count()).toBeLessThan(40);
  expect(errors).toEqual([]);
});
