import { Router } from "express";
import type Database from "better-sqlite3";
import { getRecentActivity, getActivityStream, getAgentActivityHeatmap } from "../db/index.js";
import type { BroadcastFn } from "./types.js";

export function activityRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/activity", (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? "50", 10);
    res.json(getRecentActivity(db, isNaN(limit) ? 50 : limit));
  });

  router.get("/api/activity-stream", (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    res.json(getActivityStream(db, {
      agent_id: q.agent_id,
      project_id: q.project_id,
      since: q.since,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
    }));
  });

  router.get("/api/activity-heatmap", (req, res) => {
    const projectId = req.query.project_id as string | undefined;
    res.json(getAgentActivityHeatmap(db, projectId));
  });

  return router;
}
