import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import {
  createProject,
  createTask,
  registerAgent,
  updateTask,
  logActivity,
  getActivityStream,
} from "../server/db/index.js";
import { createTestDb } from "./setup.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

// ─── 3.3 Timeline — start_date ──────────────────────────────────────────────

describe("3.3 Timeline — start_date", () => {
  it("creates task with start_date", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, {
      project_id: project.id, title: "T", description: null,
      priority: "medium", start_date: "2026-04-01", due_date: "2026-04-15",
    });
    expect(task.start_date).toBe("2026-04-01");
  });

  it("updates start_date", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });
    const updated = updateTask(db, task.id, { start_date: "2026-04-05" });
    expect(updated!.start_date).toBe("2026-04-05");
  });
});

// ─── 3.5 Activity Stream ────────────────────────────────────────────────────

describe("3.5 Activity Stream", () => {
  it("returns activity with no filters", () => {
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });

    logActivity(db, { task_id: task.id, agent_id: agent.id, message: "working" });
    logActivity(db, { task_id: task.id, agent_id: agent.id, message: "done" });

    const stream = getActivityStream(db);
    expect(stream.length).toBeGreaterThanOrEqual(2);
  });

  it("filters by agent_id", () => {
    const a1 = registerAgent(db, { name: "bot-1", model: null, capabilities: [] });
    const a2 = registerAgent(db, { name: "bot-2", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });

    logActivity(db, { task_id: task.id, agent_id: a1.id, message: "a1 work" });
    logActivity(db, { task_id: task.id, agent_id: a2.id, message: "a2 work" });

    const stream = getActivityStream(db, { agent_id: a1.id });
    expect(stream).toHaveLength(1);
    expect(stream[0].message).toBe("a1 work");
  });

  it("filters by project_id", () => {
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const p1 = createProject(db, { name: "P1", description: null });
    const p2 = createProject(db, { name: "P2", description: null });
    const t1 = createTask(db, { project_id: p1.id, title: "T1", description: null, priority: "medium" });
    const t2 = createTask(db, { project_id: p2.id, title: "T2", description: null, priority: "medium" });

    logActivity(db, { task_id: t1.id, agent_id: agent.id, message: "p1 work" });
    logActivity(db, { task_id: t2.id, agent_id: agent.id, message: "p2 work" });

    const stream = getActivityStream(db, { project_id: p1.id });
    expect(stream).toHaveLength(1);
    expect(stream[0].message).toBe("p1 work");
  });

  it("respects limit", () => {
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });

    for (let i = 0; i < 10; i++) {
      logActivity(db, { task_id: task.id, agent_id: agent.id, message: `work ${i}` });
    }

    const stream = getActivityStream(db, { limit: 3 });
    expect(stream).toHaveLength(3);
  });
});
