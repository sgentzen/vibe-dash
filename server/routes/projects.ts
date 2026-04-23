import { Router } from "express";
import type Database from "better-sqlite3";
import { listProjects, createProject, generateReport } from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { badRequest } from "./responses.js";

export function projectRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/projects", (_req, res) => {
    res.json(listProjects(db));
  });

  router.post("/api/projects", (req, res) => {
    const { name, description } = req.body as { name: string; description?: string | null };
    if (!name) {
      badRequest(res, "name is required");
      return;
    }
    const project = createProject(db, { name, description: description ?? null });
    broadcast({ type: "project_created", payload: project });
    res.status(201).json(project);
  });

  router.post("/api/projects/:id/report", (req, res) => {
    const period = (req.body.period as "day" | "week" | "milestone") ?? "week";
    res.json({ report: generateReport(db, req.params.id, period) });
  });

  return router;
}
