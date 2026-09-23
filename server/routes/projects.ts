import { Router } from "express";
import type Database from "better-sqlite3";
import { listProjects, createProject, getProject, archiveProject, unarchiveProject } from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { handleMutation, requireEntity } from "./handlers.js";
import { validateBody } from "./validate.js";
import { createProjectSchema } from "../../shared/schemas.js";
import { dependencyDeleteLimiter } from "./middleware.js";
import { logger } from "../logger.js";

export function projectRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/projects", (req, res) => {
    const includeArchived = req.query.include_archived === "true";
    res.json(listProjects(db, { includeArchived }));
  });

  router.post("/api/projects", validateBody(createProjectSchema), (req, res) => {
    const { name, description } = req.body as { name: string; description?: string | null };
    handleMutation(res, broadcast, () => createProject(db, { name, description: description ?? null }), "project_created", 201);
  });

  // Soft archive/unarchive: never deletes the project or anything under it
  // (tasks, milestones, cost history all stay). See server/db/projects.ts.
  router.post("/api/projects/:id/archive", dependencyDeleteLimiter, (req, res) => {
    const existing = getProject(db, req.params.id as string);
    if (!requireEntity(res, existing, "Project")) return;
    const archived = archiveProject(db, req.params.id as string);
    const project = archived ?? existing;
    if (archived) {
      broadcast({ type: "project_archived", payload: archived });
      // No activity_log entry: that table is task-scoped (NOT NULL task_id)
      // and archiving is a project-level action with no task involved.
      logger.info({ project_id: project.id }, "project archived");
    }
    res.json(project);
  });

  router.post("/api/projects/:id/unarchive", dependencyDeleteLimiter, (req, res) => {
    const existing = getProject(db, req.params.id as string);
    if (!requireEntity(res, existing, "Project")) return;
    const unarchived = unarchiveProject(db, req.params.id as string);
    const project = unarchived ?? existing;
    if (unarchived) {
      broadcast({ type: "project_unarchived", payload: unarchived });
      logger.info({ project_id: project.id }, "project unarchived");
    }
    res.json(project);
  });

  return router;
}
