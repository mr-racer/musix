// Screens of the web client for the phase 5 review: `node tools/web/capture.mjs <out dir>
// [base url]` (run from web/, so @playwright/test resolves). Desktop 1440×900 and phone
// 412×915, both themes, signed in as the migrated owner on the Vite dev server (api-snap).
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(process.cwd() + "/")("@playwright/test"); // web/node_modules

const out = process.argv[2];
const base = process.argv[3] ?? "http://127.0.0.1:5173";
const email = process.env.MUSIX_EMAIL ?? "mig-owner@example.com";
const password = process.env.MUSIX_PASSWORD ?? "mig-pass-123";
mkdirSync(out, { recursive: true });

const sizes = { desktop: { width: 1440, height: 900 }, phone: { width: 412, height: 915 } };
const b = await chromium.launch({ channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
for (const theme of ["dark", "light"]) {
  for (const [size, viewport] of Object.entries(sizes)) {
    const ctx = await b.newContext({ viewport, colorScheme: theme, deviceScaleFactor: size === "phone" ? 2 : 1, isMobile: size === "phone", hasTouch: size === "phone" });
    const p = await ctx.newPage();
    const shot = async (name, wait = 1500) => {
      await p.waitForTimeout(wait);
      await p.screenshot({ path: `${out}/${name}-${size}-${theme}.png` });
      console.log(name, size, theme);
    };
    await p.goto(base + "/login");
    await shot("login", 800);
    await p.fill("input[type=email]", email);
    await p.fill("input[type=password]", password);
    await p.click("button[type=submit]");
    await p.waitForURL((u) => !u.pathname.startsWith("/login"));
    await shot("home", 2500);
    await p.goto(base + "/library");
    await p.waitForFunction(() => document.querySelectorAll("main img").length > 6, null, { timeout: 90000 });
    await shot("library-albums");
    await p.goto(base + "/search?q=" + encodeURIComponent("дождь") + "&sections=catalog");
    await shot("search", 3000);
    const artist = await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open("musix");
      r.onsuccess = () => { const q = r.result.transaction("artists").objectStore("artists").getAll(null, 400); q.onsuccess = () => res(q.result.find((a) => a.imageId)?.id ?? null); };
    }));
    if (artist) { await p.goto(`${base}/artist/${artist}`); await shot("artist", 3000); }
    const album = await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open("musix");
      r.onsuccess = () => { const q = r.result.transaction("albums").objectStore("albums").getAll(null, 50); q.onsuccess = () => res(q.result.find((a) => a.coverImageId)?.id ?? null); };
    }));
    if (album) { await p.goto(`${base}/album/${album}`); await shot("album", 2500); }
    await p.goto(base + "/settings");
    await shot("settings");
    await p.goto(base + "/player");
    await p.getByRole("button", { name: "Включить поток" }).click();
    await p.waitForFunction(() => navigator.mediaSession.playbackState === "playing", null, { timeout: 20000 });
    await shot("player", 3500);
    await p.getByRole("button", { name: "Текст песни" }).click();
    await shot("player-lyrics", 1500);
    await ctx.close();
  }
}
await b.close();
