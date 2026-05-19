import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { upsertCommit, listUnlinkedCommitsSince, linkCommitToTask } from "../server/db/commits.js";
import { createProject, createTask } from "../server/db/index.js";

let db: Database.Database;

beforeEach(() => { db = createTestDb(); });

describe("commits db helpers", () => {
  it("upsertCommit is idempotent on sha", () => {
    upsertCommit(db, { sha: "abc123", subject: "first", author_email: "a@b", authored_at: "2026-05-01T00:00:00Z" });
    upsertCommit(db, { sha: "abc123", subject: "first-changed", author_email: "a@b", authored_at: "2026-05-01T00:00:00Z" });
    const row = db.prepare("SELECT subject FROM commits WHERE sha = ?").get("abc123") as { subject: string };
    expect(row.subject).toBe("first");
  });

  it("listUnlinkedCommitsSince returns only unlinked commits in range", () => {
    upsertCommit(db, { sha: "old", subject: "old", author_email: null, authored_at: "2026-04-01T00:00:00Z" });
    upsertCommit(db, { sha: "new1", subject: "new1", author_email: null, authored_at: "2026-05-15T00:00:00Z" });
    upsertCommit(db, { sha: "new2", subject: "new2", author_email: null, authored_at: "2026-05-15T00:00:00Z" });

    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    linkCommitToTask(db, "new2", t.id);

    const rows = listUnlinkedCommitsSince(db, "2026-05-01T00:00:00Z");
    expect(rows.map((r) => r.sha)).toEqual(["new1"]);
  });
});
