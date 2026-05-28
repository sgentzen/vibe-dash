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
  listAgents,
  getAgentCompletedToday,
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
    const agents = listAgents(db);
    expect(agents.find((a) => a.id === agent.id)).toBeDefined();
  });
});
