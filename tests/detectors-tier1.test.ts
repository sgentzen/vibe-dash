import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  createProject,
  createTask,
  registerAgent,
  createBlocker,
  resolveBlocker,
  createReview,
  updateReview,
} from "../server/db/index.js";
import { runDetectors, _resetRegistry } from "../server/detectors/registry.js";
import { registerTier1Detectors } from "../server/detectors/tier1.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  _resetRegistry();
  registerTier1Detectors();
});

afterEach(() => {
  _resetRegistry();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

// Tests control timestamps by back-dating the DB rows (reported_at / last_seen_at /
// updated_at) rather than overriding the runner clock.  runDetectors uses
// new Date().toISOString() as its "now", so rows dated N hours ago appear as N hours old.
function runWith() {
  return runDetectors(db, { minScore: 0 });
}

// ─── blocker-aging ────────────────────────────────────────────────────────────

describe("blocker-aging detector", () => {
  it("ignores blockers younger than 24 h", () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    createBlocker(db, { task_id: t.id, reason: "Fresh blocker" });

    const matches = runWith().filter((m) => m.detectorId === "blocker-aging");
    expect(matches).toHaveLength(0);
  });

  it("flags open blockers older than 24 h", () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "Stalled task", description: null, priority: "high" });

    // Insert a stale blocker directly to control the reported_at timestamp.
    db.prepare(
      "INSERT INTO blockers (id, task_id, reason, reported_at, resolved_at) VALUES (?, ?, ?, ?, NULL)"
    ).run("b-stale-1", t.id, "Waiting on infra", hoursAgo(30));

    const matches = runWith().filter((m) => m.detectorId === "blocker-aging");
    expect(matches).toHaveLength(1);
    expect(matches[0].entityId).toBe("b-stale-1");
    expect(matches[0].entityType).toBe("blocker");
    expect(matches[0].label).toContain("Stalled task");
    expect(matches[0].detail).toBe("Waiting on infra");
  });

  it("does not flag resolved blockers", () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    const blocker = createBlocker(db, { task_id: t.id, reason: "Old" });

    // Backdate the blocker then resolve it.
    db.prepare("UPDATE blockers SET reported_at = ? WHERE id = ?").run(hoursAgo(48), blocker.id);
    resolveBlocker(db, blocker.id);

    const matches = runWith().filter((m) => m.detectorId === "blocker-aging");
    expect(matches).toHaveLength(0);
  });

  it("scores 50 for 24-47 h old blockers", () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    db.prepare(
      "INSERT INTO blockers (id, task_id, reason, reported_at, resolved_at) VALUES (?, ?, ?, ?, NULL)"
    ).run("b-day1", t.id, "Day one", hoursAgo(30));

    const match = runWith().find((m) => m.entityId === "b-day1");
    expect(match?.score).toBe(50);
  });

  it("scores 75 for 48-71 h old blockers", () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    db.prepare(
      "INSERT INTO blockers (id, task_id, reason, reported_at, resolved_at) VALUES (?, ?, ?, ?, NULL)"
    ).run("b-day2", t.id, "Day two", hoursAgo(50));

    const match = runWith().find((m) => m.entityId === "b-day2");
    expect(match?.score).toBe(75);
  });

  it("scores 95 for 72 h+ old blockers", () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    db.prepare(
      "INSERT INTO blockers (id, task_id, reason, reported_at, resolved_at) VALUES (?, ?, ?, ?, NULL)"
    ).run("b-old", t.id, "Ancient", hoursAgo(80));

    const match = runWith().find((m) => m.entityId === "b-old");
    expect(match?.score).toBe(95);
  });
});

// ─── agent-silence ────────────────────────────────────────────────────────────

