import { expect, test, type Locator, type Page } from "@playwright/test";

// Uses the migrated dev library. Yandex reads are fixtures; its mutations never reach a server.
const base = process.env.MUSIX_WEB_URL ?? "http://127.0.0.1:5173";

async function login(page: Page) {
  await page.goto(base + "/login");
  await page.fill("input[type=email]", process.env.MUSIX_EMAIL ?? "mig-owner@example.com");
  await page.fill("input[type=password]", process.env.MUSIX_PASSWORD ?? "mig-pass-123");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(base + "/");
}

async function yandexFixture(page: Page, linked = false) {
  const writes: string[] = [];
  await page.route("**/api/v2/imports/yandex**", (route) => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== "GET") {
      writes.push(request.method() + " " + url.pathname);
      return route.fulfill({ status: 503, json: { detail: "Fixture blocks mutations" } });
    }
    const sources = [
      { source: "likes", title: "Мне нравится", trackCount: 2, playlistId: "fixture-mirror", syncedAt: "2026-10-01T00:00:00Z" },
      { source: { kind: 42 }, title: "Длинное название плейлиста для узкого экрана", trackCount: 2 },
    ];
    const json = url.pathname.endsWith("/sources") ? sources
      : url.pathname.endsWith("/fresh") ? [{ source: "likes", fresh: 0 }]
      : url.pathname.endsWith("/tracks") ? [
        { id: "one", title: "Первая песня", artists: ["Артист"], durationMs: 180000, available: true, imported: false, state: "new" },
        { id: "two", title: "Вторая песня", artists: ["Артист"], durationMs: 220000, available: true, imported: false, state: "new" },
      ] : { linked, login: linked ? "Fixture" : null };
    return route.fulfill({ json });
  });
  return writes;
}

async function inside(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

for (const width of [320, 390, 768]) {
  test(`library tools, tabs and import picker remain reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = await yandexFixture(page, true);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await login(page);
    await page.goto(base + "/library");
    const section = page.getByRole("group", { name: "Раздел", exact: true });
    // Tabs may scroll horizontally, but every tab can be brought fully into view.
    const stats = section.getByRole("button", { name: "Статистика", exact: true });
    await stats.scrollIntoViewIfNeeded();
    await stats.click();
    await expect(stats).toHaveAttribute("aria-pressed", "true");
    await inside(page, stats);
    await section.getByRole("button", { name: /^Альбомы/ }).click();
    await expect(page).toHaveURL(/tab=albums/);
    await expect(page.locator("html")).not.toHaveAttribute("data-nav", /.+/);

    const sort = page.locator("[data-bar] [data-tool][aria-haspopup='menu']");
    await inside(page, sort);
    await sort.click();
    await inside(page, page.getByRole("menu"));
    await page.getByRole("menuitemradio", { name: /^А–Я/ }).click();
    await expect(page).toHaveURL(/sort=az/);
    await expect(page.locator("html")).not.toHaveAttribute("data-nav", /.+/);
    await page.getByRole("button", { name: "Строками", exact: true }).click();
    await expect(page).toHaveURL(/view=rows/);
    await expect(page.locator("html")).not.toHaveAttribute("data-nav", /.+/);

    const search = page.getByRole("button", { name: "Поиск по библиотеке", exact: true });
    await inside(page, search);
    await search.click();
    await page.getByRole("searchbox", { name: "Поиск по библиотеке" }).fill("no-such-track-fixture");
    await inside(page, page.getByRole("searchbox"));
    await inside(page, page.getByRole("listbox"));
    await expect(page.getByRole("listbox")).toContainText("Ничего не нашлось");
    await page.getByRole("button", { name: "Закрыть поиск" }).click();
    await expect(page.getByRole("searchbox")).toBeHidden();

    const add = page.getByRole("button", { name: "Добавить музыку", exact: true });
    await inside(page, add);
    await add.click();
    await inside(page, page.getByRole("menu"));
    await page.getByRole("menuitem", { name: "Из Яндекс Музыки" }).click();
    const dialog = page.getByRole("dialog", { name: "Яндекс Музыка" });
    await inside(page, dialog);
    await expect(dialog.getByText("Можно перенести", { exact: false })).toBeVisible();
    await dialog.getByRole("button", { name: "Выбрать песни", exact: true }).click();
    const input = dialog.getByRole("textbox", { name: "Найти в плейлисте" });
    await inside(page, input);
    await input.fill("Первая");
    await expect(dialog.getByText("Первая песня", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Выбрать найденные" }).click();
    await expect(dialog.getByRole("button", { name: "Перенести", exact: true })).toBeEnabled();
    await inside(page, dialog.getByRole("button", { name: "Перенести", exact: true }));
    await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("Yandex intent survives a delayed lazy import and follows same-route Back and Forward", async ({ page }) => {
  const writes = await yandexFixture(page);
  await login(page);
  let release!: () => void;
  const chunkReady = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route("**/src/library/YandexWindow.tsx*", async (route) => {
    requested = true;
    await chunkReady;
    await route.continue();
  });
  await page.goto(base + "/library?add=yandex");
  await expect.poll(() => requested).toBe(true);
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(base + "/library?add=yandex");
  release();
  const dialog = page.getByRole("dialog", { name: "Яндекс Музыка" });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(700);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page).toHaveURL(base + "/library");
  await expect(dialog).toBeHidden();
  const open = async () => {
    await page.getByRole("button", { name: "Добавить музыку", exact: true }).click();
    await page.getByRole("menuitem", { name: "Из Яндекс Музыки" }).click();
    await expect(page).toHaveURL(base + "/library?add=yandex");
    await expect(dialog).toBeVisible();
  };
  await open();
  await page.goBack();
  await expect(dialog).toBeHidden();
  await page.goForward();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(base + "/library");
  await expect(dialog).toBeHidden();
  // A route change during the closing animation must cancel its pending history callback.
  await open();
  await page.keyboard.press("Escape");
  await page.goBack();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(base + "/library");
  expect(writes).toEqual([]);
});

test("settings connect opens Yandex and browser Back returns to settings", async ({ page }) => {
  const writes = await yandexFixture(page);
  await login(page);
  await page.goto(base + "/settings");
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page).toHaveURL(base + "/library?add=yandex");
  await expect(page.getByRole("dialog", { name: "Яндекс Музыка" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(base + "/settings");
  await expect(page.getByRole("dialog", { name: "Яндекс Музыка" })).toBeHidden();
  expect(writes).toEqual([]);
});
