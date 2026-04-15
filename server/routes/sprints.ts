import { Router } from "express";
import type Database from "better-sqlite3";
import type { MilestoneStatus } from "../types.js";
import {
  listMilestones,
  createMilestone,
  getMilestone,
  updateMilestone,
  completeMilestone,
  getMilestoneProgress,
  getMilestoneAgentContributions,
  getMilestoneDailyStats,
  recordMilestoneDailyStats,
} from "../db/index.js";
import type { BroadcastFn } from "./types.js";

export function milestoneRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/milestones", (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    res.json(listMilestones(db, project_id));
  });

  router.post("/api/milestones", (req, res) => {
    const { project_id, name, description, status, target_date } =
      req.body as {
        project_id: string;
        name: string;
        description?: string | null;
        status?: string;
        target_date?: string | null;
      };
    if (!project_id || !name) {
      res.status(400).json({ error: "project_id and name are required" });
      return;
    }
    const milestone = createMilestone(db, {
      project_id,
      name,
      description: description ?? null,
      status: status as MilestoneStatus | undefined,
      target_date: target_date ?? null,
    });
    broadcast({ type: "milestone_created", payload: milestone });
    res.status(201).json(milestone);
  });

  router.patch("/api/milestones/:id", (req, res) => {
    const milestone = getMilestone(db, req.params.id);
    if (!milestone) {
      res.status(404).json({ error: "Milestone not found" });
      return;
    }
    const updated = updateMilestone(db, req.params.id, req.body as Parameters<typeof updateMilestone>[2]);
    broadcast({ type: "milestone_updated", payload: updated! });
    res.json(updated);
  });

  router.post("/api/milestones/:id/complete", (req, res) => {
    const milestone = getMilestone(db, req.params.id);
    if (!milestone) {
      res.status(404).json({ error: "Milestone not found" });
      return;
    }
    const completed = completeMilestone(db, req.params.id);
    broadcast({ type: "milestone_achieved", payload: completed! });
    res.json(completed);
  });

  router.get("/api/milestones/:id/progress", (req, res) => {
    const milestone = getMilestone(db, req.params.id);
    if (!milestone) { res.status(404).json({ error: "Milestone not found" }); return; }
    res.json(getMilestoneProgress(db, req.params.id));
  });

  router.get("/api/milestones/:id/contributions", (req, res) => {
    res.json(getMilestoneAgentContributions(db, req.params.id));
  });

  router.get("/api/milestones/:id/daily-stats", (req, res) => {
    res.json(getMilestoneDailyStats(db, req.params.id));
  });

  router.post("/api/milestones/:id/record-stats", (req, res) => {
    const stats = recordMilestoneDailyStats(db, req.params.id);
    broadcast({ type: "daily_stats_recorded", payload: stats });
    res.json(stats);
  });

  return router;
}
