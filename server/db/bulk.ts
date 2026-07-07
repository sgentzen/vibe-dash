import type Database from "better-sqlite3";
import type { TaskDependency } from "../types.js";

export function getDependenciesForProject(
  db: Database.Database,
  projectId: string
): TaskDependency[] {
  return db
    .prepare(
      `SELECT td.* FROM task_dependencies td
       JOIN tasks tk ON tk.id = td.task_id
       WHERE tk.project_id = ?
       ORDER BY td.created_at ASC`
    )
    .all(projectId) as TaskDependency[];
}
