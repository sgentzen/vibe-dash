import { Router } from "express";
import type Database from "better-sqlite3";
import { reportWorkingOn, releaseFileLocks, getActiveFileLocks, getFileConflicts } from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { validateBody } from "./validate.js";
import { reportWorkingOnSchema } from "../../shared/schemas.js";

export function fileLockRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.post("/api/agents/:id/file-locks", validateBody(reportWorkingOnSchema), (req, res) => {
    const { task_id, file_paths } = req.body as { task_id: string; file_paths: string[] };
    const locks = reportWorkingOn(db, req.params.id as string, task_id, file_paths);
    for (const lock of locks) broadcast({ type: "file_lock_acquired", payload: lock });
    const conflicts = getFileConflicts(db);
    for (const c of conflicts) broadcast({ type: "file_conflict_detected", payload: c });
    res.status(201).json({ locks, conflicts });
  });

  router.delete("/api/agents/:id/file-locks", (req, res) => {
    const taskId = req.query.task_id as string | undefined;
    const released = releaseFileLocks(db, req.params.id as string, taskId);
    res.json({ released });
  });

  router.get("/api/file-locks", (_req, res) => {
    res.json(getActiveFileLocks(db));
  });

  router.get("/api/file-locks/conflicts", (_req, res) => {
    res.json(getFileConflicts(db));
  });

  return router;
}
