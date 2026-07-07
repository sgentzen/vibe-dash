import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  createProject,
  createTask,
  listTasks,
  updateTask,
  registerAgent,
  getAgentHealthStatus,
} from "../server/db/index.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

// ─── 1.1 Agent Assignment ────────────────────────────────────────────────────

describe("agent assignment", () => {
  it("creates a task with assigned_agent_id", () => {
    const project = createProject(db, { name: "P1", description: null });
    const agent = registerAgent(db, { name: "bot-1", model: "gpt-4", capabilities: [] });
    const task = createTask(db, {
      project_id: project.id,
      title: "Assigned task",
      description: null,
      priority: "medium",
      assigned_agent_id: agent.id,
    });
    expect(task.assigned_agent_id).toBe(agent.id);
  });

  it("defaults assigned_agent_id to null", () => {
    const project = createProject(db, { name: "P1", description: null });
    const task = createTask(db, {
      project_id: project.id,
      title: "Unassigned",
      description: null,
      priority: "medium",
    });
    expect(task.assigned_agent_id).toBeNull();
  });

  it("assigns and unassigns an agent via updateTask", () => {
    const project = createProject(db, { name: "P1", description: null });
    const agent = registerAgent(db, { name: "bot-1", model: null, capabilities: [] });
    const task = createTask(db, {
      project_id: project.id,
      title: "Task",
      description: null,
      priority: "medium",
    });

    const assigned = updateTask(db, task.id, { assigned_agent_id: agent.id });
    expect(assigned?.assigned_agent_id).toBe(agent.id);

    const unassigned = updateTask(db, task.id, { assigned_agent_id: null });
    expect(unassigned?.assigned_agent_id).toBeNull();
  });

  it("filters tasks by assigned_agent_id", () => {
    const project = createProject(db, { name: "P1", description: null });
    const agent = registerAgent(db, { name: "bot-1", model: null, capabilities: [] });
    createTask(db, { project_id: project.id, title: "A", description: null, priority: "medium", assigned_agent_id: agent.id });
    createTask(db, { project_id: project.id, title: "B", description: null, priority: "medium" });

    const filtered = listTasks(db, { assigned_agent_id: agent.id });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe("A");
  });
});

// ─── 1.2a Agent Health Indicators ────────────────────────────────────────────

describe("agent health status", () => {
  it("returns active for recent last_seen_at", () => {
    const recentTime = new Date().toISOString();
    expect(getAgentHealthStatus(recentTime)).toBe("active");
  });

  it("returns idle for 10-minute-old last_seen_at", () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(getAgentHealthStatus(tenMinAgo)).toBe("idle");
  });

  it("returns offline for 60-minute-old last_seen_at", () => {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(getAgentHealthStatus(hourAgo)).toBe("offline");
  });
});

// ─── 2.1 Due Dates ──────────────────────────────────────────────────────────

describe("due dates", () => {
  it("creates a task with due_date", () => {
    const project = createProject(db, { name: "P1", description: null });
    const task = createTask(db, {
      project_id: project.id,
      title: "Deadline task",
      description: null,
      priority: "high",
      due_date: "2026-04-01",
    });
    expect(task.due_date).toBe("2026-04-01");
  });

  it("defaults due_date to null", () => {
    const project = createProject(db, { name: "P1", description: null });
    const task = createTask(db, {
      project_id: project.id,
      title: "No deadline",
      description: null,
      priority: "medium",
    });
    expect(task.due_date).toBeNull();
  });

  it("updates due_date via updateTask", () => {
    const project = createProject(db, { name: "P1", description: null });
    const task = createTask(db, {
      project_id: project.id,
      title: "Task",
      description: null,
      priority: "medium",
    });

    const updated = updateTask(db, task.id, { due_date: "2026-05-15" });
    expect(updated?.due_date).toBe("2026-05-15");

    const cleared = updateTask(db, task.id, { due_date: null });
    expect(cleared?.due_date).toBeNull();
  });
});
