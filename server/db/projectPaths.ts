import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { normalisePath, isRootPath } from "../ingest/transcripts/attribute.js";

export interface ProjectPath {
  id: string;
  project_id: string;
  path: string;
  created_at: string;
}

/**
 * Thrown when the requested link would claim a whole filesystem or drive.
 *
 * A distinct type so the route can answer 400 rather than lumping it in with
 * the UNIQUE violation that means "already linked".
 */
export class RootPathError extends Error {
  constructor(path: string) {
    super(
      `Refusing to link "${path}": it names a whole filesystem or drive, so every ` +
        `transcript on this machine would be attributed to one project. Link the ` +
        `specific project directories instead.`
    );
    this.name = "RootPathError";
  }
}

/**
 * Link a directory to a project so transcript spend from it is attributed.
 *
 * Always a deliberate act: nothing in the ingestion path calls this. Attributing
 * money to the wrong project is worse than leaving it unattributed, and a silent
 * wrong attribution cannot be spotted from the UI.
 */
export function linkProjectPath(db: Database.Database, projectId: string, rawPath: string): string {
  const path = normalisePath(rawPath);
  if (isRootPath(path)) throw new RootPathError(path);

  const id = randomUUID();
  db.prepare(
    `INSERT INTO project_paths (id, project_id, path, created_at) VALUES (?, ?, ?, ?)`
  ).run(id, projectId, path, new Date().toISOString());
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
