import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";

const base = process.env.MUSIX_WEB_URL ?? "http://127.0.0.1:5173";
const longFact = "Во время записи музыканты меняли аранжировку, переслушивали отдельные партии и выбирали звучание, которое лучше передавало историю песни. ".repeat(10) + "Конец полного факта.";

// The migrated dev album has audio; synthetic bands isolate layout from missing analysis.
function spectrum(): Buffer {
  const frames = 240, bands = 16, packed = Buffer.alloc(frames * bands);
  for (let b = 0; b < bands; b++) {
    let prev = 0;
    for (let f = 0; f < frames; f++) {
      const value = Math.round(185 + 55 * Math.sin(f / 5 + b));
      packed[b * frames + f] = (value - prev + 256) % 256;
      prev = value;
    }
  }
  return Buffer.concat([Buffer.from([77, 88, 83, 50, 30, bands]), deflateSync(packed)]);
}

test("full facts remain readable while the centred cover and spectrum keep their space", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/v2/tracks/*/spectrum?**", (route) => route.fulfill({ body: spectrum(), contentType: "application/octet-stream" }));
  await page.route("**/api/v2/player/context/*", async (route) => {
    const response = await route.fetch(), data = await response.json();
    data.knowledge = {
      ...data.knowledge,
      vibe: "Плотная аранжировка с несколькими партиями, большим составом музыкантов и длинной историей записи.",
      producers: Array.from({ length: 5 }, (_, i) => ({ text: `Продюсер ${i + 1}`, artistId: null })),
      songFacts: [{ text: longFact, labels: ["creation"], confirmed: true }, { text: "Короткий факт.", labels: ["sound"], confirmed: true }],
      artistFacts: [{ text: "История артиста.", labels: ["band_history"], confirmed: true }],
    };
    await route.fulfill({ response, json: data });
  });
  await page.goto(base + "/login");
  await page.fill("input[type=email]", process.env.MUSIX_EMAIL ?? "mig-owner@example.com");
  await page.fill("input[type=password]", process.env.MUSIX_PASSWORD ?? "mig-pass-123");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(base + "/");
  await page.goto(base + "/album/01a0f21a-38af-7e48-89d2-2ccd8d0b8676");
  await page.getByRole("dialog").getByRole("button", { name: "Слушать", exact: true }).click();
  await page.waitForFunction(() => navigator.mediaSession.playbackState === "playing");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Плеер", exact: true }).first().click();
  const column = page.getByRole("region", { name: "О текущем треке" });
  await expect(column).toBeVisible();
  for (const size of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1512, height: 982 }, { width: 2560, height: 1440 }]) {
    await page.setViewportSize(size);
    await expect.poll(async () => page.evaluate(() => {
      const col = document.querySelector<HTMLElement>('[aria-label="О текущем треке"]')!;
      const art = document.querySelector<HTMLElement>("[data-player-cover]")!;
      const canvas = document.querySelector<HTMLCanvasElement>('[role="slider"] canvas')!;
      if (!col || !art || !canvas) return false; // the spectrum mounts after the cover's entrance
      const a = art.getBoundingClientRect(), c = col.getBoundingClientRect(), wave = canvas.getBoundingClientRect();
      return Math.abs(a.y + a.height / 2 - c.y - c.height / 2) < 2 && wave.height >= 56 && wave.top >= Math.max(a.bottom, c.bottom) && document.documentElement.scrollHeight <= innerHeight + 1;
    })).toBe(true);
    const fact = column.locator('p:not([data-sizer])').filter({ hasText: "Конец полного факта." });
    await expect(fact).toBeVisible();
    expect(await fact.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    // Credits and the incoming fact can still settle after a viewport change. Scroll
    // the actual populated column and check that the last line can reach its viewport.
    await expect.poll(() => fact.evaluate((el) => {
      const col = el.closest<HTMLElement>('[data-player-info]')!;
      col.scrollTop = col.scrollHeight;
      return el.getBoundingClientRect().bottom <= col.getBoundingClientRect().bottom + 1;
    })).toBe(true);
    const before = await page.locator("[data-player-cover]").boundingBox();
    await column.getByRole("button", { name: "Следующий факт" }).click();
    const after = await page.locator("[data-player-cover]").boundingBox();
    expect(after!.y).toBeCloseTo(before!.y, 0);
    await column.getByRole("button", { name: "Предыдущий факт" }).click();
    await fact.evaluate(async (el) => { await Promise.all(el.getAnimations().map((a) => a.finished)); });
    await column.evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({ path: `/tmp/musix-player-fixed-${size.width}.png` });
  }
  // Select the next UI item without relying on the snapshot's missing next audio file.
  await page.setViewportSize({ width: 1280, height: 720 });
  await column.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  expect(await column.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.evaluate(() => {
    // Use the mounted app's store: a bare module import after Vite HMR can create
    // a second engine instead of selecting the next item in the visible player.
    const { usePlayer } = (window as unknown as { __musix: { usePlayer: {
      getState: () => { index: number }; setState: (state: { index: number }) => void;
    } } }).__musix;
    usePlayer.setState({ index: usePlayer.getState().index + 1 });
  });
  await expect.poll(() => column.evaluate((el) => el.scrollTop)).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[role="slider"] canvas')).toHaveCount(0);
  await page.getByRole("button", { name: "Открыть факты, титры и семплы" }).click();
  const about = page.getByRole("complementary", { name: "О песне", exact: true });
  await expect(about).toBeVisible();
  await expect(about.locator('p:not([data-sizer])').filter({ hasText: "Конец полного факта." })).toBeVisible();
  expect(errors).toEqual([]);
});
