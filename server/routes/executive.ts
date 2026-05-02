import { Router } from "express";
import type Database from "better-sqlite3";
import { getExecutiveSummary } from "../db/index.js";
import type { BroadcastFn } from "./types.js";

export function executiveRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/projects/:id/executive-summary", (req, res) => {
    const summary = getExecutiveSummary(db, req.params.id as string);
    if (!summary) { res.status(404).json({ error: "Project not found" }); return; }
    res.json(summary);
  });

  return router;
}
