import type Database from "better-sqlite3";
import type { Project } from "../types.js";
import { now, genId } from "./helpers.js";

export function createProject(
  db: Database.Database,
  input: { name: string; description: string | null }
): Project {
  const id = genId();
  const ts = now();
  return db.prepare(
    "INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING *"
  ).get(id, input.name, input.description ?? null, ts, ts) as Project;
}

export function updateProject(
  db: Database.Database,
  id: string,
  input: { name?: string; description?: string | null }
): Project | null {
  const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
  if (!existing) return null;

  const name = input.name ?? existing.name;
  const description = input.description === undefined ? existing.description : input.description;
  const ts = now();

  const row = db.prepare(
    "UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ? RETURNING *"
  ).get(name, description, ts, id) as Project | undefined;

  return row ?? null;
}

export function listProjects(
  db: Database.Database,
  options: { includeArchived?: boolean } = {}
): Project[] {
  const where = options.includeArchived ? "" : "WHERE archived_at IS NULL";
  return db
    .prepare(`SELECT * FROM projects ${where} ORDER BY created_at ASC`)
    .all() as Project[];
}

export function getProject(db: Database.Database, id: string): Project | null {
  return (
    (db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined) ?? null
  );
}

/**
 * Soft-archives a project (sets `archived_at`). Never deletes anything —
 * tasks, milestones and cost history stay put, matching the "cost rows are
 * never deleted" precedent in server/db/costs.ts. Idempotent: archiving an
 * already-archived project is a no-op that returns null, so the route layer
 * can tell "nothing to do" apart from "doesn't exist" (via getProject first).
 */
export function archiveProject(db: Database.Database, id: string): Project | null {
  const ts = now();
  return (
    (db.prepare(
      "UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL RETURNING *"
    ).get(ts, ts, id) as Project | undefined) ?? null
  );
}

/** Reverses archiveProject. Idempotent in the same way — see archiveProject. */
export function unarchiveProject(db: Database.Database, id: string): Project | null {
  const ts = now();
  return (
    (db.prepare(
      "UPDATE projects SET archived_at = NULL, updated_at = ? WHERE id = ? AND archived_at IS NOT NULL RETURNING *"
    ).get(ts, id) as Project | undefined) ?? null
  );
}
