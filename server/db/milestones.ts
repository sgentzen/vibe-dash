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

export interface UpdateMilestoneInput {
  name?: string;
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
  return db.prepare(
    "INSERT INTO milestones (id, project_id, name, description, acceptance_criteria, target_date, status, created_at, updated_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
  ).get(
    id,
    input.project_id,
    input.name,
    input.description ?? null,
    input.acceptance_criteria ?? "[]",
    input.target_date ?? null,
    input.status ?? "open",
    ts,
    ts
  ) as Milestone;
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
  params.push(now(), id);

  const row = db.prepare("UPDATE milestones SET " + sets.join(", ") + " WHERE id = ? RETURNING *").get(...params) as Milestone | undefined;
  return row ?? null;
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

export function deleteMilestone(db: Database.Database, id: string): boolean {
  const result = db.prepare("DELETE FROM milestones WHERE id = ?").run(id);
  return result.changes > 0;
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

  return db.prepare(
    `INSERT OR REPLACE INTO milestone_daily_stats (milestone_id, date, completed_tasks, total_tasks, completion_pct)
     VALUES (?, ?, ?, ?, ?) RETURNING *`
  ).get(milestoneId, today, progress.completed_count, progress.task_count, progress.completion_pct) as MilestoneDailyStats;
}

export function getMilestoneDailyStats(db: Database.Database, milestoneId: string): MilestoneDailyStats[] {
  return db
    .prepare("SELECT * FROM milestone_daily_stats WHERE milestone_id = ? ORDER BY date ASC")
    .all(milestoneId) as MilestoneDailyStats[];
}

/** Record a daily stats snapshot for every milestone that has tasks. Called on server startup. */
export function backfillMilestoneDailyStats(db: Database.Database): number {
  const milestoneIds = db.prepare(
    `SELECT DISTINCT m.id FROM milestones m JOIN tasks t ON t.milestone_id = m.id`
  ).all() as { id: string }[];
  for (const { id } of milestoneIds) {
    recordMilestoneDailyStats(db, id);
  }
  return milestoneIds.length;
}

// ─── Time Estimates ─────────────────────────────────────────────────────────

/**
 * Seconds between a task's first logged activity and its completion, or null
 * when there is no span to report.
 *
 * The parse guard fails closed on a timestamp that cannot be read. `new Date()`
 * yields an Invalid Date for a garbage string and NaN survives every step that
 * follows, because `end - start`, `Math.round(NaN)` and `Math.max(0, NaN)` are
 * all NaN. So this returned NaN, a value its own `number | null` signature does
 * not allow. The route hid that: `JSON.stringify(NaN)` is `null`, so
 * `/api/tasks/:id/time-spent` already served a plausible-looking response while
 * any in-process caller doing arithmetic on the result got NaN. The falsy check
 * covered only half the inputs, catching a blank `first.ts` by luck of it being
 * falsy while nothing at all looked at `updated_at`, blank or otherwise.
 *
 * Null rather than a throw or a distinct "unreadable" signal. Null is already
 * this function's answer for "no elapsed time to report" — it says that for a
 * task with no activity and for one that is not done — and a span that cannot
 * be measured belongs in the same bucket, because there is no honest number to
 * put in its place. Throwing would fail a task detail read over one bad row,
 * and a read-only estimate is the wrong place to raise a data-integrity alarm.
 * The accepted trade-off is that an unreadable timestamp is indistinguishable
 * from the ordinary null cases; the value exists to be displayed, not audited.
 *
 * What this does not close: `new Date()` is lenient, so a wrong-but-parseable
 * string still yields a number. `'0'` is a valid date literal reading as
 * 2000-01-01 and `'2026'` reads as that year's 1 January — both finite, neither
 * distinguishable from a date someone meant to store. A stored value that
 * precedes the first activity then hits the `Math.max` clamp and reports a span
 * of zero, which looks like a task finished instantly rather than like an
 * absence. Closing that would take a format check rather than a parse check,
 * and would risk rejecting rows this codebase did not write, so it is left
 * open deliberately. tests/task-timestamp-integrity.test.ts pins the boundary.
 */
export function getTimeSpent(db: Database.Database, taskId: string): number | null {
  const first = db
    .prepare("SELECT MIN(timestamp) AS ts FROM activity_log WHERE task_id = ?")
    .get(taskId) as { ts: string | null } | undefined;
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as { status: string; updated_at: string } | undefined;
  if (!first?.ts || task?.status !== "done") return null;
  const start = new Date(first.ts).getTime();
  const end = new Date(task.updated_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}
