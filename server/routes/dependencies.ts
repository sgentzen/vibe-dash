import { Router } from "express";
import type Database from "better-sqlite3";
import { addDependency, removeDependency, listDependencies, getBlockingTasks } from "../db/index.js";
import type { TaskDependency } from "../types.js";
import { dependencyDeleteLimiter } from "./middleware.js";
import type { BroadcastFn } from "./types.js";
import { validateBody } from "./validate.js";
import { createDependencySchema } from "../../shared/schemas.js";

export function dependencyRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/tasks/:id/dependencies", (req, res) => {
    res.json(listDependencies(db, req.params.id));
  });

  router.get("/api/tasks/:id/blocking", (req, res) => {
    res.json(getBlockingTasks(db, req.params.id));
  });

  router.post("/api/tasks/:id/dependencies", validateBody(createDependencySchema), (req, res) => {
    const { depends_on_task_id } = req.body as { depends_on_task_id: string };
    const dep = addDependency(db, req.params.id, depends_on_task_id);
    broadcast({ type: "dependency_added", payload: dep });
    res.status(201).json(dep);
  });

  router.delete("/api/dependencies/:id", dependencyDeleteLimiter, (req, res) => {
    const dep = db.prepare("SELECT * FROM task_dependencies WHERE id = ?").get(req.params.id) as TaskDependency | undefined;
    const removed = removeDependency(db, req.params.id as string);
    if (removed && dep) {
      broadcast({ type: "dependency_removed", payload: dep });
    }
    res.json({ success: removed });
  });

  return router;
}
