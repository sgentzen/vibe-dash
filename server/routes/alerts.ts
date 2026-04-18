import { Router } from "express";
import type Database from "better-sqlite3";
import { createAlertRule, listAlertRules, toggleAlertRule, deleteAlertRule } from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { badRequest } from "./responses.js";
import { requireEntity } from "./handlers.js";

export function alertRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/alert-rules", (_req, res) => {
    res.json(listAlertRules(db));
  });

  router.post("/api/alert-rules", (req, res) => {
    const { event_type, filter_json } = req.body as { event_type: string; filter_json?: string };
    if (!event_type) { badRequest(res, "event_type is required"); return; }
    res.status(201).json(createAlertRule(db, event_type, filter_json));
  });

  router.patch("/api/alert-rules/:id", (req, res) => {
    const { enabled } = req.body as { enabled: boolean };
    const rule = toggleAlertRule(db, req.params.id, enabled);
    if (!requireEntity(res, rule, "Rule")) return;
    res.json(rule);
  });

  router.delete("/api/alert-rules/:id", (req, res) => {
    res.json({ success: deleteAlertRule(db, req.params.id) });
  });

  return router;
}
