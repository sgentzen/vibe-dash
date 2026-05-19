import type Database from "better-sqlite3";
import { upsertCommit, linkCommitToTask } from "../db/commits.js";
import type { GitLogFn } from "./gitLog.js";

export interface RunCommitIngestionOptions {
  gitLog: GitLogFn;
  repoPath: string;
  lookbackDays: number;
}

export interface CommitIngestionResult {
  inserted: number;
  linked: number;
}

export async function runCommitIngestionOnce(
  db: Database.Database,
  opts: RunCommitIngestionOptions
): Promise<CommitIngestionResult> {
  const sinceMs = Date.now() - opts.lookbackDays * 86_400_000;
  const sinceIso = new Date(sinceMs).toISOString();
  const commits = await opts.gitLog(sinceIso, opts.repoPath);

  // Snapshot known shas to compute `inserted` after the loop (INSERT OR IGNORE doesn't tell us).
  const knownBefore = new Set<string>(
    (db.prepare("SELECT sha FROM commits").all() as { sha: string }[]).map((r) => r.sha)
  );

  // Snapshot known task ids for subject matching.
  const taskIds = (db.prepare("SELECT id FROM tasks").all() as { id: string }[]).map((r) => r.id);

  let linked = 0;
  for (const c of commits) {
    upsertCommit(db, c);
    if (knownBefore.has(c.sha)) continue;
    const match = taskIds.find((id) => c.subject.includes(id));
    if (match) {
      linkCommitToTask(db, c.sha, match);
      linked++;
    }
  }

  const knownAfter = (db.prepare("SELECT COUNT(*) AS n FROM commits").get() as { n: number }).n;
  const inserted = knownAfter - knownBefore.size;
  return { inserted, linked };
}
