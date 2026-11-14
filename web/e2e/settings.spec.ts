import { expect, test, type Page } from "@playwright/test";

// Uses the migrated dev account; writes and device revocations are intercepted.
const base = process.env.MUSIX_WEB_URL ?? "http://127.0.0.1:5173";

async function openSettings(page: Page) {
  await page.goto(base + "/login");
  await page.fill("input[type=email]", process.env.MUSIX_EMAIL ?? "mig-owner@example.com");
  await page.fill("input[type=password]", process.env.MUSIX_PASSWORD ?? "mig-pass-123");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(base + "/");
  await page.goto(base + "/settings");
  await expect(page.getByRole("switch", { name: "Выравнивать громкость" })).toBeVisible();
}

test("rapid settings tabs keep the last intent, including returning to the current tab", async ({ page }) => {
  await openSettings(page);
  const rapidly = (names: string[]) => page.getByRole("navigation", { name: "Разделы настроек" }).evaluate(async (nav, tabs) => {
    for (const name of tabs) {
      [...nav.querySelectorAll("button")].find((button) => button.textContent === name)!.click();
      await new Promise((r) => setTimeout(r, 35));
    }
  }, names);
  await rapidly(["Приватность", "Главная", "Звук"]);
  await page.waitForTimeout(800);
  await expect(page.getByRole("heading", { name: "Звук", exact: true })).toBeVisible();
  await expect(page).toHaveURL(base + "/settings");
  await rapidly(["Главная", "Приватность", "Клавиши"]);
  await expect(page.getByRole("heading", { name: "Горячие клавиши", exact: true })).toBeVisible();
  await expect(page).toHaveURL(base + "/settings?tab=keys");
  await page.waitForTimeout(800);
  await expect(page.getByRole("heading", { name: "Горячие клавиши", exact: true })).toBeVisible();
});

test("a refused setting rolls back and a refused device revocation leaves the device visible", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v2/devices", (route) => route.fulfill({ json: [
    { id: "fixture-other", name: "Test phone", platform: "android", appVersion: "2.0", current: false, lastSeenAt: new Date().toISOString() },
  ] }));
  await page.route("**/api/v2/devices/fixture-other", (route) => route.fulfill({ status: 503, json: { detail: "Unavailable" } }));
  await page.route("**/api/v2/settings", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await new Promise((r) => setTimeout(r, 250));
    return route.fulfill({ status: 503, json: { detail: "Unavailable" } });
  });
  await openSettings(page);
  const toggle = page.getByRole("switch", { name: "Выравнивать громкость" });
  const previous = await toggle.getAttribute("aria-checked");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", previous === "true" ? "false" : "true");
  await expect(page.getByRole("status")).toHaveText("Настройка не сохранилась — попробуй ещё раз");
  await expect(toggle).toHaveAttribute("aria-checked", previous!);
  await page.getByRole("navigation", { name: "Разделы настроек" }).getByRole("button", { name: "Устройства" }).click();
  await expect(page.getByText("Test phone", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Отключить", exact: true }).click();
  await page.getByRole("button", { name: "Точно отключить?", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Не удалось отключить устройство — попробуй ещё раз");
  await expect(page.getByText("Test phone", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Отключить", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});
