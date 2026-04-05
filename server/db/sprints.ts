import type Database from "better-sqlite3";
import type { Sprint, SprintCapacity, SprintDailyStats, VelocityData, SprintStatus } from "../types.js";
import { now, genId } from "./helpers.js";

export interface CreateSprintInput {
  project_id: string;
  name: string;
  description?: string | null;
  status?: SprintStatus;
  start_date?: string | null;
  end_date?: string | null;
}

export function createSprint(
  db: Database.Database,
  input: CreateSprintInput
): Sprint {
  const id = genId();
  const ts = now();
  db.prepare(
    "INSERT INTO sprints (id, project_id, name, description, status, start_date, end_date, created_at, updated_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    input.project_id,
    input.name,
    input.description ?? null,
    input.status ?? "planned",
    input.start_date ?? null,
    input.end_date ?? null,
    ts,
    ts
  );
  return db.prepare("SELECT * FROM sprints WHERE id = ?").get(id) as Sprint;
}

export interface UpdateSprintInput {
  name?: string;
  description?: string | null;
  status?: SprintStatus;
  start_date?: string | null;
  end_date?: string | null;
}

export function updateSprint(
  db: Database.Database,
  id: string,
  input: UpdateSprintInput
): Sprint | null {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.description !== undefined) { sets.push("description = ?"); params.push(input.description); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }
  if (input.start_date !== undefined) { sets.push("start_date = ?"); params.push(input.start_date); }
  if (input.end_date !== undefined) { sets.push("end_date = ?"); params.push(input.end_date); }

  if (sets.length === 0) return getSprint(db, id);

  sets.push("updated_at = ?");
  params.push(now());
  params.push(id);

  db.prepare("UPDATE sprints SET " + sets.join(", ") + " WHERE id = ?").run(...params);
  return getSprint(db, id);
}

export function getSprint(db: Database.Database, id: string): Sprint | null {
  return (
    (db.prepare("SELECT * FROM sprints WHERE id = ?").get(id) as Sprint | undefined) ?? null
  );
}

export function listSprints(
  db: Database.Database,
  projectId?: string
): Sprint[] {
  if (projectId) {
    return db
      .prepare("SELECT * FROM sprints WHERE project_id = ? ORDER BY created_at ASC")
      .all(projectId) as Sprint[];
  }
  return db
    .prepare("SELECT * FROM sprints ORDER BY created_at ASC")
    .all() as Sprint[];
}

// ─── Sprint Capacity ────────────────────────────────────────────────────────

export function getSprintCapacity(db: Database.Database, sprintId: string): SprintCapacity {
  const row = db.prepare(
    `SELECT
       COUNT(*) AS task_count,
       COUNT(CASE WHEN status = 'done' THEN 1 END) AS completed_count,
       COALESCE(SUM(estimate), 0) AS total_estimated,
       COALESCE(SUM(CASE WHEN status = 'done' THEN estimate ELSE 0 END), 0) AS completed_points
     FROM tasks WHERE sprint_id = ?`
  ).get(sprintId) as { task_count: number; completed_count: number; total_estimated: number; completed_points: number };
  return {
    total_estimated: row.total_estimated,
    completed_points: row.completed_points,
    remaining_points: row.total_estimated - row.completed_points,
    task_count: row.task_count,
    completed_count: row.completed_count,
  };
}

// ─── Sprint Daily Stats & Velocity ──────────────────────────────────────────

export function recordDailyStats(db: Database.Database, sprintId: string): SprintDailyStats {
  const today = new Date().toISOString().slice(0, 10);
  const cap = getSprintCapacity(db, sprintId);

  db.prepare(
    `INSERT OR REPLACE INTO sprint_daily_stats (sprint_id, date, completed_points, remaining_points, completed_tasks, remaining_tasks)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sprintId, today, cap.completed_points, cap.remaining_points, cap.completed_count, cap.task_count - cap.completed_count);

  return db.prepare("SELECT * FROM sprint_daily_stats WHERE sprint_id = ? AND date = ?").get(sprintId, today) as SprintDailyStats;
}

export function getSprintDailyStats(db: Database.Database, sprintId: string): SprintDailyStats[] {
  return db
    .prepare("SELECT * FROM sprint_daily_stats WHERE sprint_id = ? ORDER BY date ASC")
    .all(sprintId) as SprintDailyStats[];
}

export function getVelocityTrend(db: Database.Database, limit = 5, projectId?: string): VelocityData[] {
  const whereClause = projectId
    ? `WHERE (s.status = 'completed' OR s.status = 'active') AND s.project_id = ?`
    : `WHERE s.status = 'completed' OR s.status = 'active'`;
  const params = projectId ? [projectId, limit] : [limit];
  return db.prepare(
    `SELECT s.id AS sprint_id, s.name AS sprint_name,
       COALESCE(SUM(CASE WHEN t.status = 'done' THEN t.estimate ELSE 0 END), 0) AS completed_points,
       COUNT(CASE WHEN t.status = 'done' THEN 1 END) AS completed_tasks
     FROM sprints s
     LEFT JOIN tasks t ON t.sprint_id = s.id
     ${whereClause}
     GROUP BY s.id, s.name
     ORDER BY s.created_at DESC
     LIMIT ?`
  ).all(...params) as VelocityData[];
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
