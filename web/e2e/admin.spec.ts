import { expect, test } from "@playwright/test";

// Needs a FRESH instance (setup not done): `MUSIX_WEB_URL` = a Vite server whose MUSIX_API
// points at an api on an empty, migrated database (the phase 5 ledger has the recipe).
const base = process.env.MUSIX_WEB_URL ?? "http://127.0.0.1:5174";

test("setup → invite → a member registers, never loads the admin, and gets 403 from it", async ({ browser }) => {
  const owner = await browser.newPage();
  await owner.goto(base + "/");
  await expect(owner).toHaveURL(/\/setup/);
  await owner.fill("input[type=email]", "owner@web.test");
  await owner.fill("input[type=password]", "owner-pass-123");
  await owner.getByRole("button", { name: "Создать сервер" }).click();
  await expect(owner.getByText("Первый запуск · шаг 2 из 3")).toBeVisible();
  await owner.getByRole("button", { name: "Пропустить" }).click();
  await owner.getByRole("button", { name: "Пропустить" }).click();
  await expect(owner).toHaveURL(/\/admin$/);

  await owner.getByRole("button", { name: "Создать инвайт" }).click();
  const link = (await owner.locator("text=/\\/login\\?invite=/").first().textContent())!.trim();
  expect(link).toContain("/login?invite=");

  // the friend: a separate browser context (their own cookie jar)
  const ctx = await browser.newContext();
  const friend = await ctx.newPage();
  const scripts: string[] = [];
  friend.on("request", (r) => r.resourceType() === "script" && scripts.push(r.url()));
  await friend.goto(link.replace(/^https?:\/\/[^/]+/, base));
  await friend.fill("input[type=email]", "friend@web.test");
  await friend.fill("input[type=password]", "friend-pass-123");
  await friend.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(friend).toHaveURL(base + "/");
  await expect(friend.getByRole("link", { name: /Админ/ })).toHaveCount(0);
  await friend.goto(base + "/admin");
  await expect(friend).toHaveURL(base + "/"); // redirected before the admin loads
  expect(scripts.filter((u) => /\/routes\/_app\/admin|admin[.-][\w-]+\.js/.test(u))).toEqual([]);
  const status = await friend.evaluate(async () => {
    const t = await fetch("/api/v2/auth/refresh", { method: "POST" }).then((r) => r.json());
    return (await fetch("/api/v2/admin/members", { headers: { authorization: `Bearer ${t.accessToken}` } })).status;
  });
  expect(status).toBe(403);

  // the owner sees the friend — as counts
  await owner.reload();
  await expect(owner.getByText("friend@web.test").first()).toBeVisible();
  await ctx.close();
});
