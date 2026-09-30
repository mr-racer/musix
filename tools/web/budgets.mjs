// Phase 5 §5 budgets on a production build: `node tools/web/budgets.mjs [base url]` from
// web/ (e.g. `MUSIX_API=http://127.0.0.1:18010 npx vite preview --port 5175`). Lighthouse
// cannot sign in, so the same metrics come from the browser's own Performance APIs:
// LCP (cold: a fresh context holding only the refresh cookie), the requests home makes,
// INP (the worst Event Timing duration over real interactions), and frame times while
// scrolling the 6k-track list. LTE = 70 ms RTT, 12 Mbit/s down, 5 up (network only: desktop).
import { createRequire } from "node:module";

const { chromium } = createRequire(process.cwd() + "/")("@playwright/test");
const base = process.argv[2] ?? "http://127.0.0.1:5175";
const email = process.env.MUSIX_EMAIL ?? "mig-owner@example.com";
const password = process.env.MUSIX_PASSWORD ?? "mig-pass-123";
const b = await chromium.launch({ channel: "chrome" });
const viewport = { width: 1440, height: 900 };

// a fresh context signed in through the API: the refresh cookie rotates on every use and a
// replayed one revokes its family (by design), so contexts never share a cookie
async function signed() {
  const ctx = await b.newContext({ viewport });
  const r = await ctx.request.post(base + "/api/v2/auth/login", { data: { email, password, device: { name: "budgets", platform: "web" } } });
  if (!r.ok()) throw new Error("login " + r.status());
  return ctx;
}

async function lcp(profile) {
  const ctx = await signed();
  const p = await ctx.newPage();
  const api = [];
  p.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) api.push(u.pathname); });
  if (profile === "lte") {
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 70, downloadThroughput: (12e6 / 8), uploadThroughput: (5e6 / 8) });
  }
  await p.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  await p.goto(base + "/", { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  const v = await p.evaluate(() => window.__lcp);
  await ctx.close();
  return { lcp: Math.round(v), api };
}

const median = (xs) => [...xs].sort((a, c) => a - c)[Math.floor(xs.length / 2)];
for (const profile of ["lan", "lte"]) {
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await lcp(profile));
  console.log(`LCP home ${profile}: ${runs.map((r) => r.lcp).join(" / ")} ms (median ${median(runs.map((r) => r.lcp))})`);
  if (profile === "lan") console.log("  api requests on a cold home:", runs[0].api.join(", "));
}

// INP: real interactions on a warm page
const ctx = await signed();
const p = await ctx.newPage();
await p.addInitScript(() => {
  window.__events = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__events.push({ name: e.name, d: e.duration }); }).observe({ type: "event", durationThreshold: 16, buffered: true });
});
await p.goto(base + "/library");
await p.waitForFunction(() => document.querySelectorAll("main img").length > 6, null, { timeout: 120000 }); // the mirror is in
await p.goto(base + "/");
await p.waitForTimeout(1500);
for (const name of ["Библ", "Поиск", "Плеер", "Главная"]) {
  await p.locator("nav[aria-label='Разделы']").first().getByRole("link", { name }).click();
  await p.waitForTimeout(900);
}
await p.goto(base + "/library?tab=tracks");
await p.waitForTimeout(2000);
for (const t of ["Альбомы", "Артисты", "Треки"]) { await p.getByRole("tab", { name: new RegExp(t) }).click(); await p.waitForTimeout(700); }
await p.getByLabel("Фильтр библиотеки").type("love", { delay: 60 });
await p.waitForTimeout(800);
const events = await p.evaluate(() => window.__events);
const inp = Math.max(0, ...events.map((e) => e.d));
console.log(`INP (worst of ${events.length} interaction events ≥ 16 ms): ${Math.round(inp)} ms`, events.sort((a, c) => c.d - a.d).slice(0, 3).map((e) => `${e.name} ${Math.round(e.d)}`).join(", "));

// the 6k list: frame times while wheel-scrolling for ~6 s
await p.getByLabel("Фильтр библиотеки").fill("");
await p.getByRole("tab", { name: /Треки/ }).click();
await p.waitForTimeout(1500);
await p.mouse.move(700, 500);
await p.evaluate(() => {
  window.__frames = [];
  let last = performance.now();
  const loop = (t) => { window.__frames.push(t - last); last = t; if (window.__frames.length < 2000) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
});
for (let i = 0; i < 120; i++) { await p.mouse.wheel(0, 900); await p.waitForTimeout(50); }
const frames = (await p.evaluate(() => window.__frames)).slice(5);
const sorted = [...frames].sort((a, c) => a - c);
const pct = (q) => sorted[Math.floor(sorted.length * q)];
const rows = await p.evaluate(() => document.querySelectorAll("main button").length);
console.log(`scroll 6k tracks: ${frames.length} frames, p50 ${pct(0.5).toFixed(1)} ms, p95 ${pct(0.95).toFixed(1)} ms, >25 ms: ${frames.filter((f) => f > 25).length} (${rows} rows in the DOM)`);
await b.close();
