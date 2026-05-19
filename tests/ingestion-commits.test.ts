import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { runCommitIngestionOnce } from "../server/ingestion/commits.js";
import { createProject, createTask } from "../server/db/index.js";
import type { GitLogFn, RawCommit } from "../server/ingestion/gitLog.js";

let db: Database.Database;

beforeEach(() => { db = createTestDb(); });

function stubLog(commits: RawCommit[]): GitLogFn {
  return async () => commits;
}

describe("runCommitIngestionOnce", () => {
  it("upserts commits and is idempotent on re-run", async () => {
    const gitLog = stubLog([
      { sha: "aaa", subject: "feat: thing", author_email: "a@b", authored_at: "2026-05-15T10:00:00Z" },
      { sha: "bbb", subject: "fix: other", author_email: "a@b", authored_at: "2026-05-15T11:00:00Z" },
    ]);
    const r1 = await runCommitIngestionOnce(db, { gitLog, repoPath: "/tmp", lookbackDays: 7 });
    expect(r1.inserted).toBe(2);
    const r2 = await runCommitIngestionOnce(db, { gitLog, repoPath: "/tmp", lookbackDays: 7 });
    expect(r2.inserted).toBe(0);
  });

  it("links commits whose subject contains a known task id", async () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    const gitLog = stubLog([
      { sha: "ccc", subject: `feat: closes ${t.id}`, author_email: null, authored_at: "2026-05-15T10:00:00Z" },
      { sha: "ddd", subject: "feat: unrelated", author_email: null, authored_at: "2026-05-15T11:00:00Z" },
    ]);
    await runCommitIngestionOnce(db, { gitLog, repoPath: "/tmp", lookbackDays: 7 });

    const linked = db.prepare("SELECT linked_task_id FROM commits WHERE sha = ?").get("ccc") as { linked_task_id: string };
    expect(linked.linked_task_id).toBe(t.id);
    const unlinked = db.prepare("SELECT linked_task_id FROM commits WHERE sha = ?").get("ddd") as { linked_task_id: string | null };
    expect(unlinked.linked_task_id).toBeNull();
  });
});
