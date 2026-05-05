import { Router } from "express";
import type Database from "better-sqlite3";
import rateLimit from "express-rate-limit";
import { ACTIVE_THRESHOLD_MINUTES } from "../db/index.js";
import { firstRunLimiter, statsLimiter } from "./middleware.js";
import type { BroadcastFn } from "./types.js";
import { issueTicket } from "../ws-tickets.js";

// 60/min accommodates the 2s reconnect loop (30 reconnects/min) plus headroom for normal use.
const wsTicketLimiter = rateLimit({ windowMs: 60_000, max: 60 });

export function systemRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

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
    res.json({ projects, tasks, activeAgents, alerts });
  });

  router.post("/api/ws-ticket", wsTicketLimiter, (_req, res) => {
    res.json({ ticket: issueTicket() });
  });

  return router;
}
