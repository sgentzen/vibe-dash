import { Router } from "express";
import type Database from "better-sqlite3";
import type { SprintStatus } from "../types.js";
import {
  listSprints,
  createSprint,
  getSprint,
  updateSprint,
  getSprintCapacity,
  getSprintAgentContributions,
  getSprintDailyStats,
  recordDailyStats,
  getVelocityTrend,
} from "../db/index.js";
import type { BroadcastFn } from "./types.js";

export function sprintRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/sprints", (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    res.json(listSprints(db, project_id));
  });

  router.post("/api/sprints", (req, res) => {
    const { project_id, name, description, status, start_date, end_date } =
      req.body as {
        project_id: string;
        name: string;
        description?: string | null;
        status?: string;
        start_date?: string | null;
        end_date?: string | null;
      };
    if (!project_id || !name) {
      res.status(400).json({ error: "project_id and name are required" });
      return;
    }
    const sprint = createSprint(db, {
      project_id,
      name,
      description: description ?? null,
      status: status as SprintStatus | undefined,
      start_date: start_date ?? null,
      end_date: end_date ?? null,
    });
    broadcast({ type: "sprint_created", payload: sprint });
    res.status(201).json(sprint);
  });

  router.patch("/api/sprints/:id", (req, res) => {
    const sprint = getSprint(db, req.params.id);
    if (!sprint) {
      res.status(404).json({ error: "Sprint not found" });
      return;
    }
    const updated = updateSprint(db, req.params.id, req.body as Parameters<typeof updateSprint>[2]);
    broadcast({ type: "sprint_updated", payload: updated! });
    res.json(updated);
  });

  router.get("/api/sprints/:id/capacity", (req, res) => {
    const sprint = getSprint(db, req.params.id);
    if (!sprint) { res.status(404).json({ error: "Sprint not found" }); return; }
    res.json(getSprintCapacity(db, req.params.id));
  });

  router.get("/api/sprints/:id/contributions", (req, res) => {
    res.json(getSprintAgentContributions(db, req.params.id));
  });

  router.get("/api/sprints/:id/burndown", (req, res) => {
    res.json(getSprintDailyStats(db, req.params.id));
  });

  router.post("/api/sprints/:id/record-stats", (req, res) => {
    const stats = recordDailyStats(db, req.params.id);
    broadcast({ type: "daily_stats_recorded", payload: stats });
    res.json(stats);
  });

  router.get("/api/velocity", (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? "5", 10);
    const projectId = req.query.project_id as string | undefined;
    res.json(getVelocityTrend(db, isNaN(limit) ? 5 : limit, projectId));
  });

  return router;
}
