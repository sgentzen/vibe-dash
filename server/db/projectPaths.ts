import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { normalisePath } from "../ingest/transcripts/attribute.js";

export interface ProjectPath {
  id: string;
  project_id: string;
  path: string;
  created_at: string;
}

/**
 * Link a directory to a project so transcript spend from it is attributed.
 *
 * Always a deliberate act: nothing in the ingestion path calls this. Attributing
 * money to the wrong project is worse than leaving it unattributed, and a silent
 * wrong attribution cannot be spotted from the UI.
 */
export function linkProjectPath(db: Database.Database, projectId: string, rawPath: string): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO project_paths (id, project_id, path, created_at) VALUES (?, ?, ?, ?)`
  ).run(id, projectId, normalisePath(rawPath), new Date().toISOString());
  return id;
}

export function listProjectPaths(db: Database.Database, projectId?: string): ProjectPath[] {
  if (projectId) {
    return db.prepare(`SELECT * FROM project_paths WHERE project_id = ? ORDER BY path`).all(projectId) as ProjectPath[];
  }
  return db.prepare(`SELECT * FROM project_paths ORDER BY path`).all() as ProjectPath[];
}

export function unlinkProjectPath(db: Database.Database, id: string): boolean {
  return db.prepare(`DELETE FROM project_paths WHERE id = ?`).run(id).changes > 0;
}
