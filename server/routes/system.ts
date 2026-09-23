import { Router } from "express";
import type Database from "better-sqlite3";
import { countActiveAgents, getSpendToday, getSpendTodayUnpriced, getTasksCompletedToday } from "../db/index.js";
import { firstRunLimiter, statsLimiter } from "./middleware.js";
import type { BroadcastFn } from "./types.js";

export function systemRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  // Cheap, unauthenticated liveness probe with no rate limit. Used by the
  // client's usePolling.waitForServer() loop so the probe doesn't burn the
  // /api/stats budget on every page load.
  router.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.get("/api/first-run", firstRunLimiter, (_req, res) => {
    const count = (
      db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }
    ).count;
    res.json({ firstRun: count === 0 });
  });

  router.get("/api/stats", statsLimiter, (_req, res) => {
    // Both counts exclude archived projects (and their tasks) so the top-bar
    // isn't inflated by hidden-by-design junk — see UX-2 in
    // docs/analysis/2026-09-18-project-audit.md.
    const projects = (
      db.prepare("SELECT COUNT(*) AS count FROM projects WHERE archived_at IS NULL").get() as { count: number }
    ).count;
    const tasks = (
      db.prepare(
        `SELECT COUNT(*) AS count FROM tasks t
           JOIN projects p ON p.id = t.project_id
          WHERE t.status != 'done' AND p.archived_at IS NULL`
      ).get() as { count: number }
    ).count;
    const activeAgents = countActiveAgents(db);
    const alerts = (
      db.prepare("SELECT COUNT(*) AS count FROM blockers WHERE resolved_at IS NULL").get() as { count: number }
    ).count;
    res.json({
      projects,
      tasks,
      activeAgents,
      alerts,
      spend_today: getSpendToday(db),
      spend_today_unpriced: getSpendTodayUnpriced(db),
      tasks_completed_today: getTasksCompletedToday(db),
    });
  });

  return router;
}
