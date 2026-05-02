import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "tsx server/index.ts",
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "vite",
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
