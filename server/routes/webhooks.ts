import { Router } from "express";
import type Database from "better-sqlite3";
import { createWebhook, listWebhooks, updateWebhook, deleteWebhook } from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { requireEntity } from "./handlers.js";
import { validateBody } from "./validate.js";
import { createWebhookSchema, updateWebhookSchema } from "../../shared/schemas.js";

export function webhookRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/webhooks", (_req, res) => {
    res.json(listWebhooks(db));
  });

  router.post("/api/webhooks", validateBody(createWebhookSchema), (req, res) => {
    const { url, event_types } = req.body as { url: string; event_types: string[] };
    res.status(201).json(createWebhook(db, url, event_types));
  });

  router.patch("/api/webhooks/:id", validateBody(updateWebhookSchema), (req, res) => {
    const updates = req.body as { url?: string; event_types?: string[]; active?: boolean };
    const hook = updateWebhook(db, req.params.id as string, updates);
    if (!requireEntity(res, hook, "Webhook")) return;
    res.json(hook);
  });

  router.delete("/api/webhooks/:id", (req, res) => {
    res.json({ success: deleteWebhook(db, req.params.id as string) });
  });

  return router;
}
