import { Router } from "express";
import type Database from "better-sqlite3";
import {
  getActiveBlockers,
  createBlocker,
  resolveBlocker,
  getTask,
  evaluateAlertRules,
} from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { badRequest } from "./responses.js";
import { requireEntity } from "./handlers.js";

export function blockerRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/blockers", (_req, res) => {
    res.json(getActiveBlockers(db));
  });

  router.post("/api/blockers", (req, res) => {
    const { task_id, reason } = req.body as { task_id: string; reason: string };
    if (!task_id || !reason) {
      badRequest(res, "task_id and reason are required");
      return;
    }
    const blocker = createBlocker(db, { task_id, reason });
    const task = getTask(db, task_id);
    broadcast({ type: "blocker_reported", payload: blocker });
    if (task) broadcast({ type: "task_updated", payload: task });
    const alertNotifs = evaluateAlertRules(db, "blocker_reported", { task_id, priority: task?.priority });
    for (const n of alertNotifs) broadcast({ type: "notification_created", payload: n });
    res.status(201).json(blocker);
  });

  router.post("/api/blockers/:id/resolve", (req, res) => {
    const resolved = resolveBlocker(db, req.params.id);
    if (!requireEntity(res, resolved, "Blocker")) return;
    const task = getTask(db, resolved.task_id);
    broadcast({ type: "blocker_resolved", payload: resolved });
    if (task) broadcast({ type: "task_updated", payload: task });
    res.json(resolved);
  });

  return router;
}
