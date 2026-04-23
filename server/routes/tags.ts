import { Router } from "express";
import type Database from "better-sqlite3";
import { createTag, listTags, addTagToTask, removeTagFromTask, getTaskTags } from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { badRequest } from "./responses.js";
import { validateBody } from "./validate.js";
import { createTagSchema, addTagToTaskSchema } from "../../shared/schemas.js";

export function tagRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/projects/:projectId/tags", (req, res) => {
    res.json(listTags(db, req.params.projectId));
  });

  router.post("/api/projects/:projectId/tags", validateBody(createTagSchema), (req, res) => {
    const { name, color } = req.body as { name: string; color?: string };
    const tag = createTag(db, { project_id: req.params.projectId, name, color });
    broadcast({ type: "tag_created", payload: tag });
    res.status(201).json(tag);
  });

  router.get("/api/tasks/:id/tags", (req, res) => {
    res.json(getTaskTags(db, req.params.id));
  });

  router.post("/api/tasks/:id/tags", validateBody(addTagToTaskSchema), (req, res) => {
    const { tag_id } = req.body as { tag_id: string };
    const taskTag = addTagToTask(db, req.params.id, tag_id);
    broadcast({ type: "tag_added", payload: taskTag });
    res.status(201).json(taskTag);
  });

  router.delete("/api/tasks/:id/tags/:tagId", (req, res) => {
    const removed = removeTagFromTask(db, req.params.id, req.params.tagId);
    if (removed) {
      broadcast({ type: "tag_removed", payload: { id: "", task_id: req.params.id, tag_id: req.params.tagId } });
    }
    res.json({ success: removed });
  });

  return router;
}
