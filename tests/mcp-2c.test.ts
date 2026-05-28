import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  registerAgent,
  setAgentStatus,
  getAgentByName,
  createProject,
  createMilestone,
  createTask,
  updateTask,
  createBlocker,
  getProjectContext,
} from "../server/db/index.js";

describe("migration 016 — agent status columns", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("adds current_status and current_status_at to agents", () => {
    const cols = (db.pragma("table_info(agents)") as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("current_status");
    expect(cols).toContain("current_status_at");
  });
});

describe("setAgentStatus", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("sets and overwrites the agent's current status", () => {
    registerAgent(db, { name: "coder-1", model: null, capabilities: [] });
    setAgentStatus(db, "coder-1", "running tests");
    let a = getAgentByName(db, "coder-1")!;
    expect(a.current_status).toBe("running tests");
    expect(a.current_status_at).toBeTruthy();
    setAgentStatus(db, "coder-1", "writing migration");
    a = getAgentByName(db, "coder-1")!;
    expect(a.current_status).toBe("writing migration");
  });
});

describe("getProjectContext", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("returns focused orientation for a project", () => {
    const p = createProject(db, { name: "P", description: null });
    const other = createProject(db, { name: "Other", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "M1" });
    const t1 = createTask(db, { project_id: p.id, title: "active", priority: "medium", milestone_id: m.id });
    updateTask(db, t1.id, { status: "in_progress" });
    const t2 = createTask(db, { project_id: p.id, title: "blocked-task", priority: "medium" });
    createBlocker(db, { task_id: t2.id, reason: "stuck" });
    const o1 = createTask(db, { project_id: other.id, title: "other-active", priority: "medium" });
    updateTask(db, o1.id, { status: "in_progress" });

    const ctx = getProjectContext(db, p.id);
    expect(ctx.project?.id).toBe(p.id);
    expect(ctx.open_milestones.map((mm) => mm.id)).toContain(m.id);
    expect(ctx.open_milestones[0]?.progress).toBeDefined();
    expect(ctx.in_progress_tasks.map((t) => t.id)).toEqual([t1.id]);
    expect(ctx.active_blockers.some((b) => b.task_id === t2.id)).toBe(true);
    expect(Array.isArray(ctx.recent_activity)).toBe(true);
  });

  it("returns null project for an unknown id", () => {
    const ctx = getProjectContext(db, "nope");
    expect(ctx.project).toBeNull();
    expect(ctx.in_progress_tasks).toEqual([]);
  });
});
