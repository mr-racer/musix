import { expect, test, type Page } from "@playwright/test";

// The isolated dev API on migrated data; never point these checks at production.
const base = process.env.MUSIX_WEB_URL ?? "http://127.0.0.1:5173";
const email = process.env.MUSIX_EMAIL ?? "mig-owner@example.com";
const password = process.env.MUSIX_PASSWORD ?? "mig-pass-123";

test.use({ colorScheme: "dark" });

async function signIn(page: Page): Promise<void> {
  await page.goto(base + "/login");
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", password);
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(base + "/");
}

async function albumInLibrary(page: Page): Promise<{ href: string; title: string }> {
  await page.goto(base + "/library");
  const link = page.locator('a[href^="/album/"]').first();
  await expect(link).toBeVisible({ timeout: 45_000 });
  return { href: (await link.getAttribute("href"))!, title: await link.locator("b").first().innerText() };
}

async function expectBook(page: Page, title: string): Promise<void> {
  const book = page.getByRole("dialog", { name: title, exact: true });
  await expect(book).toBeVisible();
  await expect(book.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(book.getByRole("button", { name: "Вперемешку" })).toHaveCount(0);
  await expect(book.getByRole("button", { name: "В плейлист", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
}

test("card, new tab and reload all open the book; a direct entry closes to the library", async ({ page, context }) => {
  await signIn(page);
  const album = await albumInLibrary(page);
  const link = page.locator(`a[href="${album.href}"]`).first();
  await link.click();
  await expectBook(page, album.title);
  await expect(page).toHaveURL(base + "/library");
  const lastRowGap = await page.getByRole("dialog").locator("[aria-busy]").evaluate(async (list) => {
    await Promise.allSettled(list.getAnimations({ subtree: true }).map((animation) => animation.finished));
    list.scrollTop = list.scrollHeight;
    const rows = list.querySelectorAll('div[role="button"]');
    return list.getBoundingClientRect().bottom - rows[rows.length - 1]!.getBoundingClientRect().bottom;
  });
  expect(lastRowGap).toBeGreaterThanOrEqual(26); // readable above the bottom fade
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const opened = context.waitForEvent("page");
  await link.click({ modifiers: ["ControlOrMeta"] });
  const tab = await opened;
  await expect(tab).toHaveURL(base + album.href);
  await expectBook(tab, album.title);
  await tab.reload();
  await expectBook(tab, album.title);
  await tab.keyboard.press("Escape");
  await expect(tab).toHaveURL(base + "/library");
  await tab.close();
});

test("Enter in quick search opens in place, shows slow loading and reuses the album query", async ({ page }) => {
  await signIn(page);
  const album = await albumInLibrary(page);
  await page.goto(base + "/");
  let requests = 0;
  await page.route("**/api/v2/albums/*", async (route) => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue();
  });
  const search = page.getByRole("textbox", { name: "Поиск", exact: true });
  const choose = async (): Promise<void> => {
    await search.fill(album.title);
    const options = page.getByRole("option");
    await expect(options.filter({ hasText: album.title }).first()).toBeVisible();
    const index = await options.evaluateAll((rows, title) => rows.findIndex((row) =>
      row.querySelector("b")?.textContent === title && row.lastElementChild?.textContent === "альбом"), album.title);
    expect(index).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < index; i++) await search.press("ArrowDown");
    await search.press("Enter");
  };
  await choose();
  await expect(page.getByRole("status")).toHaveText("Загружаем альбом…", { timeout: 2000 });
  await expect(page.getByRole("status")).toBeVisible({ timeout: 2000 });
  await expectBook(page, album.title);
  await expect(page).toHaveURL(base + "/");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await choose();
  await expectBook(page, album.title);
  expect(requests).toBe(1);
});

test("a routed book swaps albums without remounting and follows its artist without bouncing back", async ({ page }) => {
  await signIn(page);
  const album = await albumInLibrary(page);
  await page.goto(base + album.href);
  await expectBook(page, album.title);
  const book = page.getByRole("dialog");
  const handle = await book.elementHandle();
  const other = book.locator("button[title]").first();
  await expect(other).toBeVisible();
  const before = page.url();
  await other.click();
  await expect(page).not.toHaveURL(before);
  expect(await handle!.evaluate((el) => el === document.querySelector('[role="dialog"]'))).toBe(true);
  const title = await book.getAttribute("aria-label");
  await page.reload();
  await expectBook(page, title!);
  // The artist is the underlined button directly after the album title.
  const artistLink = page.getByRole("dialog").locator("h2 + div > button");
  await expect(artistLink).toBeVisible();
  await artistLink.click();
  await expect(page).toHaveURL(/\/artist\//);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(1100); // a late book-close callback must not undo the navigation
  await expect(page).toHaveURL(/\/artist\//);
});

test("unavailable albums and transient errors stay inside the book; retry loads real data", async ({ page }) => {
  await signIn(page);
  const album = await albumInLibrary(page);
  await page.goto(base + "/album/00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("alert")).toHaveText("Альбом не найден или больше недоступен.");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(base + "/library");

  let offline = true;
  let requests = 0;
  await page.route("**/api/v2/albums/*", async (route) => {
    requests++;
    if (offline) await route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Temporarily unavailable"}' });
    else await route.continue();
  });
  await page.goto(base + album.href);
  await expect(page.getByRole("alert")).toContainText("Не удалось загрузить альбом.");
  expect(requests).toBe(2); // one request and the configured automatic retry
  offline = false;
  await page.getByRole("button", { name: "Попробовать снова" }).click();
  await expectBook(page, album.title);
  expect(requests).toBe(3);
});

test("an unauthenticated album link survives sign-in and closes without a login loop", async ({ page }) => {
  await signIn(page);
  const album = await albumInLibrary(page);
  await page.context().clearCookies();
  await page.goto(base + album.href);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", password);
  await page.locator("button[type=submit]").click();
  await expectBook(page, album.title);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(base + "/library");
});

test("the player opens the book, queue actions work, and close/back/forward preserve navigation", async ({ page }) => {
  await signIn(page);
  const album = await albumInLibrary(page);
  await page.locator(`a[href="${album.href}"]`).first().click();
  await expectBook(page, album.title);
  await page.getByRole("dialog").getByRole("button", { name: "Слушать", exact: true }).click();
  await page.waitForFunction(() => navigator.mediaSession.playbackState === "playing");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Плеер", exact: true }).first().click();
  await page.locator('a[title="Страница альбома"]').click();
  await expectBook(page, album.title);
  await expect(page).toHaveURL(base + album.href);
  const next = page.getByRole("button", { name: "Играть следующим", exact: true }).nth(1);
  await next.locator("..").hover();
  await next.click();
  await expect(page.getByRole("button", { name: "Убрать из очереди", exact: true })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(base + "/player");
  await page.goForward();
  await expectBook(page, album.title);
  await page.goBack();
  await expect(page).toHaveURL(base + "/player");
});


test("the book owns keyboard focus, keeps playback available, and returns focus to its card", async ({ page }) => {
  await signIn(page);
  const album = await albumInLibrary(page);
  const card = page.locator(`a[href="${album.href}"]`).first();
  await card.focus();
  await card.press("Enter");
  const book = page.getByRole("dialog");
  await expect(book).toBeFocused();
  await expect(book).toHaveAttribute("data-open", "");
  // A covered library must not remain in the keyboard or accessibility navigation.
  expect(await card.evaluate((el) => !!el.closest("[inert]"))).toBe(true);
  await page.keyboard.press("Tab");
  expect(await book.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect(book.getByRole("button", { name: "Закрыть", exact: true })).toBeFocused();

  await book.getByRole("button", { name: "Слушать", exact: true }).click();
  const mini = page.locator("[data-mini]");
  await expect(mini).toBeVisible();
  const currentTrack = await mini.locator('a[href="/player"]').textContent();
  // Enter on a nested queue control must queue, not bubble into the row's Play handler.
  const queueButton = book.getByRole("button", { name: "Играть следующим", exact: true }).nth(1);
  await queueButton.focus();
  await page.keyboard.press("Enter");
  await expect(book.getByRole("button", { name: "Убрать из очереди", exact: true })).toHaveCount(1);
  await expect(mini.locator('a[href="/player"]')).toHaveText(currentTrack!);
  await book.getByRole("button", { name: "Закрыть", exact: true }).focus();
  await page.keyboard.press("Tab");
  expect(await mini.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  const lastMiniControl = mini.locator("button").last();
  await lastMiniControl.focus();
  await page.keyboard.press("Tab");
  expect(await book.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(book).toHaveCount(0);
  await expect(card).toBeFocused();
  expect(await card.evaluate((el) => !!el.closest("[inert]"))).toBe(false);
});

test("an open book fits resize, orientation and a new mini player without losing its queue or focus", async ({ page }) => {
  // Hold then fail the real playback request: the bar first appears at its normal
  // height, then grows with the recovery message while the same book stays open.
  let releaseManifest!: () => void;
  const heldManifest = new Promise<void>((resolve) => { releaseManifest = resolve; });
  await page.route("**/api/v2/playback/manifest", async (route) => {
    await heldManifest;
    await route.fulfill({ status: 503, json: { detail: "Unavailable" } });
  });
  await signIn(page);
  const album = await albumInLibrary(page);
  await page.locator(`a[href="${album.href}"]`).first().click();
  const book = page.getByRole("dialog");
  const handle = await book.elementHandle();
  // Resize even before the opening has finished: its old delayed unfold must not win.
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(book).toHaveAttribute("data-open", "");
  await book.getByRole("button", { name: "Слушать", exact: true }).click();
  const mini = page.locator("[data-mini]");
  await expect(mini).toBeVisible();
  const queued = book.getByRole("button", { name: "Играть следующим", exact: true }).nth(1);
  await queued.focus();
  await page.keyboard.press("Enter");
  const queuedKey = await book.getByRole("button", { name: "Убрать из очереди", exact: true }).getAttribute("data-gf-focus");
  const fits = async () => {
    await expect.poll(() => book.evaluate((el) => {
      const book = el.getBoundingClientRect(), bar = document.querySelector("[data-mini]")!.getBoundingClientRect();
      const pages = [...el.querySelectorAll<HTMLElement>("[class*='face'], [class*='leaf_']")].map((page) => page.getBoundingClientRect());
      return book.top >= -1 && book.bottom <= bar.top + 1 && pages.every((page) => page.left >= -1 && page.right <= innerWidth + 1);
    })).toBe(true);
  };
  await fits();
  releaseManifest();
  await expect(mini.getByRole("alert")).toBeVisible();
  expect((await mini.boundingBox())!.height).toBeGreaterThan(86);
  await fits();
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await fits();
    // Resize can replace the poster between locator resolution and evaluation. Allow a
    // committed frame, but not the old 450 ms entrance delay after every breakpoint.
    await expect.poll(() => book.locator("h2").evaluate((el) => getComputedStyle(el.parentElement!).opacity), { timeout: 250, intervals: [16, 32, 50] }).toBe("1");
    expect(await handle!.evaluate((el) => el === document.querySelector('[role="dialog"]'))).toBe(true);
    const selected = book.locator(`[data-gf-focus="${queuedKey}"]`);
    await expect(selected).toHaveAttribute("data-n", "1");
    await expect(selected).toBeFocused();
  }
  await page.keyboard.press("Escape");
  await expect(book).toHaveCount(0);
});
