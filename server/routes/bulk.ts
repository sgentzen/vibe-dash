import { Router } from "express";
import type Database from "better-sqlite3";
import { getTaskTagsForProject, getDependenciesForProject } from "../db/index.js";
import type { BroadcastFn } from "./types.js";

export function bulkRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/projects/:projectId/task-tags", (req, res) => {
    res.json(getTaskTagsForProject(db, req.params.projectId));
  });

  router.get("/api/projects/:projectId/task-dependencies", (req, res) => {
    res.json(getDependenciesForProject(db, req.params.projectId));
  });

  return router;
}
