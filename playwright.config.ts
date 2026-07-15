import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;

// In CI we test the *production build* served by the express server on :3001
// (a single origin, no vite dev server, no proxy). This avoids the on-demand
// module-compilation warmup that made the first page load per route exceed the
// 30s timeout under CI load — the historical `board`/`agents` flakes — and the
// `[vite] ws proxy ECONNRESET` noise from the dev-server proxy layer. CI builds
// the client first (`npx vite build`) so `dist/` exists before this boots.
// Locally we keep the dev servers (vite :3000 + api :3001) for fast HMR.
const baseURL = isCI ? "http://localhost:3001" : "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  // Seed a project before any test so the first-run OnboardingWizard overlay
  // never blocks the board/agents views on a fresh CI database.
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: isCI ? 2 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: isCI
    ? [
        // Single production server: serves the prebuilt SPA + API + WS on :3001.
        {
          command: "tsx server/index.ts",
          port: 3001,
          env: { NODE_ENV: "production" },
          reuseExistingServer: false,
          timeout: 30_000,
        },
      ]
    : [
        {
          command: "tsx server/index.ts",
          port: 3001,
          reuseExistingServer: true,
          timeout: 30_000,
        },
        {
          command: "vite",
          port: 3000,
          reuseExistingServer: true,
          timeout: 30_000,
        },
      ],
});
