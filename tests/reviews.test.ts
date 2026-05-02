import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import {
  createProject,
  createTask,
  createReview,
  getReview,
  listReviewsForTask,
  updateReview,
} from "../server/db/index.js";
import { createTestDb } from "./setup.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

describe("5.4 Code Review Integration", () => {
  it("creates a review with defaults", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });
    const review = createReview(db, {
      task_id: task.id,
      reviewer_name: "alice",
      diff_summary: "+10 -3",
    });
    expect(review.status).toBe("pending");
    expect(review.reviewer_name).toBe("alice");
    expect(review.diff_summary).toBe("+10 -3");
    expect(review.comments).toBeNull();
  });

  it("lists reviews for a task", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });
    const r1 = createReview(db, { task_id: task.id, reviewer_name: "a" });
    const r2 = createReview(db, { task_id: task.id, reviewer_name: "b" });
    const ids = new Set(listReviewsForTask(db, task.id).map((r) => r.id));
    expect(ids).toEqual(new Set([r1.id, r2.id]));
  });

  it("updates review status to approved", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });
    const review = createReview(db, { task_id: task.id, reviewer_name: "a" });
    const updated = updateReview(db, review.id, { status: "approved", comments: "LGTM" });
    expect(updated?.status).toBe("approved");
    expect(updated?.comments).toBe("LGTM");
    expect(getReview(db, review.id)?.status).toBe("approved");
  });

  it("returns null when updating a missing review", () => {
    expect(updateReview(db, "does-not-exist", { status: "approved" })).toBeNull();
  });

  it("preserves existing fields when patching only status", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });
    const review = createReview(db, {
      task_id: task.id,
      reviewer_name: "a",
      comments: "initial",
      diff_summary: "diff",
    });
    const updated = updateReview(db, review.id, { status: "changes_requested" });
    expect(updated?.comments).toBe("initial");
    expect(updated?.diff_summary).toBe("diff");
    expect(updated?.status).toBe("changes_requested");
  });
});
