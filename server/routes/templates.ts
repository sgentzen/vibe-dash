import { Router } from "express";
import type Database from "better-sqlite3";
import { createTemplate, listTemplates, getTemplate, deleteTemplate, createProjectFromTemplate } from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { requireEntity } from "./handlers.js";
import { validateBody } from "./validate.js";
import { createTemplateSchema, instantiateTemplateSchema } from "../../shared/schemas.js";

export function templateRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/templates", (_req, res) => {
    res.json(listTemplates(db));
  });

  router.post("/api/templates", validateBody(createTemplateSchema), (req, res) => {
    const { name, description, template_json } = req.body as { name: string; description?: string | null; template_json: string };
    res.status(201).json(createTemplate(db, name, description ?? null, template_json));
  });

  router.get("/api/templates/:id", (req, res) => {
    const t = getTemplate(db, req.params.id);
    if (!requireEntity(res, t, "Template")) return;
    res.json(t);
  });

  router.delete("/api/templates/:id", (req, res) => {
    res.json({ success: deleteTemplate(db, req.params.id) });
  });

  router.post("/api/templates/:id/instantiate", validateBody(instantiateTemplateSchema), (req, res) => {
    const { project_name } = req.body as { project_name: string };
    const project = createProjectFromTemplate(db, req.params.id, project_name);
    if (!requireEntity(res, project, "Template")) return;
    broadcast({ type: "project_created", payload: project });
    res.status(201).json(project);
  });

  return router;
}
