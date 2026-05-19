import type Database from "better-sqlite3";
import { genId, now } from "./helpers.js";

export interface MilestoneHistoryRow {
  id: string;
  milestone_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

export type WatchedMilestoneField =
  | "name"
  | "description"
  | "target_date"
  | "acceptance_criteria";

export function recordMilestoneChange(
  db: Database.Database,
  milestoneId: string,
  field: WatchedMilestoneField,
  oldValue: string | null,
  newValue: string | null
): void {
  db.prepare(
    `INSERT INTO milestone_history (id, milestone_id, field, old_value, new_value, changed_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(genId(), milestoneId, field, oldValue, newValue, now());
}

export function listMilestoneHistorySince(
  db: Database.Database,
  isoSince: string
): MilestoneHistoryRow[] {
  return db.prepare(
    `SELECT id, milestone_id, field, old_value, new_value, changed_at
     FROM milestone_history
     WHERE changed_at >= ?
     ORDER BY changed_at DESC`
  ).all(isoSince) as MilestoneHistoryRow[];
}
