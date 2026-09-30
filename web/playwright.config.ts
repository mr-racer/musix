import { defineConfig } from "@playwright/test";

// The flows run against a live dev stack (see e2e/*.spec.ts for what each needs) in the
// installed Google Chrome: Playwright's Chromium has no AAC decoder.
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
});
