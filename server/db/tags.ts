import type Database from "better-sqlite3";
import type { Tag, TaskTag } from "../types.js";
import { now, genId } from "./helpers.js";

export interface CreateTagInput {
  project_id: string;
  name: string;
  color?: string;
}

export function createTag(db: Database.Database, input: CreateTagInput): Tag {
  const id = genId();
  const ts = now();
  db.prepare(
    "INSERT INTO tags (id, project_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, input.project_id, input.name, input.color ?? "#6366f1", ts);
  return db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as Tag;
}

export function listTags(db: Database.Database, projectId: string): Tag[] {
  return db
    .prepare("SELECT * FROM tags WHERE project_id = ? ORDER BY name ASC")
    .all(projectId) as Tag[];
}

export function addTagToTask(
  db: Database.Database,
  taskId: string,
  tagId: string
): TaskTag {
  const id = genId();
  db.prepare(
    "INSERT OR IGNORE INTO task_tags (id, task_id, tag_id) VALUES (?, ?, ?)"
  ).run(id, taskId, tagId);
  return db
    .prepare("SELECT * FROM task_tags WHERE task_id = ? AND tag_id = ?")
    .get(taskId, tagId) as TaskTag;
}

export function removeTagFromTask(
  db: Database.Database,
  taskId: string,
  tagId: string
): boolean {
  const result = db
    .prepare("DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?")
    .run(taskId, tagId);
  return result.changes > 0;
}

export function getTaskTags(db: Database.Database, taskId: string): Tag[] {
  return db
    .prepare(
      "SELECT t.* FROM tags t JOIN task_tags tt ON t.id = tt.tag_id WHERE tt.task_id = ? ORDER BY t.name ASC"
    )
    .all(taskId) as Tag[];
}

export function getTag(db: Database.Database, id: string): Tag | null {
  return (
    (db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as Tag | undefined) ?? null
  );
}
