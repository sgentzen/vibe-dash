import { Router } from "express";
import type Database from "better-sqlite3";
import { createWebhook, listWebhooks, updateWebhook, deleteWebhook } from "../db/index.js";
import type { BroadcastFn } from "./types.js";

export function webhookRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/webhooks", (_req, res) => {
    res.json(listWebhooks(db));
  });

  router.post("/api/webhooks", (req, res) => {
    const { url, event_types } = req.body as { url: string; event_types: string[] };
    if (!url || !event_types || !Array.isArray(event_types)) { res.status(400).json({ error: "url and event_types (array) are required" }); return; }
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) { res.status(400).json({ error: "Only http/https URLs allowed" }); return; }
    } catch { res.status(400).json({ error: "Invalid URL" }); return; }
    res.status(201).json(createWebhook(db, url, event_types));
  });

  router.patch("/api/webhooks/:id", (req, res) => {
    const updates = req.body as { url?: string; event_types?: string[]; active?: boolean };
    const hook = updateWebhook(db, req.params.id, updates);
    if (!hook) { res.status(404).json({ error: "Webhook not found" }); return; }
    res.json(hook);
  });

  router.delete("/api/webhooks/:id", (req, res) => {
    res.json({ success: deleteWebhook(db, req.params.id) });
  });

  return router;
}
