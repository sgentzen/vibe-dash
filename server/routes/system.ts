import { Router } from "express";
import type Database from "better-sqlite3";
import { ACTIVE_THRESHOLD_MINUTES, getSpendToday, getTasksCompletedToday } from "../db/index.js";
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
    const projects = (
      db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }
    ).count;
    const tasks = (
      db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status != 'done'").get() as { count: number }
    ).count;
    const activeAgents = (
      db.prepare(
        // Safe interpolation: ACTIVE_THRESHOLD_MINUTES is a module-level numeric constant, not user input
        `SELECT COUNT(*) AS count FROM agents WHERE last_seen_at >= datetime('now', '-${ACTIVE_THRESHOLD_MINUTES} minutes') AND parent_agent_id IS NULL`
      ).get() as { count: number }
    ).count;
    const alerts = (
      db.prepare("SELECT COUNT(*) AS count FROM blockers WHERE resolved_at IS NULL").get() as { count: number }
    ).count;
    res.json({
      projects,
      tasks,
      activeAgents,
      alerts,
      spend_today: getSpendToday(db),
      tasks_completed_today: getTasksCompletedToday(db),
    });
  });

  return router;
}
