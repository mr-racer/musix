import { expect, test } from "@playwright/test";

// Needs the dev stack on the migrated data: `make web-dev` (Vite → api-snap) or a preview of
// the build with MUSIX_API=http://127.0.0.1:18010; the migrated owner's dev login.
const base = process.env.MUSIX_WEB_URL ?? "http://127.0.0.1:5173";
const email = process.env.MUSIX_EMAIL ?? "mig-owner@example.com";
const password = process.env.MUSIX_PASSWORD ?? "mig-pass-123";

test("sign in → «Поток» plays → the listen reaches the server once the track ends", async ({ page }) => {
  await page.goto(base + "/login");
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", password);
  await page.getByRole("button", { name: "Войти" }).last().click();
  await expect(page).toHaveURL(base + "/");

  await page.getByRole("button", { name: "Включить поток" }).first().click();
  await page.waitForFunction(() => navigator.mediaSession.playbackState === "playing", null, { timeout: 30_000 });
  const first = await page.evaluate(() => navigator.mediaSession.metadata?.title);
  await page.waitForTimeout(4000); // four seconds actually heard

  // skip ahead to the last seconds: the boundary ends the listen, the outbox flushes it
  const batch = page.waitForResponse((r) => r.url().includes("/events/listens:batch") && r.request().method() === "POST", { timeout: 40_000 });
  await page.getByRole("link", { name: /Плеер/ }).first().click();
  const slider = page.getByRole("slider", { name: "Позиция" });
  await slider.click({ position: { x: (await slider.boundingBox())!.width - 2, y: 10 } });
  await page.waitForFunction((t) => navigator.mediaSession.metadata?.title !== t, first, { timeout: 30_000 });
  const res = await batch;
  expect(res.status()).toBe(200);
  const out = await res.json();
  expect(out.accepted + out.duplicates).toBeGreaterThanOrEqual(1);
  const sent = (res.request().postDataJSON() as { events: { playedMs: number; endReason: string }[] }).events[0]!;
  expect(sent.playedMs).toBeGreaterThanOrEqual(3000); // heard time, not the jump
  expect(sent.playedMs).toBeLessThan(30_000);
});
