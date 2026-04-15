import { Router } from "express";
import type Database from "better-sqlite3";
import { createTemplate, listTemplates, getTemplate, deleteTemplate, createProjectFromTemplate } from "../db/index.js";
import type { BroadcastFn } from "./types.js";

export function templateRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/templates", (_req, res) => {
    res.json(listTemplates(db));
  });

  router.post("/api/templates", (req, res) => {
    const { name, description, template_json } = req.body as { name: string; description?: string; template_json: string };
    if (!name || !template_json) { res.status(400).json({ error: "name and template_json are required" }); return; }
    res.status(201).json(createTemplate(db, name, description ?? null, template_json));
  });

  router.get("/api/templates/:id", (req, res) => {
    const t = getTemplate(db, req.params.id);
    if (!t) { res.status(404).json({ error: "Template not found" }); return; }
    res.json(t);
  });

  router.delete("/api/templates/:id", (req, res) => {
    res.json({ success: deleteTemplate(db, req.params.id) });
  });

  router.post("/api/templates/:id/instantiate", (req, res) => {
    const { project_name } = req.body as { project_name: string };
    if (!project_name) { res.status(400).json({ error: "project_name is required" }); return; }
    const project = createProjectFromTemplate(db, req.params.id, project_name);
    if (!project) { res.status(404).json({ error: "Template not found" }); return; }
    broadcast({ type: "project_created", payload: project });
    res.status(201).json(project);
  });

  return router;
}
