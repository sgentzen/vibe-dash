import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { E2E_API_PORT, E2E_API_BASE } from "./e2e/e2e-env.js";

const isCI = !!process.env.CI;

// In CI we test the *production build* served by the express server on
// E2E_API_PORT (a single origin, no vite dev server, no proxy). This avoids
// the on-demand module-compilation warmup that made the first page load per
// route exceed the 30s timeout under CI load — the historical `board`/`agents`
// flakes — and the `[vite] ws proxy ECONNRESET` noise from the dev-server
// proxy layer. CI builds the client first (`npx vite build`) so `dist/`
// exists before this boots. Locally we keep the dev servers (vite :3000 +
// api :E2E_API_PORT) for fast HMR.
const baseURL = isCI ? E2E_API_BASE : "http://localhost:3000";

// Fresh, isolated SQLite DB and an empty Claude-projects dir for this run
// only, so e2e never reads or writes the maintainer's real vibe-dash.db and
// never ingests their real Claude Code transcript history (CI-1, CI-3, CI-4
// in docs/analysis/2026-09-18-project-audit.md). Removed by globalTeardown.
const E2E_TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-dash-e2e-"));
const E2E_DB_PATH = path.join(E2E_TMP_ROOT, "vibe-dash.db");
const E2E_CLAUDE_HOME = path.join(E2E_TMP_ROOT, "claude-home");
fs.mkdirSync(E2E_CLAUDE_HOME, { recursive: true });
// Read back by e2e/global-teardown.ts, which runs in this same process.
process.env.E2E_TMP_ROOT = E2E_TMP_ROOT;

// Env for the express server (`server/index.ts`) in either mode: a dedicated
// port that is never :3001, plus the isolation above.
const apiServerEnv = {
  PORT: String(E2E_API_PORT),
  VIBE_DASH_DB: E2E_DB_PATH,
  VIBE_DASH_CLAUDE_HOME: E2E_CLAUDE_HOME,
};

export default defineConfig({
  testDir: "./e2e",
  // Seed a project before any test so the first-run OnboardingWizard overlay
  // never blocks the board/agents views on a fresh CI database.
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
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
        // Single production server: serves the prebuilt SPA + API + WS on
        // E2E_API_PORT — never :3001, and always reuse=false so a run never
        // attaches to (and pollutes) a server it didn't start itself.
        {
          command: "tsx server/index.ts",
          port: E2E_API_PORT,
          env: { ...apiServerEnv, NODE_ENV: "production" },
          reuseExistingServer: false,
          timeout: 30_000,
        },
      ]
    : [
        {
          command: "tsx server/index.ts",
          port: E2E_API_PORT,
          env: apiServerEnv,
          reuseExistingServer: false,
          timeout: 30_000,
        },
        {
          command: "vite",
          port: 3000,
          // Tells vite.config.ts's dev proxy where the api server above
          // actually is, since it's no longer the default :3001.
          env: { VIBE_DASH_API_PORT: String(E2E_API_PORT) },
          reuseExistingServer: false,
          timeout: 30_000,
        },
      ],
});
