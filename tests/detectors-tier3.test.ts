import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { runDetectors, _resetRegistry } from "../server/detectors/registry.js";
import { registerTier3Detectors } from "../server/detectors/tier3.js";
import { upsertCommit, createProject, createTask, createMilestone, updateMilestone } from "../server/db/index.js";

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

describe("scope-change detector", () => {
  it("emits 90 for name, 80 for target_date, 60 for description", () => {
    const p = createProject(db, { name: "P", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "M", description: "d" });
    updateMilestone(db, m.id, { name: "M2" });
    updateMilestone(db, m.id, { target_date: "2026-06-01" });
    updateMilestone(db, m.id, { description: "d2" });

    const matches = runDetectors(db, { minScore: 0 }).filter((x) => x.detectorId === "scope-change");
    const byScore = matches.map((x) => x.score).sort();
    expect(byScore).toEqual([60, 80, 90]);
  });

  it("excludes changes older than 30 days", () => {
    const p = createProject(db, { name: "P", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "M" });
    db.prepare(
      "INSERT INTO milestone_history (id, milestone_id, field, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("h-old", m.id, "name", "a", "b", new Date(Date.now() - 40 * 86_400_000).toISOString());
    const matches = runDetectors(db, { minScore: 0 }).filter((x) => x.detectorId === "scope-change");
    expect(matches).toHaveLength(0);
  });
});
