import type Database from "better-sqlite3";
import type { Milestone, MilestoneStatus } from "../types.js";
import { now, genId } from "./helpers.js";

export interface CreateMilestoneInput {
  project_id: string;
  title: string;
  description?: string | null;
  due_date?: string | null;
}

export function createMilestone(
  db: Database.Database,
  input: CreateMilestoneInput
): Milestone {
  const id = genId();
  const ts = now();
  db.prepare(
    "INSERT INTO milestones (id, project_id, title, description, status, due_date, completed_at, created_at, updated_at)" +
      " VALUES (?, ?, ?, ?, 'open', ?, NULL, ?, ?)"
  ).run(
    id,
    input.project_id,
    input.title,
    input.description ?? null,
    input.due_date ?? null,
    ts,
    ts
  );
  return db.prepare("SELECT * FROM milestones WHERE id = ?").get(id) as Milestone;
}

export function getMilestone(db: Database.Database, id: string): Milestone | null {
  return (
    (db.prepare("SELECT * FROM milestones WHERE id = ?").get(id) as Milestone | undefined) ?? null
  );
}

export interface UpdateMilestoneInput {
  title?: string;
  description?: string | null;
  status?: MilestoneStatus;
  due_date?: string | null;
}

export function updateMilestone(
  db: Database.Database,
  id: string,
  input: UpdateMilestoneInput
): Milestone | null {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.title !== undefined) {
    sets.push("title = ?");
    params.push(input.title);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.due_date !== undefined) {
    sets.push("due_date = ?");
    params.push(input.due_date);
  }

  if (sets.length === 0) return getMilestone(db, id);

  sets.push("updated_at = ?");
  params.push(now());
  params.push(id);

  db.prepare("UPDATE milestones SET " + sets.join(", ") + " WHERE id = ?").run(
    ...params
  );
  return getMilestone(db, id);
}

export function completeMilestone(db: Database.Database, id: string): Milestone | null {
  const ts = now();
  db.prepare(
    "UPDATE milestones SET status = 'closed', completed_at = ?, updated_at = ? WHERE id = ?"
  ).run(ts, ts, id);
  return getMilestone(db, id);
}

export function listMilestones(
  db: Database.Database,
  projectId: string,
  status?: MilestoneStatus
): Milestone[] {
  if (status) {
    return db
      .prepare("SELECT * FROM milestones WHERE project_id = ? AND status = ? ORDER BY created_at ASC")
      .all(projectId, status) as Milestone[];
  }
  return db
    .prepare("SELECT * FROM milestones WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as Milestone[];
}