describe("agent-silence detector", () => {
  it("ignores agents without in_progress tasks", () => {
    const agent = registerAgent(db, { name: "bot-idle", model: null, capabilities: [] });
    db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(hoursAgo(5), agent.id);

    const matches = runWith().filter((m) => m.detectorId === "agent-silence");
    expect(matches).toHaveLength(0);
  });

  it("ignores recently active agents even if they have an in_progress task", () => {
    const agent = registerAgent(db, { name: "bot-active", model: null, capabilities: [] });
    const p = createProject(db, { name: "P", description: null });
    createTask(db, {
      project_id: p.id, title: "In flight", description: null,
      priority: "medium", assigned_agent_id: agent.id, status: "in_progress",
    } as Parameters<typeof createTask>[1]);

    const matches = runWith().filter((m) => m.detectorId === "agent-silence");
    expect(matches).toHaveLength(0);
  });

  it("flags silent agent with in_progress task", () => {
    const agent = registerAgent(db, { name: "bot-silent", model: null, capabilities: [] });
    db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(hoursAgo(3), agent.id);
    const p = createProject(db, { name: "P", description: null });
    db.prepare(
      "INSERT INTO tasks (id, project_id, title, status, priority, progress, created_at, updated_at, assigned_agent_id) VALUES (?, ?, ?, 'in_progress', 'medium', 0, ?, ?, ?)"
    ).run("t-silent", p.id, "Blocked task", hoursAgo(5), hoursAgo(5), agent.id);

    const matches = runWith().filter((m) => m.detectorId === "agent-silence");
    expect(matches).toHaveLength(1);
    expect(matches[0].entityId).toBe(agent.id);
    expect(matches[0].entityType).toBe("agent");
    expect(matches[0].label).toContain("bot-silent");
  });

  it("scores 60 for 2-3 h silence", () => {
    const agent = registerAgent(db, { name: "bot-2h", model: null, capabilities: [] });
    db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(hoursAgo(2.5), agent.id);
    const p = createProject(db, { name: "P", description: null });
    db.prepare(
      "INSERT INTO tasks (id, project_id, title, status, priority, progress, created_at, updated_at, assigned_agent_id) VALUES (?, ?, ?, 'in_progress', 'medium', 0, ?, ?, ?)"
    ).run("t-2h", p.id, "Task 2h", hoursAgo(5), hoursAgo(5), agent.id);

    const match = runWith().find((m) => m.entityId === agent.id);
    expect(match?.score).toBe(60);
  });

  it("scores 80 for 4-7 h silence", () => {
    const agent = registerAgent(db, { name: "bot-4h", model: null, capabilities: [] });
    db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(hoursAgo(5), agent.id);
    const p = createProject(db, { name: "P", description: null });
    db.prepare(
      "INSERT INTO tasks (id, project_id, title, status, priority, progress, created_at, updated_at, assigned_agent_id) VALUES (?, ?, ?, 'in_progress', 'medium', 0, ?, ?, ?)"
    ).run("t-4h", p.id, "Task 4h", hoursAgo(6), hoursAgo(6), agent.id);

    const match = runWith().find((m) => m.entityId === agent.id);
    expect(match?.score).toBe(80);
  });

  it("scores 95 for 8 h+ silence", () => {
    const agent = registerAgent(db, { name: "bot-8h", model: null, capabilities: [] });
    db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(hoursAgo(9), agent.id);
    const p = createProject(db, { name: "P", description: null });
    db.prepare(
      "INSERT INTO tasks (id, project_id, title, status, priority, progress, created_at, updated_at, assigned_agent_id) VALUES (?, ?, ?, 'in_progress', 'medium', 0, ?, ?, ?)"
    ).run("t-8h", p.id, "Task 8h", hoursAgo(10), hoursAgo(10), agent.id);

    const match = runWith().find((m) => m.entityId === agent.id);
    expect(match?.score).toBe(95);
  });
});

// ─── failing-review ───────────────────────────────────────────────────────────

describe("failing-review detector", () => {
  it("ignores pending reviews", () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    createReview(db, { task_id: t.id, reviewer_name: "Reviewer" });

    const matches = runWith().filter((m) => m.detectorId === "failing-review");
    expect(matches).toHaveLength(0);
  });

  it("ignores failed reviews younger than 24 h", () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    const r = createReview(db, { task_id: t.id, reviewer_name: "Reviewer", status: "failed" });
    // Review was just created — updated_at is now, well within 24 h.
    expect(r.status).toBe("failed");

    const matches = runWith().filter((m) => m.detectorId === "failing-review");
    expect(matches).toHaveLength(0);
  });

  it("flags failed reviews older than 24 h", () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "Review me", description: null, priority: "medium" });
    const r = createReview(db, { task_id: t.id, reviewer_name: "bot-reviewer", status: "failed" });
    db.prepare("UPDATE task_reviews SET updated_at = ? WHERE id = ?").run(hoursAgo(30), r.id);

    const matches = runWith().filter((m) => m.detectorId === "failing-review");
    expect(matches).toHaveLength(1);
    expect(matches[0].entityId).toBe(r.id);
    expect(matches[0].entityType).toBe("review");
    expect(matches[0].label).toContain("Review me");
    expect(matches[0].detail).toContain("bot-reviewer");
  });

  it("does not flag approved reviews", () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    const r = createReview(db, { task_id: t.id, reviewer_name: "R" });
    updateReview(db, r.id, { status: "approved" });
    db.prepare("UPDATE task_reviews SET updated_at = ? WHERE id = ?").run(hoursAgo(48), r.id);

    const matches = runWith().filter((m) => m.detectorId === "failing-review");
    expect(matches).toHaveLength(0);
  });

  it("scores 55 for 24-47 h old failed reviews", () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    const r = createReview(db, { task_id: t.id, reviewer_name: "R", status: "failed" });
    db.prepare("UPDATE task_reviews SET updated_at = ? WHERE id = ?").run(hoursAgo(30), r.id);

    const match = runWith().find((m) => m.entityId === r.id);
    expect(match?.score).toBe(55);
  });

  it("scores 90 for 72 h+ old failed reviews", () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    const r = createReview(db, { task_id: t.id, reviewer_name: "R", status: "failed" });
    db.prepare("UPDATE task_reviews SET updated_at = ? WHERE id = ?").run(hoursAgo(80), r.id);

    const match = runWith().find((m) => m.entityId === r.id);
    expect(match?.score).toBe(90);
  });
});

// ─── Integration — multiple detectors together ────────────────────────────────

describe("all Tier 1 detectors together", () => {
  it("results are sorted by score descending", () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });

    // 30 h old blocker → score 50
    db.prepare(
      "INSERT INTO blockers (id, task_id, reason, reported_at, resolved_at) VALUES (?, ?, ?, ?, NULL)"
    ).run("b-30h", t.id, "Reason", hoursAgo(30));

    // 80 h old failed review → score 90
    const r = createReview(db, { task_id: t.id, reviewer_name: "R", status: "failed" });
    db.prepare("UPDATE task_reviews SET updated_at = ? WHERE id = ?").run(hoursAgo(80), r.id);

    const results = runWith();
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});
