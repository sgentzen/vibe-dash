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
  it("emits one match per milestone with score = max field score", () => {
    const p = createProject(db, { name: "P", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "M", description: "d" });
    updateMilestone(db, m.id, { name: "M2" });
    updateMilestone(db, m.id, { target_date: "2026-06-01" });
    updateMilestone(db, m.id, { description: "d2" });

    const matches = runDetectors(db, { minScore: 0 }).filter((x) => x.detectorId === "scope-change");
    expect(matches).toHaveLength(1);
    expect(matches[0].entityId).toBe(m.id);   // milestone id, not history id
    expect(matches[0].entityType).toBe("milestone");
    expect(matches[0].score).toBe(90);        // max of (90 name, 80 target_date, 60 description)
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

  it("emits one match per distinct milestone", () => {
    const p = createProject(db, { name: "P", description: null });
    const m1 = createMilestone(db, { project_id: p.id, name: "First" });
    const m2 = createMilestone(db, { project_id: p.id, name: "Second" });
    updateMilestone(db, m1.id, { name: "First-renamed" });
    updateMilestone(db, m2.id, { description: "added desc" });

    const matches = runDetectors(db, { minScore: 0 }).filter((x) => x.detectorId === "scope-change");
    expect(matches).toHaveLength(2);
    const byId = Object.fromEntries(matches.map((x) => [x.entityId, x.score]));
    expect(byId[m1.id]).toBe(90);  // name change
    expect(byId[m2.id]).toBe(60);  // description change
  });
});

describe("activity-burst detector", () => {
  it("emits when current-window count exceeds baseline × 3 and is ≥ 5", () => {
    const p = createProject(db, { name: "Bursty", description: null });
    const t = db.prepare(
      "INSERT INTO tasks (id, project_id, title, status, priority, progress, created_at, updated_at) VALUES (?, ?, ?, 'planned', 'medium', 0, ?, ?) RETURNING *"
    ).get("task-1", p.id, "T", new Date().toISOString(), new Date().toISOString()) as { id: string };

    // 6 recent activity rows in the last 60 minutes (current window)
    for (let i = 0; i < 6; i++) {
      const ts = new Date(Date.now() - i * 60_000).toISOString();
      db.prepare(
        "INSERT INTO activity_log (id, task_id, agent_id, message, timestamp, source) VALUES (?, ?, NULL, ?, ?, 'test')"
      ).run(`a-${i}`, t.id, `msg ${i}`, ts);
    }
    // baseline: 7 historical rows spread one per day across 7 days
    for (let d = 1; d <= 7; d++) {
      db.prepare(
        "INSERT INTO activity_log (id, task_id, agent_id, message, timestamp, source) VALUES (?, ?, NULL, ?, ?, 'test')"
      ).run(`b-${d}`, t.id, `baseline ${d}`, new Date(Date.now() - d * 86_400_000).toISOString());
    }

    const matches = runDetectors(db, { minScore: 0 }).filter((m) => m.detectorId === "activity-burst");
    expect(matches).toHaveLength(1);
    expect(matches[0].entityType).toBe("area");
    expect(matches[0].entityId).toBe(p.id);
  });

  it("suppresses bursts with current count < 5", () => {
    const p = createProject(db, { name: "Quiet", description: null });
    const t = db.prepare(
      "INSERT INTO tasks (id, project_id, title, status, priority, progress, created_at, updated_at) VALUES (?, ?, ?, 'planned', 'medium', 0, ?, ?) RETURNING *"
    ).get("task-2", p.id, "T", new Date().toISOString(), new Date().toISOString()) as { id: string };
    for (let i = 0; i < 4; i++) {
      db.prepare(
        "INSERT INTO activity_log (id, task_id, agent_id, message, timestamp, source) VALUES (?, ?, NULL, ?, ?, 'test')"
      ).run(`q-${i}`, t.id, "m", new Date(Date.now() - i * 60_000).toISOString());
    }
    const matches = runDetectors(db, { minScore: 0 }).filter((m) => m.detectorId === "activity-burst");
    expect(matches).toHaveLength(0);
  });
});
