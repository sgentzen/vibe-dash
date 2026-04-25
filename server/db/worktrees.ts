import type Database from "better-sqlite3";
import type { TaskWorktree, WorktreeStatus } from "../types.js";
import { now, genId } from "./helpers.js";

export interface CreateWorktreeInput {
  task_id: string;
  repo_path: string;
  branch_name: string;
  worktree_path: string;
}

export function createWorktree(db: Database.Database, input: CreateWorktreeInput): TaskWorktree {
  const id = genId();
  const ts = now();
  return db.prepare(
    `INSERT INTO task_worktrees (id, task_id, repo_path, branch_name, worktree_path, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
     RETURNING *`
  ).get(id, input.task_id, input.repo_path, input.branch_name, input.worktree_path, ts, ts) as TaskWorktree;
}

export function getWorktreeById(db: Database.Database, id: string): TaskWorktree | null {
  const row = db.prepare("SELECT * FROM task_worktrees WHERE id = ?").get(id) as TaskWorktree | undefined;
  return row ?? null;
}

export function getTaskWorktree(db: Database.Database, taskId: string): TaskWorktree | null {
  const row = db.prepare(
    "SELECT * FROM task_worktrees WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
  ).get(taskId) as TaskWorktree | undefined;
  return row ?? null;
}

export function listActiveWorktrees(db: Database.Database): TaskWorktree[] {
  return db
    .prepare("SELECT * FROM task_worktrees WHERE status = 'active' ORDER BY created_at DESC")
    .all() as TaskWorktree[];
}

export function listAllWorktrees(db: Database.Database): TaskWorktree[] {
  return db
    .prepare("SELECT * FROM task_worktrees ORDER BY created_at DESC")
    .all() as TaskWorktree[];
}

export function updateWorktreeStatus(
  db: Database.Database,
  id: string,
  status: WorktreeStatus
): TaskWorktree | null {
  const ts = now();
  const row = db.prepare(
    "UPDATE task_worktrees SET status = ?, updated_at = ? WHERE id = ? RETURNING *"
  ).get(status, ts, id) as TaskWorktree | undefined;
  return row ?? null;
}
