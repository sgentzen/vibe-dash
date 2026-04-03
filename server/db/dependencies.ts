import type Database from "better-sqlite3";
import type { Task, TaskDependency } from "../types.js";
import { now, genId } from "./helpers.js";

export function addDependency(
  db: Database.Database,
  taskId: string,
  dependsOnTaskId: string
): TaskDependency {
  if (taskId === dependsOnTaskId) {
    throw new Error("A task cannot depend on itself");
  }
  const id = genId();
  const ts = now();
  db.prepare(
    "INSERT OR IGNORE INTO task_dependencies (id, task_id, depends_on_task_id, created_at) VALUES (?, ?, ?, ?)"
  ).run(id, taskId, dependsOnTaskId, ts);
  return db
    .prepare("SELECT * FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?")
    .get(taskId, dependsOnTaskId) as TaskDependency;
}

export function removeDependency(db: Database.Database, id: string): boolean {
  const result = db.prepare("DELETE FROM task_dependencies WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listDependencies(db: Database.Database, taskId: string): TaskDependency[] {
  return db
    .prepare("SELECT * FROM task_dependencies WHERE task_id = ? ORDER BY created_at ASC")
    .all(taskId) as TaskDependency[];
}

export function getBlockingTasks(db: Database.Database, taskId: string): Task[] {
  return db
    .prepare(
      `SELECT t.* FROM tasks t
       JOIN task_dependencies td ON t.id = td.depends_on_task_id
       WHERE td.task_id = ? AND t.status != 'done'
       ORDER BY t.created_at ASC`
    )
    .all(taskId) as Task[];
}
