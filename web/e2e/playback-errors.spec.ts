import { expect, test, type Page } from "@playwright/test";

const base = process.env.MUSIX_WEB_URL ?? "http://127.0.0.1:5173";
const album = "01a0f21a-38af-7e48-89d2-2ccd8d0b8676";
async function login(page: Page) {
  await page.goto(base + "/login");
  await page.locator("input[type=email]").fill(process.env.MUSIX_EMAIL ?? "mig-owner@example.com");
  await page.locator("input[type=password]").fill(process.env.MUSIX_PASSWORD ?? "mig-pass-123");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(base + "/");
}

// Local PCM keeps the recovery check independent of missing media in the dev snapshot.
function wav() {
  const rate = 8000, samples = rate * 12, body = Buffer.alloc(44 + samples * 2);
  body.write("RIFF", 0); body.writeUInt32LE(body.length - 8, 4); body.write("WAVEfmt ", 8);
  body.writeUInt32LE(16, 16); body.writeUInt16LE(1, 20); body.writeUInt16LE(1, 22);
  body.writeUInt32LE(rate, 24); body.writeUInt32LE(rate * 2, 28); body.writeUInt16LE(2, 32); body.writeUInt16LE(16, 34);
  body.write("data", 36); body.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) body.writeInt16LE(Math.round(900 * Math.sin(i * 2 * Math.PI * 220 / rate)), 44 + i * 2);
  return body;
}

test("an unavailable stream leaves loading, explains the failure and can be retried", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let failed = true, calls = 0;
  await page.route("**/api/v2/stream/next?**", (route) => {
    calls++;
    return route.fulfill(failed ? { status: 503, json: { detail: "Unavailable" } } : { json: { items: [], images: {} } });
  });
  await login(page);
  await page.getByRole("button", { name: "Включить поток", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Не удалось загрузить поток");
  expect(calls).toBe(1);
  failed = false;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Поток пока пуст");
  expect(calls).toBe(2);
  await expect(page.getByRole("button", { name: "Повторить запуск волны", exact: true })).not.toBeDisabled();
  expect(errors).toEqual([]);
});

test("a failed audio file stays visible in mini and full player and retries with a fresh source", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let available = false, manifests = 0;
  await page.route(`**/api/v2/albums/${album}`, async (route) => {
    const response = await route.fetch(), data = await response.json();
    await route.fulfill({ response, json: { ...data, tracks: data.tracks.slice(0, 1) } });
  });
  await page.route("**/api/v2/stream/autoplay", (route) => route.fulfill({ json: { tracks: [], images: {} } }));
  await page.route("**/api/v2/playback/manifest", (route) => {
    manifests++;
    return route.fulfill({ json: { items: route.request().postDataJSON().trackIds.map((trackId: string) => ({
      trackId, url: `/m/recovery-${available ? "ready" : "missing"}.wav`, tier: "lossless", codec: "pcm", durationMs: 12000,
      expiresAt: Math.floor(Date.now() / 1000) + 3600, fallbacks: [], gain: {}, sizeBytes: null, bitrateKbps: null,
    })) } });
  });
  await page.route("**/m/recovery-*.wav", (route) => route.request().url().includes("ready")
    ? route.fulfill({ contentType: "audio/wav", body: wav() }) : route.fulfill({ status: 404, body: "" }));
  await login(page);
  await page.goto(base + `/album/${album}`);
  await page.getByRole("dialog").getByRole("button", { name: "Слушать", exact: true }).click();
  await page.keyboard.press("Escape");
  const mini = page.getByRole("region", { name: "Сейчас играет" });
  await expect(mini.getByRole("alert")).toContainText("Не удалось воспроизвести");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(mini.getByRole("button", { name: "Повторить", exact: true })).toBeInViewport();
  const message = await mini.getByRole("alert").boundingBox();
  expect(message!.x).toBeGreaterThanOrEqual(0);
  expect(message!.x + message!.width).toBeLessThanOrEqual(390);
  await mini.locator('a[href="/player"]').click();
  await expect(page.getByRole("alert")).toContainText("Не удалось воспроизвести");
  const before = manifests;
  available = true;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await page.waitForFunction(() => navigator.mediaSession.playbackState === "playing");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(manifests).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test("retry after a manifest failure plays the selected track, not the previous audio", async ({ page }) => {
  const first = "00000000-0000-4000-8000-000000000001", second = "00000000-0000-4000-8000-000000000002";
  let denySecond = true, waiting = false;
  let releaseManifest!: () => void;
  const heldManifest = new Promise<void>((resolve) => { releaseManifest = resolve; });
  await page.route("**/api/v2/events/listens:batch", (route) => route.fulfill({ json: { accepted: 1, duplicates: 0 } }));
  await page.route("**/api/v2/stream/autoplay", (route) => route.fulfill({ json: { tracks: [], images: {} } }));
  await page.route("**/api/v2/playback/manifest", async (route) => {
    const ids: string[] = route.request().postDataJSON().trackIds;
    if (ids[0] === second && denySecond) {
      waiting = true;
      await heldManifest;
      return route.fulfill({ status: 503, json: { detail: "Unavailable" } });
    }
    return route.fulfill({ json: { items: [ids[0]].map((trackId) => ({
      trackId, url: `/m/selection-${trackId}.wav`, tier: "lossless", codec: "pcm", durationMs: 12000,
      expiresAt: Math.floor(Date.now() / 1000) + 3600, fallbacks: [], gain: {}, sizeBytes: null, bitrateKbps: null,
    })) } });
  });
  await page.route("**/m/selection-*.wav", (route) => route.fulfill({ contentType: "audio/wav", body: wav() }));
  await login(page);
  await page.evaluate(async ([first, second]) => {
    const engine = (window as unknown as { __musix: { player: { playTracks: (items: unknown[]) => Promise<void> } } }).__musix.player;
    await engine.playTracks([
      { trackId: first, title: "Первый трек", artist: "Проверка", contextType: "queue" },
      { trackId: second, title: "Новый трек", artist: "Проверка", contextType: "queue" },
    ]);
  }, [first, second]);
  await page.waitForFunction(() => navigator.mediaSession.playbackState === "playing");
  const mini = page.getByRole("region", { name: "Сейчас играет" });
  await mini.getByRole("button", { name: "Следующий", exact: true }).click();
  await expect.poll(() => waiting).toBe(true);
  await mini.getByRole("button", { name: "Играть", exact: true }).click();
  expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe("paused");
  releaseManifest();
  await expect(mini.getByRole("alert")).toContainText("Нет связи с сервером");
  await expect(mini).toContainText("Новый трек");
  expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe("paused");
  denySecond = false;
  await mini.getByRole("button", { name: "Играть", exact: true }).click();
  await page.waitForFunction(() => navigator.mediaSession.playbackState === "playing" && navigator.mediaSession.metadata?.title === "Новый трек");
  await expect(mini.getByRole("alert")).toHaveCount(0);
});

test("a delayed stream response cannot restore playback after stopping", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let entered = false;
  await page.route("**/api/v2/stream/next?**", async (route) => {
    entered = true;
    await held;
    await route.fulfill({ json: { items: [], images: {} } });
  });
  await login(page);
  await page.getByRole("button", { name: "Включить поток", exact: true }).click();
  await expect.poll(() => entered).toBe(true);
  await page.evaluate(() => (window as unknown as { __musix: { player: { stop: () => Promise<void> } } }).__musix.player.stop());
  const response = page.waitForResponse((r) => r.url().includes("/stream/next"));
  release();
  await response;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe("none");
});
