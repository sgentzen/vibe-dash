import { Router } from "express";
import type Database from "better-sqlite3";
import {
  createReview,
  getReview,
  listReviewsForTask,
  updateReview,
  getTask,
} from "../db/index.js";
import type { ReviewStatus } from "../types.js";
import type { BroadcastFn } from "./types.js";
import { badRequest, notFound } from "./responses.js";
import { requireEntity, handleMutation } from "./handlers.js";
import { createReviewSchema, updateReviewSchema } from "../../shared/schemas.js";
import { validateBody } from "./validate.js";

export function reviewRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/tasks/:id/reviews", (req, res) => {
    res.json(listReviewsForTask(db, req.params.id));
  });

  router.post("/api/tasks/:id/reviews", validateBody(createReviewSchema), (req, res) => {
    const task = getTask(db, req.params.id);
    if (!task) { notFound(res, "Task not found"); return; }
    const { reviewer_name, reviewer_agent_id, status, comments, diff_summary } = req.body as {
      reviewer_name: string;
      reviewer_agent_id?: string | null;
      status?: ReviewStatus;
      comments?: string | null;
      diff_summary?: string | null;
    };
    handleMutation(res, broadcast, () => createReview(db, {
      task_id: req.params.id,
      reviewer_name,
      reviewer_agent_id: reviewer_agent_id ?? null,
      status,
      comments: comments ?? null,
      diff_summary: diff_summary ?? null,
    }), "review_created", 201);
  });

  router.patch("/api/reviews/:id", validateBody(updateReviewSchema), (req, res) => {
    const existing = getReview(db, req.params.id);
    if (!requireEntity(res, existing, "Review")) return;
    const { status, comments, diff_summary } = req.body as {
      status?: ReviewStatus;
      comments?: string | null;
      diff_summary?: string | null;
    };
    const updated = updateReview(db, req.params.id, { status, comments, diff_summary });
    if (!updated) {
      badRequest(res, "Review update failed");
      return;
    }
    broadcast({ type: "review_updated", payload: updated });
    res.json(updated);
  });

  return router;
}
