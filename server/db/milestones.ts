import type Database from "better-sqlite3";
import type { Milestone, MilestoneProgress, MilestoneDailyStats, MilestoneStatus } from "../types.js";
import { now, genId } from "./helpers.js";

export interface CreateMilestoneInput {
  project_id: string;
  name: string;
  description?: string | null;
  acceptance_criteria?: string | null;
  target_date?: string | null;
  status?: MilestoneStatus;
}

export function createMilestone(
  db: Database.Database,
  input: CreateMilestoneInput
): Milestone {
  const id = genId();
  const ts = now();
  db.prepare(
    "INSERT INTO milestones (id, project_id, name, description, acceptance_criteria, target_date, status, created_at, updated_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    input.project_id,
    input.name,
    input.description ?? null,
    input.acceptance_criteria ?? "[]",
    input.target_date ?? null,
    input.status ?? "open",
    ts,
    ts
  );
  return db.prepare("SELECT * FROM milestones WHERE id = ?").get(id) as Milestone;
}

export interface UpdateMilestoneInput {
  name?: string;
  description?: string | null;
  acceptance_criteria?: string | null;
  target_date?: string | null;
  status?: MilestoneStatus;
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
  if (input.acceptance_criteria !== undefined) { sets.push("acceptance_criteria = ?"); params.push(input.acceptance_criteria); }
  if (input.target_date !== undefined) { sets.push("target_date = ?"); params.push(input.target_date); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }

  if (sets.length === 0) return getMilestone(db, id);

  sets.push("updated_at = ?");
  params.push(now());
  params.push(id);

  db.prepare("UPDATE milestones SET " + sets.join(", ") + " WHERE id = ?").run(...params);
  return getMilestone(db, id);
}

export function completeMilestone(
  db: Database.Database,
  id: string
): Milestone | null {
  return updateMilestone(db, id, { status: "achieved" });
}

export function getMilestone(db: Database.Database, id: string): Milestone | null {
  return (
    (db.prepare("SELECT * FROM milestones WHERE id = ?").get(id) as Milestone | undefined) ?? null
  );
}

export function listMilestones(
  db: Database.Database,
  projectId?: string
): Milestone[] {
  if (projectId) {
    return db
      .prepare("SELECT * FROM milestones WHERE project_id = ? ORDER BY created_at ASC")
      .all(projectId) as Milestone[];
  }
  return db
    .prepare("SELECT * FROM milestones ORDER BY created_at ASC")
    .all() as Milestone[];
}

// ─── Milestone Progress ─────────────────────────────────────────────────────

export function getMilestoneProgress(db: Database.Database, milestoneId: string): MilestoneProgress {
  const row = db.prepare(
    `SELECT
       COUNT(*) AS task_count,
       COUNT(CASE WHEN status = 'done' THEN 1 END) AS completed_count
     FROM tasks WHERE milestone_id = ?`
  ).get(milestoneId) as { task_count: number; completed_count: number };
  return {
    task_count: row.task_count,
    completed_count: row.completed_count,
    completion_pct: row.task_count > 0 ? Math.round((row.completed_count / row.task_count) * 100) : 0,
  };
}

// ─── Milestone Daily Stats ──────────────────────────────────────────────────

export function recordMilestoneDailyStats(db: Database.Database, milestoneId: string): MilestoneDailyStats {
  const today = new Date().toISOString().slice(0, 10);
  const progress = getMilestoneProgress(db, milestoneId);

  db.prepare(
    `INSERT OR REPLACE INTO milestone_daily_stats (milestone_id, date, completed_tasks, total_tasks, completion_pct)
     VALUES (?, ?, ?, ?, ?)`
  ).run(milestoneId, today, progress.completed_count, progress.task_count, progress.completion_pct);

  return db.prepare("SELECT * FROM milestone_daily_stats WHERE milestone_id = ? AND date = ?").get(milestoneId, today) as MilestoneDailyStats;
}

export function getMilestoneDailyStats(db: Database.Database, milestoneId: string): MilestoneDailyStats[] {
  return db
    .prepare("SELECT * FROM milestone_daily_stats WHERE milestone_id = ? ORDER BY date ASC")
    .all(milestoneId) as MilestoneDailyStats[];
}

// ─── Time Estimates ─────────────────────────────────────────────────────────

export function getTimeSpent(db: Database.Database, taskId: string): number | null {
  const first = db
    .prepare("SELECT MIN(timestamp) AS ts FROM activity_log WHERE task_id = ?")
    .get(taskId) as { ts: string | null } | undefined;
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as { status: string; updated_at: string } | undefined;
  if (!first?.ts || !task || task.status !== "done") return null;
  const start = new Date(first.ts).getTime();
  const end = new Date(task.updated_at).getTime();
  return Math.max(0, Math.round((end - start) / 1000));
}
