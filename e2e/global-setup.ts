import { request } from "@playwright/test";

// The app renders a fixed, full-screen OnboardingWizard overlay whenever the
// database has zero projects (see src/App.tsx: `projects.length === 0`). On a
// fresh CI database that overlay covers the board/agents views, so specs that
// click into those views (and don't seed their own data) flake — the exact
// failures seen in CI (`board: shows three kanban columns`, the `agents`
// preset-tab clicks). Seed one project up front so first-run onboarding never
// appears; tests that need their own project still create it themselves.
const API_BASE = "http://localhost:3001";

export default async function globalSetup(): Promise<void> {
  const ctx = await request.newContext();
  try {
    // The webServer may still be booting when global setup runs — poll health.
    const deadline = Date.now() + 30_000;
    let healthy = false;
    while (Date.now() < deadline) {
      try {
        const res = await ctx.get(`${API_BASE}/api/health`);
        if (res.ok()) {
          healthy = true;
          break;
        }
      } catch {
        // server not accepting connections yet — retry
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!healthy) {
      throw new Error(`e2e global setup: ${API_BASE} never became healthy`);
    }

    const res = await ctx.get(`${API_BASE}/api/projects`);
    const projects: unknown = res.ok() ? await res.json() : [];
    if (!Array.isArray(projects) || projects.length === 0) {
      await ctx.post(`${API_BASE}/api/projects`, {
        data: { name: "E2E Seed Project", description: "" },
      });
    }
  } finally {
    await ctx.dispose();
  }
}
