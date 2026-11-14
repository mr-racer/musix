import { expect, test, type Page } from "@playwright/test";

// These focused browser regressions mount the real components from the running Vite dev
// server. Network responses fail for real, including HTTP 200 with undecodable image bytes.
const base = process.env.MUSIX_WEB_URL ?? "http://127.0.0.1:5173";
const valid = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="#567896" d="M0 0h32v32H0z"/></svg>';

async function mountCovers(page: Page) {
  await page.goto(base + "/login");
  const source = await (await page.request.get(base + "/src/main.tsx")).text();
  const react = source.match(/"(\/node_modules\/\.vite\/deps\/react\.js\?[^\"]+)"/)?.[1];
  const dom = source.match(/"(\/node_modules\/\.vite\/deps\/react-dom_client\.js\?[^\"]+)"/)?.[1];
  expect(react && dom, "the component regression needs the Vite dev server").toBeTruthy();
  await page.evaluate(async ({ react, dom }) => {
    const paths = [react!, dom!, "/src/ui/Cover.tsx", "/src/library/Wall.tsx", "/src/lib/images.ts"];
    const [{ default: React }, { default: ReactDOM }, { Cover }, { WallCover }, { remember }] = await Promise.all(paths.map((path) => import(path)));
    const host = document.createElement("div");
    host.id = "media-regression";
    Object.assign(host.style, { position: "fixed", inset: "0", zIndex: "9999", background: "#eeeef3", display: "flex", gap: "24px", padding: "80px" });
    document.body.append(host);
    const root = ReactDOM.createRoot(host);
    (window as any).renderMedia = (src: string) => {
      remember({ regression: { urls: { "96": src }, palette: { muted: "#786576" } } });
      root.render(React.createElement(React.Fragment, null,
        React.createElement("div", { "data-case": "cover" }, React.createElement(Cover, { id: "regression", size: 96, alt: "Обложка альбома", seed: "album" })),
        React.createElement("div", { "data-case": "fresh" }, React.createElement(Cover, { id: "regression", size: 96, fresh: true, seed: "album" })),
        React.createElement("div", { "data-case": "wall", style: { position: "relative", width: "96px", height: "96px", overflow: "hidden" } }, React.createElement(WallCover, { id: "regression", px: 96, seed: "album" })),
      ));
    };
  }, { react, dom });
}

for (const failure of ["404", "invalid"] as const) {
  test(`${failure} cover failures show a palette and recover on source changes, including A → B → A`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let recovered = false, attempts = 0;
    await page.route("**/media-regression-a.svg", (route) => {
      attempts++;
      return recovered
        ? route.fulfill({ contentType: "image/svg+xml", body: valid })
        : route.fulfill({ status: failure === "404" ? 404 : 200, contentType: "image/svg+xml", body: "not an image" });
    });
    await page.route("**/media-regression-b.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: valid }));
    await mountCovers(page);
    const render = (src: string) => page.evaluate((src) => (window as any).renderMedia(src), src);
    const images = page.locator("#media-regression img");
    await render("/media-regression-a.svg");
    await expect(images).toHaveCount(3);
    await expect(page.locator("#media-regression img[data-image-fallback]")).toHaveCount(3);
    await expect.poll(() => images.evaluateAll((imgs) => imgs.every((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0 && getComputedStyle(el).opacity === "1"))).toBe(true);
    await expect(page.getByAltText("Обложка альбома")).toBeVisible();
    const failedRequests = attempts;
    await page.waitForTimeout(300);
    expect(attempts).toBe(failedRequests); // the fallback must not retry itself in a loop

    await render("/media-regression-b.svg");
    await expect(page.locator("#media-regression img[data-image-fallback]")).toHaveCount(0);
    await expect.poll(() => images.evaluateAll((imgs) => imgs.every((el) => (el as HTMLImageElement).naturalWidth === 32))).toBe(true);
    recovered = true;
    await render("/media-regression-a.svg");
    await expect(page.locator("#media-regression img[data-image-fallback]")).toHaveCount(0);
    await expect.poll(() => images.evaluateAll((imgs) => imgs.every((el) => (el as HTMLImageElement).currentSrc.endsWith("/media-regression-a.svg") && (el as HTMLImageElement).naturalWidth === 32 && getComputedStyle(el).opacity === "1"))).toBe(true);
    expect(attempts).toBeGreaterThan(failedRequests);
    expect(errors).toEqual([]);
  });
}
