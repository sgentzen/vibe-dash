import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  registerAgent,
  createProject,
  createTask,
  updateTask,
  completeTask,
  logActivity,
  getAgentCompletedToday,
  getSpendToday,
  getTasksCompletedToday,
  logCost,
} from "../server/db/index.js";

describe("live roster data — per-agent completed_today", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = createTestDb();
  });

  it("counts tasks an agent completed today", () => {
    const agent = registerAgent(db, { name: "coder-1", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, {
      project_id: project.id,
      title: "t",
      priority: "medium",
      assigned_agent_id: agent.id,
    });
    updateTask(db, task.id, { status: "in_progress" });
    completeTask(db, task.id);
    // getAgentCompletedToday JOINs activity_log on agent_id; we must log activity
    // to attribute this completion to the agent.
    logActivity(db, { task_id: task.id, agent_id: agent.id, message: "task done" });
    expect(getAgentCompletedToday(db, agent.id)).toBe(1);
  });
});

describe("live roster data — today summary figures", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("getSpendToday sums only today's cost entries", () => {
    const p = createProject(db, { name: "P", description: null });
    logCost(db, { agent_id: null, task_id: null, milestone_id: null, project_id: p.id, model: "m", provider: "x", input_tokens: 10, output_tokens: 5, cost_usd: 1.25 });
    logCost(db, { agent_id: null, task_id: null, milestone_id: null, project_id: p.id, model: "m", provider: "x", input_tokens: 10, output_tokens: 5, cost_usd: 0.75 });
    expect(getSpendToday(db)).toBeCloseTo(2, 5);
  });

  it("getTasksCompletedToday counts only today's done tasks", () => {
    const p = createProject(db, { name: "P", description: null });
    const t1 = createTask(db, { project_id: p.id, title: "a", priority: "medium" });
    const t2 = createTask(db, { project_id: p.id, title: "b", priority: "medium" });
    completeTask(db, t1.id);
    expect(getTasksCompletedToday(db)).toBe(1);
    completeTask(db, t2.id);
    expect(getTasksCompletedToday(db)).toBe(2);
  });
});
