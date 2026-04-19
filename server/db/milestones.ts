import type Database from "better-sqlite3";
import type { Milestone, MilestoneStatus } from "../types.js";
import { now, genId } from "./helpers.js";

export interface CreateMilestoneInput {
  project_id: string;
  name: string;
  description?: string | null;
  acceptance_criteria?: string[];
  target_date?: string | null;
}

export interface UpdateMilestoneInput {
  name?: string;
  description?: string | null;
  acceptance_criteria?: string[];
  target_date?: string | null;
  status?: MilestoneStatus;
}

// SQLite stores acceptance_criteria as a JSON string; deserialize it on the way out.
function parseMilestone(row: Omit<Milestone, "acceptance_criteria"> & { acceptance_criteria: string }): Milestone {
  return {
    ...row,
    acceptance_criteria: JSON.parse(row.acceptance_criteria) as string[],
  };
}

export function createMilestone(
  db: Database.Database,
  input: CreateMilestoneInput
): Milestone {
  const id = genId();
  const ts = now();
  const criteria = JSON.stringify(input.acceptance_criteria ?? []);
  db.prepare(
    "INSERT INTO milestones (id, project_id, name, description, acceptance_criteria, target_date, status, created_at, updated_at)" +
    " VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)"
  ).run(
    id,
    input.project_id,
    input.name,
    input.description ?? null,
    criteria,
    input.target_date ?? null,
    ts,
    ts
  );
  return parseMilestone(db.prepare("SELECT * FROM milestones WHERE id = ?").get(id) as Milestone & { acceptance_criteria: string });
}

export function getMilestone(db: Database.Database, id: string): Milestone | null {
  const row = db.prepare("SELECT * FROM milestones WHERE id = ?").get(id) as (Milestone & { acceptance_criteria: string }) | undefined;
  return row ? parseMilestone(row) : null;
}

export function listMilestones(db: Database.Database, project_id?: string): Milestone[] {
  const rows = project_id
    ? db.prepare("SELECT * FROM milestones WHERE project_id = ? ORDER BY created_at ASC").all(project_id)
    : db.prepare("SELECT * FROM milestones ORDER BY created_at ASC").all();
  return (rows as (Milestone & { acceptance_criteria: string })[]).map(parseMilestone);
}

export function updateMilestone(
  db: Database.Database,
  id: string,
  input: UpdateMilestoneInput
): Milestone | null {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.description !== undefined) { sets.push("description = ?"); params.push(input.description); }
  if (input.acceptance_criteria !== undefined) {
    sets.push("acceptance_criteria = ?");
    params.push(JSON.stringify(input.acceptance_criteria));
  }
  if (input.target_date !== undefined) { sets.push("target_date = ?"); params.push(input.target_date); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }

  if (sets.length === 0) return getMilestone(db, id);

  sets.push("updated_at = ?");
  params.push(now());
  params.push(id);

  db.prepare("UPDATE milestones SET " + sets.join(", ") + " WHERE id = ?").run(...params);
  return getMilestone(db, id);
}

export function completeMilestone(db: Database.Database, id: string): Milestone | null {
  return updateMilestone(db, id, { status: "achieved" });
}

export function deleteMilestone(db: Database.Database, id: string): boolean {
  const result = db.prepare("DELETE FROM milestones WHERE id = ?").run(id);
  return result.changes > 0;
}
