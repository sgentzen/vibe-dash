import type Database from "better-sqlite3";
import type { TaskReview, ReviewStatus } from "../types.js";
import { now, genId } from "./helpers.js";

export interface CreateReviewInput {
  task_id: string;
  reviewer_agent_id?: string | null;
  reviewer_name: string;
  status?: ReviewStatus;
  comments?: string | null;
  diff_summary?: string | null;
}

export interface UpdateReviewInput {
  status?: ReviewStatus;
  comments?: string | null;
  diff_summary?: string | null;
}

export function createReview(
  db: Database.Database,
  input: CreateReviewInput
): TaskReview {
  const id = genId();
  const ts = now();
  return db.prepare(
    `INSERT INTO task_reviews
       (id, task_id, reviewer_agent_id, reviewer_name, status, comments, diff_summary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`
  ).get(
    id,
    input.task_id,
    input.reviewer_agent_id ?? null,
    input.reviewer_name,
    input.status ?? "pending",
    input.comments ?? null,
    input.diff_summary ?? null,
    ts,
    ts
  ) as TaskReview;
}

export function getReview(db: Database.Database, id: string): TaskReview | null {
  const row = db.prepare("SELECT * FROM task_reviews WHERE id = ?").get(id) as TaskReview | undefined;
  return row ?? null;
}

export function listReviewsForTask(db: Database.Database, taskId: string): TaskReview[] {
  return db
    .prepare("SELECT * FROM task_reviews WHERE task_id = ? ORDER BY created_at DESC")
    .all(taskId) as TaskReview[];
}

export function updateReview(
  db: Database.Database,
  id: string,
  patch: UpdateReviewInput
): TaskReview | null {
  const existing = getReview(db, id);
  if (!existing) return null;
  const next = {
    status: patch.status ?? existing.status,
    comments: patch.comments !== undefined ? patch.comments : existing.comments,
    diff_summary: patch.diff_summary !== undefined ? patch.diff_summary : existing.diff_summary,
    updated_at: now(),
  };
  return db.prepare(
    `UPDATE task_reviews
     SET status = ?, comments = ?, diff_summary = ?, updated_at = ?
     WHERE id = ?
     RETURNING *`
  ).get(next.status, next.comments, next.diff_summary, next.updated_at, id) as TaskReview;
}
