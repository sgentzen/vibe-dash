import type Database from "better-sqlite3";
import type { Blocker } from "../types.js";
import { now, genId } from "./helpers.js";
import { updateTask } from "./tasks.js";

export interface CreateBlockerInput {
  task_id: string;
  reason: string;
}

export function createBlocker(
  db: Database.Database,
  input: CreateBlockerInput
): Blocker {
  const id = genId();
  const ts = now();
  const blocker = db.prepare(
    "INSERT INTO blockers (id, task_id, reason, reported_at, resolved_at) VALUES (?, ?, ?, ?, NULL) RETURNING *"
  ).get(id, input.task_id, input.reason, ts) as Blocker;
  // Only change status if task isn't already done
  const task = db.prepare("SELECT status FROM tasks WHERE id = ?").get(input.task_id) as { status: string } | undefined;
  if (task && task.status !== "done") {
    updateTask(db, input.task_id, { status: "blocked" });
  }
  return blocker;
}

export function resolveBlocker(
  db: Database.Database,
  id: string
): Blocker | null {
  const blocker = db
    .prepare("SELECT * FROM blockers WHERE id = ?")
    .get(id) as Blocker | undefined;
  if (!blocker) return null;
  const ts = now();
  const updated = db.prepare("UPDATE blockers SET resolved_at = ? WHERE id = ? RETURNING *").get(ts, id) as Blocker | undefined;
  // Only change status if task is currently blocked (don't overwrite "done")
  const task = db.prepare("SELECT status FROM tasks WHERE id = ?").get(blocker.task_id) as { status: string } | undefined;
  if (task && task.status === "blocked") {
    updateTask(db, blocker.task_id, { status: "in_progress" });
  }
  return updated ?? null;
}

export function getActiveBlockers(db: Database.Database): Blocker[] {
  return db
    .prepare(
      "SELECT * FROM blockers WHERE resolved_at IS NULL ORDER BY reported_at ASC"
    )
    .all() as Blocker[];
}
