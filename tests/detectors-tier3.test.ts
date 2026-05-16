import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { runDetectors, _resetRegistry } from "../server/detectors/registry.js";
import { registerTier3Detectors } from "../server/detectors/tier3.js";
import { upsertCommit, createProject, createTask } from "../server/db/index.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  _resetRegistry();
  registerTier3Detectors();
});

afterEach(() => { _resetRegistry(); });

describe("unlinked-commit detector", () => {
  it("emits one match per unlinked commit in the last 7 days", () => {
    upsertCommit(db, { sha: "recent", subject: "drive-by fix", author_email: "a@b", authored_at: new Date().toISOString() });
    upsertCommit(db, { sha: "old", subject: "old fix", author_email: "a@b", authored_at: new Date(Date.now() - 30 * 86_400_000).toISOString() });
    const matches = runDetectors(db, { minScore: 0 }).filter((m) => m.detectorId === "unlinked-commit");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ entityId: "recent", entityType: "commit", score: 60, category: "change" });
  });

  it("ignores linked commits", () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    upsertCommit(db, { sha: "linked", subject: "feat: with id", author_email: null, authored_at: new Date().toISOString() });
    db.prepare("UPDATE commits SET linked_task_id = ? WHERE sha = ?").run(t.id, "linked");
    const matches = runDetectors(db, { minScore: 0 }).filter((m) => m.detectorId === "unlinked-commit");
    expect(matches).toHaveLength(0);
  });
});
