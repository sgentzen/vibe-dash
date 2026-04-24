import { Router } from "express";
import type Database from "better-sqlite3";
import {
  createWorktree,
  getWorktreeById,
  getTaskWorktree,
  listAllWorktrees,
  updateWorktreeStatus,
} from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import type { WorktreeStatus } from "../types.js";
import { requireEntity, handleMutation } from "./handlers.js";
import { validateBody } from "./validate.js";
import { createWorktreeSchema, updateWorktreeStatusSchema } from "../../shared/schemas.js";

export function worktreeRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/worktrees", (_req, res) => {
    res.json(listAllWorktrees(db));
  });

  // Record-only: the MCP create_worktree tool runs `git worktree add` before calling this
  router.post("/api/worktrees", validateBody(createWorktreeSchema), (req, res) => {
    const { task_id, repo_path, branch_name, worktree_path } = req.body as {
      task_id: string;
      repo_path: string;
      branch_name: string;
      worktree_path: string;
    };
    handleMutation(res, broadcast, () => createWorktree(db, { task_id, repo_path, branch_name, worktree_path }), "worktree_created", 201);
  });

  router.get("/api/tasks/:id/worktree", (req, res) => {
    const worktree = getTaskWorktree(db, req.params.id as string);
    if (!requireEntity(res, worktree, "Worktree")) return;
    res.json(worktree);
  });

  router.patch("/api/worktrees/:id", validateBody(updateWorktreeStatusSchema), (req, res) => {
    const existing = getWorktreeById(db, req.params.id as string);
    if (!requireEntity(res, existing, "Worktree")) return;
    const { status } = req.body as { status: WorktreeStatus };
    const updated = updateWorktreeStatus(db, req.params.id as string, status);
    if (!updated) { res.status(500).json({ error: "Update failed" }); return; }
    broadcast({ type: "worktree_updated", payload: updated });
    res.json(updated);
  });

  return router;
}
