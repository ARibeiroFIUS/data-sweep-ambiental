import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright/tests",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["line"], ["html", { open: "never" }]],
  use: {
    browserName: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 35_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    userAgent: "Mozilla/5.0 (compatible; data-sweep-engine/1.0; tribunal-playwright-smoke)",
  },
});

