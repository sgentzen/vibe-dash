import type Database from "better-sqlite3";
import type { Project } from "../types.js";
import { now, genId } from "./helpers.js";

export function createProject(
  db: Database.Database,
  input: { name: string; description: string | null }
): Project {
  const id = genId();
  const ts = now();
  db.prepare(
    "INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, input.name, input.description ?? null, ts, ts);
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project;
}

export function updateProject(
  db: Database.Database,
  id: string,
  input: { name?: string; description?: string | null }
): Project | null {
  const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
  if (!existing) return null;

  const name = input.name ?? existing.name;
  const description = input.description !== undefined ? input.description : existing.description;
  const ts = now();

  db.prepare(
    "UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?"
  ).run(name, description, ts, id);

  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project;
}

export function listProjects(db: Database.Database): Project[] {
  return db
    .prepare("SELECT * FROM projects ORDER BY created_at ASC")
    .all() as Project[];
}
