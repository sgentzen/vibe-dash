import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import {
  createProject,
  createTask,
  createWorktree,
  getWorktreeById,
  getTaskWorktree,
  listActiveWorktrees,
  updateWorktreeStatus,
} from "../server/db/index.js";
import { createTestDb } from "./setup.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

describe("Git Worktree DB", () => {
  function makeTaskAndProject() {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });
    return { project, task };
  }

  it("creates a worktree with active status", () => {
    const { task } = makeTaskAndProject();
    const wt = createWorktree(db, {
      task_id: task.id,
      repo_path: "/repo",
      branch_name: "feat/wt",
      worktree_path: "/tmp/wt",
    });
    expect(wt.status).toBe("active");
    expect(wt.task_id).toBe(task.id);
    expect(wt.branch_name).toBe("feat/wt");
  });

  it("gets worktree by id", () => {
    const { task } = makeTaskAndProject();
    const wt = createWorktree(db, { task_id: task.id, repo_path: "/r", branch_name: "b", worktree_path: "/p" });
    expect(getWorktreeById(db, wt.id)?.id).toBe(wt.id);
  });

  it("returns null for missing worktree id", () => {
    expect(getWorktreeById(db, "nope")).toBeNull();
  });

  it("gets the latest worktree for a task", () => {
    const { task } = makeTaskAndProject();
    createWorktree(db, { task_id: task.id, repo_path: "/r", branch_name: "b1", worktree_path: "/p1" });
    const wt2 = createWorktree(db, { task_id: task.id, repo_path: "/r", branch_name: "b2", worktree_path: "/p2" });
    const found = getTaskWorktree(db, task.id);
    expect(found?.id).toBe(wt2.id);
  });

  it("returns null when no worktree exists for a task", () => {
    const { task } = makeTaskAndProject();
    expect(getTaskWorktree(db, task.id)).toBeNull();
  });

  it("lists only active worktrees", () => {
    const { task } = makeTaskAndProject();
    const wt1 = createWorktree(db, { task_id: task.id, repo_path: "/r", branch_name: "b1", worktree_path: "/p1" });
    const wt2 = createWorktree(db, { task_id: task.id, repo_path: "/r", branch_name: "b2", worktree_path: "/p2" });
    updateWorktreeStatus(db, wt1.id, "merged");
    const active = listActiveWorktrees(db);
    const ids = active.map((w) => w.id);
    expect(ids).toContain(wt2.id);
    expect(ids).not.toContain(wt1.id);
  });

  it("updates worktree status", () => {
    const { task } = makeTaskAndProject();
    const wt = createWorktree(db, { task_id: task.id, repo_path: "/r", branch_name: "b", worktree_path: "/p" });
    const updated = updateWorktreeStatus(db, wt.id, "merged");
    expect(updated?.status).toBe("merged");
  });

  it("returns null when updating a missing worktree", () => {
    expect(updateWorktreeStatus(db, "nope", "removed")).toBeNull();
  });
});
