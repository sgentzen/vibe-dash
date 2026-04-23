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
import { requireEntity } from "./handlers.js";

const VALID_STATUSES: ReviewStatus[] = ["pending", "approved", "changes_requested"];

export function reviewRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/tasks/:id/reviews", (req, res) => {
    res.json(listReviewsForTask(db, req.params.id));
  });

  router.post("/api/tasks/:id/reviews", (req, res) => {
    const task = getTask(db, req.params.id);
    if (!task) { notFound(res, "Task not found"); return; }
    const { reviewer_name, reviewer_agent_id, status, comments, diff_summary } =
      req.body as {
        reviewer_name?: string;
        reviewer_agent_id?: string | null;
        status?: ReviewStatus;
        comments?: string | null;
        diff_summary?: string | null;
      };
    if (!reviewer_name) {
      badRequest(res, "reviewer_name is required");
      return;
    }
    if (reviewer_name.length > 200) {
      badRequest(res, "reviewer_name too long");
      return;
    }
    if (status && !VALID_STATUSES.includes(status)) {
      badRequest(res, `status must be one of: ${VALID_STATUSES.join(", ")}`);
      return;
    }
    const review = createReview(db, {
      task_id: req.params.id,
      reviewer_name,
      reviewer_agent_id: reviewer_agent_id ?? null,
      status,
      comments: comments ?? null,
      diff_summary: diff_summary ?? null,
    });
    broadcast({ type: "review_created", payload: review });
    res.status(201).json(review);
  });

  router.patch("/api/reviews/:id", (req, res) => {
    const existing = getReview(db, req.params.id);
    if (!requireEntity(res, existing, "Review")) return;
    const { status, comments, diff_summary } = req.body as {
      status?: ReviewStatus;
      comments?: string | null;
      diff_summary?: string | null;
    };
    if (status && !VALID_STATUSES.includes(status)) {
      badRequest(res, `status must be one of: ${VALID_STATUSES.join(", ")}`);
      return;
    }
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
