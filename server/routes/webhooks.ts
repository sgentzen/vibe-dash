import { Router } from "express";
import type Database from "better-sqlite3";
import { createWebhook, listWebhooks, updateWebhook, deleteWebhook } from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { badRequest } from "./responses.js";
import { requireEntity } from "./handlers.js";

export function webhookRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/webhooks", (_req, res) => {
    res.json(listWebhooks(db));
  });

  router.post("/api/webhooks", (req, res) => {
    const { url, event_types } = req.body as { url: string; event_types: string[] };
    if (!url || !event_types || !Array.isArray(event_types)) { badRequest(res, "url and event_types (array) are required"); return; }
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) { badRequest(res, "Only http/https URLs allowed"); return; }
    } catch { badRequest(res, "Invalid URL"); return; }
    res.status(201).json(createWebhook(db, url, event_types));
  });

  router.patch("/api/webhooks/:id", (req, res) => {
    const updates = req.body as { url?: string; event_types?: string[]; active?: boolean };
    const hook = updateWebhook(db, req.params.id, updates);
    if (!requireEntity(res, hook, "Webhook")) return;
    res.json(hook);
  });

  router.delete("/api/webhooks/:id", (req, res) => {
    res.json({ success: deleteWebhook(db, req.params.id) });
  });

  return router;
}
