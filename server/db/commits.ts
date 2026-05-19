import type Database from "better-sqlite3";
import { now } from "./helpers.js";

export interface CommitRow {
  sha: string;
  subject: string;
  author_email: string | null;
  authored_at: string;
  ingested_at: string;
  linked_task_id: string | null;
}

export interface UpsertCommitInput {
  sha: string;
  subject: string;
  author_email: string | null;
  authored_at: string;
}

export function upsertCommit(
  db: Database.Database,
  input: UpsertCommitInput
): void {
  db.prepare(
    `INSERT OR IGNORE INTO commits (sha, subject, author_email, authored_at, ingested_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(input.sha, input.subject, input.author_email, input.authored_at, now());
}

export function linkCommitToTask(
  db: Database.Database,
  sha: string,
  taskId: string
): void {
  db.prepare(
    "UPDATE commits SET linked_task_id = ? WHERE sha = ?"
  ).run(taskId, sha);
}

export function listUnlinkedCommitsSince(
  db: Database.Database,
  since: string
): CommitRow[] {
  return db.prepare(
    `SELECT * FROM commits
     WHERE linked_task_id IS NULL AND authored_at >= ?
     ORDER BY authored_at DESC`
  ).all(since) as CommitRow[];
}

export function latestIngestedAt(db: Database.Database): string | null {
  const row = db.prepare(
    "SELECT MAX(ingested_at) AS latest FROM commits"
  ).get() as { latest: string | null };
  return row.latest;
}
