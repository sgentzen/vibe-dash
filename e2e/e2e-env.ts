// Single source of truth for the e2e run's API port, shared by
// playwright.config.ts (webServer/baseURL) and the test helpers that talk to
// the API directly (global-setup.ts, helpers/api.ts). Keeping this in one
// place means those can never drift apart, and — critically — this port is
// deliberately never 3001, the default `npm run dev` / docker-compose port.
// If e2e ever attached to that port it would hit a live instance holding
// real projects and real ingested transcripts (see CI-1/CI-4 in
// docs/analysis/2026-09-18-project-audit.md).
export const E2E_API_PORT = 3941;
export const E2E_API_BASE = `http://localhost:${E2E_API_PORT}`;
