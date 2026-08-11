import { Router } from "express";
import type Database from "better-sqlite3";
import {
  logCompletionMetrics,
  getAgentPerformance,
  getAgentComparison,
  getTaskTypeBreakdown,
} from "../db/index.js";
import type { CompletionMetrics } from "../db/index.js";
import { makeReadLimiter } from "./middleware.js";
import type { BroadcastFn } from "./types.js";
import { badRequest, notFound } from "./responses.js";

const NUMERIC_FIELDS = ["lines_added", "lines_removed", "files_changed", "tests_added", "tests_passing", "duration_seconds"] as const;

export function metricRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();
  const metricsLimiter = makeReadLimiter(120);

  router.post("/api/metrics", metricsLimiter, (req, res) => {
    const { task_id, agent_id, lines_added, lines_removed, files_changed, tests_added, tests_passing, duration_seconds } = req.body as {
      // The ids arrive as `unknown` because a JSON body can carry any type here.
      // Declaring them `string` would let the guard below look redundant to a
      // reader while the actual values reached SQLite unchecked.
      task_id?: unknown;
      agent_id?: unknown;
      lines_added?: number;
      lines_removed?: number;
      files_changed?: number;
      tests_added?: number;
      tests_passing?: number;
      duration_seconds?: number;
    };
    // Truthiness alone is not enough: `true` and `123` are truthy but cannot be
    // bound by better-sqlite3, so they used to surface as a 500 for what is
    // plainly a malformed request.
    if (typeof task_id !== "string" || !task_id || typeof agent_id !== "string" || !agent_id) {
      badRequest(res, "task_id and agent_id are required");
      return;
    }
    for (const field of NUMERIC_FIELDS) {
      const val = req.body[field];
      if (val !== undefined && !Number.isFinite(val)) {
        badRequest(res, `${field} must be a number`);
        return;
      }
    }
    let entry: CompletionMetrics;
    try {
      entry = logCompletionMetrics(db, {
        task_id, agent_id, lines_added, lines_removed, files_changed, tests_added, tests_passing, duration_seconds,
      });
    } catch (err) {
      // The only foreign keys on completion_metrics are task_id and agent_id, so
      // this constraint can only mean the caller named a row that isn't there —
      // their mistake, not ours. Every other throw is still a genuine 500.
      if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
        notFound(res, "Unknown task_id or agent_id");
        return;
      }
      throw err;
    }
    broadcast({ type: "metrics_logged", payload: entry });
    res.status(201).json(entry);
  });

  router.get("/api/agents/:id/performance", (req, res) => {
    const perf = getAgentPerformance(db, req.params.id);
    if (!perf) {
      notFound(res, "No metrics found for this agent");
      return;
    }
    res.json(perf);
  });

  router.get("/api/agents/comparison", (_req, res) => {
    res.json(getAgentComparison(db));
  });

  router.get("/api/agents/:id/task-type-breakdown", (req, res) => {
    res.json(getTaskTypeBreakdown(db, req.params.id));
  });

  return router;
}
