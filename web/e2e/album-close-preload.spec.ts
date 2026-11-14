import { expect, test, type Page } from "@playwright/test";

// The migrated dev snapshot; these checks never visit the library before the album.
const base = process.env.MUSIX_WEB_URL ?? "http://127.0.0.1:5173";
const albumPath = "/album/01a0f21a-38af-7e48-89d2-2ccd8d0b8676";
const summaryPath = "/api/v2/library/summary";
const statsPath = "/api/v2/stats";

test.use({ colorScheme: "dark", reducedMotion: "no-preference", serviceWorkers: "block" });

async function signIn(page: Page) {
  await page.goto(base + "/login");
  await page.locator("input[type=email]").fill(process.env.MUSIX_EMAIL ?? "mig-owner@example.com");
  await page.locator("input[type=password]").fill(process.env.MUSIX_PASSWORD ?? "mig-pass-123");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(base + "/");
}

function watchLibrary(page: Page) {
  const requests: { path: string; from: string }[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === summaryPath || path === statsPath) {
      requests.push({ path, from: new URL(page.url()).pathname });
    }
  });
  return requests;
}

async function directAlbum(page: Page) {
  await page.goto(base + albumPath);
  const book = page.getByRole("dialog", { name: "Graduation", exact: true });
  await expect(book).toBeVisible();
  await expect(book).toHaveAttribute("data-open", "");
  return book;
}

test("a direct album starts its library destination during explicit close, not on opening", async ({ page }) => {
  await signIn(page);
  const requests = watchLibrary(page);
  await directAlbum(page);
  expect(requests).toEqual([]);

  const loading = Promise.all([summaryPath, statsPath].map((path) =>
    page.waitForRequest((request) => new URL(request.url()).pathname === path)));
  await page.keyboard.press("Escape");
  await loading;
  // Before the fix these calls started only after the animation, on the /library URL.
  expect(requests.find((request) => request.path === summaryPath)?.from).toBe(albumPath);
  expect(requests.find((request) => request.path === statsPath)?.from).toBe(albumPath);
  await expect(page).toHaveURL(base + "/library");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('a[href^="/album/"]').first()).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(1000); // the loader's delayed refresh must reuse the warm queries
  expect(requests.filter((request) => request.path === summaryPath)).toHaveLength(1);
  expect(requests.filter((request) => request.path === statsPath)).toHaveLength(1);
});

test("leaving a direct album for its artist does not preload the library", async ({ page }) => {
  await signIn(page);
  const requests = watchLibrary(page);
  const book = await directAlbum(page);
  expect(requests).toEqual([]);
  await book.locator("h2 + div > button").click();
  await expect(page).toHaveURL(/\/artist\//);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(1100); // includes the book's remaining close callback and loader refresh
  await expect(page).toHaveURL(/\/artist\//);
  expect(requests).toEqual([]);
});
