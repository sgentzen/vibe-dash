import { Router } from "express";
import type Database from "better-sqlite3";
import {
  logCompletionMetrics,
  getAgentPerformance,
  getAgentComparison,
  getTaskTypeBreakdown,
} from "../db/index.js";
import { makeReadLimiter } from "./middleware.js";
import type { BroadcastFn } from "./types.js";
import { badRequest, notFound } from "./responses.js";

const NUMERIC_FIELDS = ["lines_added", "lines_removed", "files_changed", "tests_added", "tests_passing", "duration_seconds"] as const;

export function metricRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();
  const metricsLimiter = makeReadLimiter(120);

  router.post("/api/metrics", metricsLimiter, (req, res) => {
    // express.json() leaves req.body undefined without a JSON Content-Type,
    // and destructuring that throws a 500; `?? {}` keeps that case a 400.
    // Bound once so the numeric-field loop below reads the same guarded object
    // rather than req.body directly, which would reintroduce the throw if the
    // required-field check above it were ever reordered.
    const body = (req.body ?? {}) as {
      task_id?: string;
      agent_id?: string;
      lines_added?: number;
      lines_removed?: number;
      files_changed?: number;
      tests_added?: number;
      tests_passing?: number;
      duration_seconds?: number;
    };
    const { task_id, agent_id, lines_added, lines_removed, files_changed, tests_added, tests_passing, duration_seconds } = body;
    if (!task_id || !agent_id) {
      badRequest(res, "task_id and agent_id are required");
      return;
    }
    for (const field of NUMERIC_FIELDS) {
      const val = body[field];
      if (val !== undefined && !Number.isFinite(val)) {
        badRequest(res, `${field} must be a number`);
        return;
      }
    }
    const entry = logCompletionMetrics(db, {
      task_id, agent_id, lines_added, lines_removed, files_changed, tests_added, tests_passing, duration_seconds,
    });
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
