import { Router } from "express";
import type Database from "better-sqlite3";
import { createTag, listTags, addTagToTask, removeTagFromTask, getTaskTags } from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { handleMutation } from "./handlers.js";
import { validateBody } from "./validate.js";
import { createTagSchema, addTagToTaskSchema } from "../../shared/schemas.js";

export function tagRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/projects/:projectId/tags", (req, res) => {
    res.json(listTags(db, req.params.projectId));
  });

  router.post("/api/projects/:projectId/tags", validateBody(createTagSchema), (req, res) => {
    const { name, color } = req.body as { name: string; color?: string };
    handleMutation(res, broadcast, () => createTag(db, { project_id: req.params.projectId, name, color }), "tag_created", 201);
  });

  router.get("/api/tasks/:id/tags", (req, res) => {
    res.json(getTaskTags(db, req.params.id));
  });

  router.post("/api/tasks/:id/tags", validateBody(addTagToTaskSchema), (req, res) => {
    const { tag_id } = req.body as { tag_id: string };
    handleMutation(res, broadcast, () => addTagToTask(db, req.params.id, tag_id), "tag_added", 201);
  });

  router.delete("/api/tasks/:id/tags/:tagId", (req, res) => {
    const removed = removeTagFromTask(db, req.params.id, req.params.tagId);
    if (removed) {
      broadcast({ type: "tag_removed", payload: removed });
    }
    res.json({ success: removed !== null });
  });

  return router;
}
