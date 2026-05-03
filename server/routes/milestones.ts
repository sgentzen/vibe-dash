import { Router } from "express";
import type Database from "better-sqlite3";
import {
  createMilestone,
  updateMilestone,
  completeMilestone,
  getMilestone,
  listMilestones,
  getMilestoneProgress,
  recordMilestoneDailyStats,
  getMilestoneDailyStats,
  getMilestoneAgentContributions,
} from "../db/index.js";
import type { MilestoneStatus } from "../types.js";
import type { BroadcastFn } from "./types.js";
import { handleMutation } from "./handlers.js";
import { validateBody } from "./validate.js";
import { createMilestoneSchema, updateMilestoneSchema } from "../../shared/schemas.js";

export function milestoneRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/milestones", (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    res.json(listMilestones(db, project_id));
  });

  router.post("/api/milestones", validateBody(createMilestoneSchema), (req, res) => {
    const { project_id, name, description, status, acceptance_criteria, target_date } =
      req.body as {
        project_id: string;
        name: string;
        description?: string | null;
        status?: string;
        acceptance_criteria?: string | null;
        target_date?: string | null;
      };
    handleMutation(res, broadcast, () => createMilestone(db, {
      project_id,
      name,
      description: description ?? null,
      status: status as MilestoneStatus | undefined,
      acceptance_criteria: acceptance_criteria ?? null,
      target_date: target_date ?? null,
    }), "milestone_created", 201);
  });

  router.patch("/api/milestones/:id", validateBody(updateMilestoneSchema), (req, res) => {
    const id = req.params.id as string;
    const milestone = getMilestone(db, id);
    if (!milestone) {
      res.status(404).json({ error: "Milestone not found" });
      return;
    }
    const updated = updateMilestone(db, id, req.body as Parameters<typeof updateMilestone>[2]);
    broadcast({ type: "milestone_updated", payload: updated! });
    res.json(updated);
  });

  router.post("/api/milestones/:id/complete", (req, res) => {
    const milestone = getMilestone(db, req.params.id as string);
    if (!milestone) {
      res.status(404).json({ error: "Milestone not found" });
      return;
    }
    const completed = completeMilestone(db, req.params.id as string);
    broadcast({ type: "milestone_achieved", payload: completed! });
    res.json(completed);
  });

  router.get("/api/milestones/:id/progress", (req, res) => {
    const milestone = getMilestone(db, req.params.id as string);
    if (!milestone) {
      res.status(404).json({ error: "Milestone not found" });
      return;
    }
    res.json(getMilestoneProgress(db, req.params.id as string));
  });

  router.get("/api/milestones/:id/contributions", (req, res) => {
    res.json(getMilestoneAgentContributions(db, req.params.id as string));
  });

  router.get("/api/milestones/:id/daily-stats", (req, res) => {
    res.json(getMilestoneDailyStats(db, req.params.id as string));
  });

  router.post("/api/milestones/:id/record-stats", (req, res) => {
    handleMutation(res, broadcast, () => recordMilestoneDailyStats(db, req.params.id as string), "daily_stats_recorded");
  });

  return router;
}
