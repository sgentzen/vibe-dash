import { Router } from "express";
import type Database from "better-sqlite3";
import { listProjects, createProject } from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { handleMutation } from "./handlers.js";
import { validateBody } from "./validate.js";
import { createProjectSchema } from "../../shared/schemas.js";

export function projectRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/projects", (_req, res) => {
    res.json(listProjects(db));
  });

  router.post("/api/projects", validateBody(createProjectSchema), (req, res) => {
    const { name, description } = req.body as { name: string; description?: string | null };
    handleMutation(res, broadcast, () => createProject(db, { name, description: description ?? null }), "project_created", 201);
  });

  return router;
}
