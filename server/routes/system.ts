import { Router } from "express";
import type Database from "better-sqlite3";
import { countActiveAgents, getSpendToday, getSpendTodayUnpriced, getTasksCompletedToday, getUnknownMigrations } from "../db/index.js";
import { firstRunLimiter, statsLimiter } from "./middleware.js";
import type { BroadcastFn } from "./types.js";
import { version, commit, buildTime } from "../version.js";

export function systemRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  // Computed once, not per request: nothing applies migrations after
  // startup, so this can never change while the process is running. A
  // security review of this task's diff flagged the original per-request
  // query as both an avoidable DB read on an unauthenticated, unrated-limited
  // route and, worse, a contradiction with the very comment below (and the
  // Dockerfile/compose HEALTHCHECK comments) claiming a liveness probe
  // shouldn't depend on the DB layer at all — a broken database would have
  // turned this probe into a 500 the moment schema drift was ever checked.
  const schemaDrift = getUnknownMigrations(db);

  // Cheap, unauthenticated liveness probe with no rate limit. Used by the
  // client's usePolling.waitForServer() loop so the probe doesn't burn the
  // /api/stats budget on every page load. No DB access happens per request
  // (see schemaDrift above), so it stays cheap even under load.
  //
  // `ok: true` is kept as the only field every prior caller could rely on
  // (LIVE-3 asks for this to stay backwards compatible); version/commit/
  // buildTime are additions, not replacements. schemaDrift is included only
  // when non-empty, which — since runMigrations() already refuses to start
  // otherwise — can only happen when the database was opened with
  // VIBE_DASH_ALLOW_SCHEMA_DRIFT set, so its presence here is itself the
  // signal worth surfacing.
  router.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      version,
      commit,
      buildTime,
      ...(schemaDrift.length > 0 ? { schemaDrift } : {}),
    });
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
