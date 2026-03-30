import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  createProject,
  createTask,
  getTask,
  listTasks,
  updateTask,
  registerAgent,
  getAgentHealthStatus,
  createTag,
  listTags,
  addTagToTask,
  removeTagFromTask,
  getTaskTags,
  getTag,
} from "../server/db.js";

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

// ─── 2.3 Tags ───────────────────────────────────────────────────────────────

describe("tags", () => {
  it("creates and lists tags for a project", () => {
    const project = createProject(db, { name: "P1", description: null });
    const tag1 = createTag(db, { project_id: project.id, name: "bug", color: "#ef4444" });
    const tag2 = createTag(db, { project_id: project.id, name: "feature", color: "#3b82f6" });

    expect(tag1.name).toBe("bug");
    expect(tag1.color).toBe("#ef4444");
    expect(tag1.project_id).toBe(project.id);

    const tags = listTags(db, project.id);
    expect(tags).toHaveLength(2);
    expect(tags.map((t) => t.name)).toContain("bug");
    expect(tags.map((t) => t.name)).toContain("feature");
  });

  it("uses default color when none provided", () => {
    const project = createProject(db, { name: "P1", description: null });
    const tag = createTag(db, { project_id: project.id, name: "default-tag" });
    expect(tag.color).toBe("#6366f1");
  });

  it("gets a tag by ID", () => {
    const project = createProject(db, { name: "P1", description: null });
    const tag = createTag(db, { project_id: project.id, name: "test" });
    const fetched = getTag(db, tag.id);
    expect(fetched?.name).toBe("test");
  });

  it("adds and removes tags from tasks", () => {
    const project = createProject(db, { name: "P1", description: null });
    const task = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium" });
    const tag1 = createTag(db, { project_id: project.id, name: "bug" });
    const tag2 = createTag(db, { project_id: project.id, name: "feature" });

    addTagToTask(db, task.id, tag1.id);
    addTagToTask(db, task.id, tag2.id);

    const taskTags = getTaskTags(db, task.id);
    expect(taskTags).toHaveLength(2);
    expect(taskTags.map((t) => t.name)).toContain("bug");
    expect(taskTags.map((t) => t.name)).toContain("feature");

    const removed = removeTagFromTask(db, task.id, tag1.id);
    expect(removed).toBe(true);

    const afterRemove = getTaskTags(db, task.id);
    expect(afterRemove).toHaveLength(1);
    expect(afterRemove[0].name).toBe("feature");
  });

  it("handles duplicate tag addition gracefully", () => {
    const project = createProject(db, { name: "P1", description: null });
    const task = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium" });
    const tag = createTag(db, { project_id: project.id, name: "bug" });

    addTagToTask(db, task.id, tag.id);
    addTagToTask(db, task.id, tag.id); // duplicate

    const taskTags = getTaskTags(db, task.id);
    expect(taskTags).toHaveLength(1);
  });

  it("returns false when removing non-existent tag from task", () => {
    const project = createProject(db, { name: "P1", description: null });
    const task = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium" });
    const removed = removeTagFromTask(db, task.id, "nonexistent-id");
    expect(removed).toBe(false);
  });

  it("isolates tags by project", () => {
    const p1 = createProject(db, { name: "P1", description: null });
    const p2 = createProject(db, { name: "P2", description: null });
    createTag(db, { project_id: p1.id, name: "bug" });
    createTag(db, { project_id: p2.id, name: "feature" });

    expect(listTags(db, p1.id)).toHaveLength(1);
    expect(listTags(db, p2.id)).toHaveLength(1);
    expect(listTags(db, p1.id)[0].name).toBe("bug");
    expect(listTags(db, p2.id)[0].name).toBe("feature");
  });
});
