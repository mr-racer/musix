import { deflateSync } from "node:zlib";
import { expect, test, type Locator, type Page } from "@playwright/test";

const base = process.env.MUSIX_WEB_URL ?? "http://127.0.0.1:5173";

async function login(page: Page) {
  await page.goto(base + "/login");
  await page.locator("input[type=email]").fill(process.env.MUSIX_EMAIL ?? "mig-owner@example.com");
  await page.locator("input[type=password]").fill(process.env.MUSIX_PASSWORD ?? "mig-pass-123");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(base + "/");
}

// Composite solid ancestor fills. Photographic backgrounds are reviewed in browser captures;
// these assertions cover the actual regressions in labels and primary transport controls.
async function contrast(locator: Locator) {
  return locator.evaluate((el) => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.canvas.width = ctx.canvas.height = 1;
    const rgba = (color: string) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).map((n, i) => i === 3 ? n / 255 : n);
    };
    const over = (top: number[], bottom: number[]) => top.slice(0, 3).map((n, i) => n * top[3]! + bottom[i]! * (1 - top[3]!)).concat(1);
    const chain: Element[] = [];
    for (let p: Element | null = el; p; p = p.parentElement) chain.unshift(p);
    let bg = [255, 255, 255, 1];
    for (const p of chain) bg = over(rgba(getComputedStyle(p).backgroundColor), bg);
    const fg = over(rgba(getComputedStyle(el).color), bg);
    const lum = (c: number[]) => c.slice(0, 3).map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i]!, 0);
    const a = lum(fg), b = lum(bg);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
}

test("theme controls work with the keyboard, system changes and unavailable storage", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await login(page);
  const button = page.locator("button[aria-keyshortcuts]");
  await button.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(button).toHaveAttribute("aria-label", "Включить тёмную");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await button.focus();
  await page.keyboard.press("Shift+Enter");
  await expect(button).toHaveAttribute("aria-label", /Как в системе/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  // A blocked preference write must still change the current session.
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "musix.theme") throw new DOMException("Blocked", "SecurityError");
      return original.call(this, key, value);
    };
  });
  await button.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(button).toHaveAttribute("aria-label", "Включить светлую");
});

test("library metadata and play glyphs remain readable in both themes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  await page.goto(base + "/library?tab=stats");
  const label = page.getByRole("heading", { name: "Портрет слушателя", exact: true });
  await expect(label).toBeVisible();
  const play = page.getByRole("button", { name: "Слушать", exact: true }).first();
  for (const theme of ["light", "dark"]) {
    if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator("button[aria-keyshortcuts]").click();
    expect(await contrast(label)).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(play)).toBeGreaterThanOrEqual(4.5);
  }
});

test("player sheets and paused canvases follow a live system theme change", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
  await page.route("**/api/v2/tracks/*/spectrum?**", (route) => route.fulfill({
    contentType: "application/octet-stream",
    body: Buffer.concat([Buffer.from([77, 88, 83, 50, 30, 16]), deflateSync(Buffer.alloc(240 * 16, 1))]),
  }));
  await page.route("**/api/v2/tracks/*/sound", (route) => route.fulfill({ json: {
    ver: 1, hasStage: false, ratings: { tech: 55, space: 70, odd: 40, facets: {} },
    echo: { key: "room", label: "в комнате" }, width: { key: "wide", label: "широкая сцена" },
    pace: null, feel: null, drums: null, vocals: null, signature: "Проверка читаемости сцены.",
    instruments: [{ key: "piano", label: "фортепиано" }], moments: [], sections: [], traits: [], stems: [],
    stage: [{ stem: "piano", name: { key: "piano", label: "фортепиано" }, entries: [] }],
  } }));
  await login(page);
  await page.goto(base + "/album/01a0f21a-38af-7e48-89d2-2ccd8d0b8676");
  await page.getByRole("dialog").getByRole("button", { name: "Слушать", exact: true }).click();
  await page.waitForFunction(() => navigator.mediaSession.playbackState === "playing");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Плеер", exact: true }).first().click();
  await page.getByRole("region", { name: "О текущем треке" }).waitFor();
  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  await page.getByTitle("Звук песни", { exact: true }).click();
  const sound = page.getByRole("complementary", { name: "Звук песни" });
  await expect(sound).toBeVisible();
  const stage = sound.locator("canvas"), wave = page.locator('[role="slider"] canvas');
  const pixels = (canvas: Locator) => canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(800);
  const darkStage = await pixels(stage), darkWave = await pixels(wave);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => pixels(stage)).not.toBe(darkStage);
  await expect.poll(() => pixels(wave)).not.toBe(darkWave);
  await page.waitForTimeout(800);
  await page.screenshot({ path: test.info().outputPath("player-sound-light.png") });
  expect(await sound.evaluate((el) => getComputedStyle(el).getPropertyValue("--mx-text").trim())).toBe("#161620");
  await sound.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Открыть очередь", exact: true }).first().click();
  const queue = page.getByRole("complementary", { name: "Очередь", exact: true });
  await expect(queue).toBeVisible();
  expect(await contrast(queue.locator("header b, [class*='winHead'] b").first())).toBeGreaterThanOrEqual(7);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Главная", exact: true }).first().click();
  const mini = page.getByRole("region", { name: "Сейчас играет" });
  await expect(mini).toBeVisible();
  expect(await contrast(mini.getByRole("button", { name: "Играть", exact: true }))).toBeGreaterThanOrEqual(7);
  expect(errors).toEqual([]);
});
