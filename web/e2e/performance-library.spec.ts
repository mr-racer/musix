import { expect, test, type Page } from "@playwright/test";

const base = process.env.MUSIX_WEB_URL ?? "http://127.0.0.1:5173";
const track = (id: string, title: string) => ({
  id, title, titleDisplay: null, artistDisplay: "Fixture", artists: [{ id: "fixture-artist", name: "Fixture", role: "primary" }],
  albumId: null, album: null, year: 1960, genre: null, trackNo: 1, discNo: 1, durationMs: 1000, coverImageId: null, addedAt: "2026-09-30T00:00:00Z",
});

async function login(page: Page) {
  await page.goto(base + "/login");
  await page.fill("input[type=email]", process.env.MUSIX_EMAIL ?? "mig-owner@example.com");
  await page.fill("input[type=password]", process.env.MUSIX_PASSWORD ?? "mig-pass-123");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(base + "/");
}

test("a 500-song artist keeps the arrival stagger bounded", async ({ page }) => {
  const tracks = Array.from({ length: 500 }, (_, i) => track(`fixture-${i}`, `Fixture song ${i + 1}`));
  await page.route("**/api/v2/artists/fixture-artist/page", (route) => route.fulfill({ json: {
    artist: { id: "fixture-artist", name: "Fixture", sortName: "fixture", imageId: null },
    albums: [], topTracks: tracks, trackCount: 500, images: {}, facts: [], heard: {}, plays: {},
  } }));
  await page.route("**/api/v2/artists/fixture-artist/bio", (route) => route.fulfill({ json: { text: "", facets: {} } }));
  await login(page);
  await page.goto(base + "/artist/fixture-artist");
  await page.getByRole("button", { name: "Все 500 песен" }).click();
  const last = page.getByRole("button").filter({ hasText: "Fixture song 500" });
  const delay = await last.evaluate((el) => parseFloat(getComputedStyle(el).animationDelay));
  expect(delay).toBeLessThanOrEqual(0.25);
  await last.scrollIntoViewIfNeeded();
  await expect.poll(() => last.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
});

test("both open searches follow sync and arrow selection does not rescan the library", async ({ page }) => {
  const initial = Array.from({ length: 100 }, (_, i) => ({ entity: "track", id: `fixture-${i}`, op: "upsert", data: track(`fixture-${i}`, i < 8 ? `Needle scan fixture ${i}` : `Unused scan fixture ${i}`) }));
  await page.route("**/api/v2/sync?**", (route) => route.fulfill({ json: { changes: initial, cursor: "fixture", hasMore: false } }));
  await login(page);
  await page.goto(base + "/library");
  await page.getByRole("button", { name: "Поиск по библиотеке", exact: true }).click();
  const search = page.getByRole("searchbox");
  await search.fill("Needle");
  await expect(page.getByRole("listbox")).toContainText("Needle scan fixture");
  await page.evaluate(() => {
    const original = String.prototype.toLowerCase;
    (window as any).__unusedScans = 0;
    String.prototype.toLowerCase = function () {
      if (String(this).startsWith("Unused scan fixture")) (window as any).__unusedScans++;
      return original.call(this);
    };
  });
  for (let i = 0; i < 20; i++) await search.press("ArrowDown");
  expect(await page.evaluate(() => (window as any).__unusedScans)).toBe(0);

  const apply = (changes: unknown[]) => page.evaluate(async (changes) => {
    const path = "/src/api/sync.ts";
    const { sync } = await import(path);
    await sync(async () => ({ changes, cursor: "fixture-next", hasMore: false }));
  }, changes);
  await search.fill("Newly synced");
  await expect(page.getByRole("listbox")).toContainText("Ничего не нашлось");
  await apply([{ entity: "track", id: "fresh", op: "upsert", data: track("fresh", "Newly synced song") }]);
  await expect(page.getByRole("listbox")).toContainText("Newly synced song");
  await page.goto(base + "/");
  const home = page.getByRole("textbox", { name: "Поиск", exact: true });
  await home.fill("Newly synced");
  await expect(page.getByRole("listbox")).toContainText("Newly synced song");
  await apply([{ entity: "track", id: "fresh", op: "delete", data: null }]);
  await expect(page.getByRole("listbox")).not.toContainText("Newly synced song");
  await expect(page.getByRole("listbox")).toContainText("В библиотеке такого нет");
});

test("a library group jump cannot scroll the next page after unmount", async ({ page }) => {
  await login(page);
  await page.goto(base + "/library?sort=az");
  await expect(page.getByLabel("Перейти к группе", { exact: true })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-nav", /.+/);
  await page.evaluate(() => {
    const scroll = window.scrollTo.bind(window);
    (window as any).__lateLibraryScroll = [];
    window.scrollTo = ((...args: any[]) => {
      const y = typeof args[0] === "object" ? args[0].top ?? 0 : args[1] ?? 0;
      if (!document.querySelector("[data-bar]") && y > 0) (window as any).__lateLibraryScroll.push(y);
      (scroll as any)(...args);
    }) as typeof window.scrollTo;
  });
  const segment = page.getByLabel("Перейти к группе", { exact: true }).locator(":scope > div").last();
  const box = (await segment.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole("link", { name: "Главная", exact: true }).evaluate((el: HTMLAnchorElement) => el.click());
  await expect(page).toHaveURL(base + "/");
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as any).__lateLibraryScroll)).toEqual([]);
});
