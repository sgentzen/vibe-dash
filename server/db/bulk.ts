import type Database from "better-sqlite3";
import type { Tag, TaskDependency } from "../types.js";

export interface TaskTagPair {
  task_id: string;
  tag: Tag;
}

export function getTaskTagsForProject(
  db: Database.Database,
  projectId: string
): TaskTagPair[] {
  const rows = db
    .prepare(
      `SELECT tt.task_id AS task_id, t.id, t.project_id, t.name, t.color, t.created_at
       FROM task_tags tt
       JOIN tags t ON t.id = tt.tag_id
       JOIN tasks tk ON tk.id = tt.task_id
       WHERE tk.project_id = ?
       ORDER BY tt.task_id, t.name ASC`
    )
    .all(projectId) as Array<{
      task_id: string;
      id: string;
      project_id: string;
      name: string;
      color: string;
      created_at: string;
    }>;
  return rows.map((r) => ({
    task_id: r.task_id,
    tag: { id: r.id, project_id: r.project_id, name: r.name, color: r.color, created_at: r.created_at },
  }));
}

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
