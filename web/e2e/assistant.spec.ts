import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

// Needs the migrated dev account, but all assistant turns and socket events are simulated.
const base = process.env.MUSIX_WEB_URL ?? "http://127.0.0.1:5173";

async function openAssistant(page: Page) {
  await page.route("**/api/v2/assistant/home?**", (route) => route.fulfill({ json: { orbit: [], cards: [], sky: [], images: {} } }));
  await page.goto(base + "/login");
  await page.fill("input[type=email]", process.env.MUSIX_EMAIL ?? "mig-owner@example.com");
  await page.fill("input[type=password]", process.env.MUSIX_PASSWORD ?? "mig-pass-123");
  await page.getByRole("button", { name: "Войти", exact: true }).last().click();
  await expect(page).toHaveURL(base + "/");
  await page.goto(base + "/assistant");
}

const answer = (text: string) => ({ status: "done", result: { intent: "general", answer: { answer: text }, next: [] }, images: {}, tracks: {} });

test("a completion received before POST returns renders the answer and stops polling", async ({ page }) => {
  let socket: WebSocketRoute | undefined, reads = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.routeWebSocket("**/api/v2/ws", (ws) => {
    socket = ws;
    ws.onMessage(() => ws.send(JSON.stringify({ type: "ready", seq: 0 })));
  });
  await page.route("**/api/v2/assistant/turns", async (route) => {
    socket!.send(JSON.stringify({ type: "assistant.done", turnId: "early", status: "done" }));
    // Deliver the socket event while the POST response is still in flight.
    await page.waitForTimeout(150);
    await route.fulfill({ json: { turnId: "early" } });
  });
  await page.route("**/api/v2/assistant/turns/early", (route) => {
    reads++;
    return route.fulfill({ json: answer("Ответ пришёл раньше подтверждения запроса") });
  });
  await openAssistant(page);
  await page.getByRole("textbox", { name: "Запрос ассистенту" }).fill("Проверка раннего ответа");
  await page.getByRole("button", { name: "Спросить", exact: true }).click();
  await expect(page.locator(".answer")).toContainText("Ответ пришёл раньше подтверждения запроса");
  await expect(page.locator(".mx-asst")).not.toHaveClass(/working/);
  await page.waitForTimeout(3200); // longer than one poll: a settled turn must stay stopped
  expect(reads).toBe(1);
  expect(errors).toEqual([]);
});

test("reset stops the old turn without interrupting the next turn", async ({ page }) => {
  let socket: WebSocketRoute | undefined, turns = 0, oldReads = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.routeWebSocket("**/api/v2/ws", (ws) => {
    socket = ws;
    ws.onMessage(() => ws.send(JSON.stringify({ type: "ready", seq: 0 })));
  });
  await page.route("**/api/v2/assistant/turns", (route) => route.fulfill({ json: { turnId: ++turns === 1 ? "old" : "new" } }));
  await page.route("**/api/v2/assistant/turns/old", (route) => {
    oldReads++;
    return route.fulfill({ json: answer("Старый ответ") });
  });
  await page.route("**/api/v2/assistant/turns/new", (route) => route.fulfill({ json: answer("Ответ на новый вопрос") }));
  await openAssistant(page);
  const ask = async (text: string) => {
    await page.getByRole("textbox", { name: "Запрос ассистенту" }).fill(text);
    const posted = page.waitForResponse((r) => r.url().endsWith("/assistant/turns") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Спросить", exact: true }).click();
    await posted;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  };
  await ask("Старый вопрос");
  await page.keyboard.press("Escape");
  await ask("Новый вопрос");
  socket!.send(JSON.stringify({ type: "assistant.done", turnId: "old", status: "done" }));
  socket!.send(JSON.stringify({ type: "assistant.done", turnId: "new", status: "done" }));
  await expect(page.locator(".answer")).toContainText("Ответ на новый вопрос");
  await page.waitForTimeout(3200);
  expect(oldReads).toBe(0);
  expect(errors).toEqual([]);
});
