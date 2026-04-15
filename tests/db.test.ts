import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  createProject,
  updateProject,
  listProjects,
  createTask,
  getTask,
  listTasks,
  updateTask,
  completeTask,
  registerAgent,
  getAgentByName,
  logActivity,
  getRecentActivity,
  createBlocker,
  resolveBlocker,
  getActiveBlockers,
} from "../server/db/index.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

// ─── Projects ────────────────────────────────────────────────────────────────

describe("projects", () => {
  it("creates and lists projects", () => {
    const p1 = createProject(db, { name: "Alpha", description: "First project" });
    const p2 = createProject(db, { name: "Beta", description: null });

    expect(p1.id).toBeTruthy();
    expect(p1.name).toBe("Alpha");
    expect(p1.description).toBe("First project");
    expect(p1.created_at).toBeTruthy();
    expect(p1.updated_at).toBeTruthy();

    const projects = listProjects(db);
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.name)).toContain("Alpha");
    expect(projects.map((p) => p.name)).toContain("Beta");

    expect(p2.description).toBeNull();
  });

  it("returns empty array when no projects exist", () => {
    expect(listProjects(db)).toHaveLength(0);
  });

  it("updates a project name", () => {
    const p = createProject(db, { name: "Old", description: "desc" });
    const updated = updateProject(db, p.id, { name: "New" });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("New");
    expect(updated!.description).toBe("desc");
    expect(updated!.updated_at).not.toBe(p.updated_at);
  });

  it("updates a project description", () => {
    const p = createProject(db, { name: "P", description: "old desc" });
    const updated = updateProject(db, p.id, { description: "new desc" });

    expect(updated!.name).toBe("P");
    expect(updated!.description).toBe("new desc");
  });

  it("clears description by setting it to null", () => {
    const p = createProject(db, { name: "P", description: "has desc" });
    const updated = updateProject(db, p.id, { description: null });

    expect(updated!.description).toBeNull();
  });

  it("returns null for non-existent project", () => {
    const result = updateProject(db, "non-existent-id", { name: "X" });
    expect(result).toBeNull();
  });
});

// ─── Tasks ────────────────────────────────────────────────────────────────────

describe("tasks", () => {
  let projectId: string;

  beforeEach(() => {
    projectId = createProject(db, { name: "Test Project", description: null }).id;
  });

  it("creates a task and retrieves it by id", () => {
    const task = createTask(db, {
      project_id: projectId,
      title: "Do something",
      description: "Details here",
      priority: "high",
    });

    expect(task.id).toBeTruthy();
    expect(task.project_id).toBe(projectId);
    expect(task.title).toBe("Do something");
    expect(task.description).toBe("Details here");
    expect(task.status).toBe("planned");
    expect(task.priority).toBe("high");
    expect(task.progress).toBe(0);
    expect(task.parent_task_id).toBeNull();

    const fetched = getTask(db, task.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(task.id);
  });

  it("returns null for unknown task id", () => {
    expect(getTask(db, "non-existent")).toBeNull();
  });

  it("creates sub-tasks with a parent_task_id", () => {
    const parent = createTask(db, {
      project_id: projectId,
      title: "Parent",
      description: null,
      priority: "medium",
    });

    const child = createTask(db, {
      project_id: projectId,
      parent_task_id: parent.id,
      title: "Child",
      description: null,
      priority: "low",
    });

    expect(child.parent_task_id).toBe(parent.id);

    const subTasks = listTasks(db, { parent_task_id: parent.id });
    expect(subTasks).toHaveLength(1);
    expect(subTasks[0].id).toBe(child.id);
  });

  it("updates task fields", () => {
    const task = createTask(db, {
      project_id: projectId,
      title: "Original",
      description: null,
      priority: "low",
    });

    const updated = updateTask(db, task.id, {
      title: "Updated",
      status: "in_progress",
      progress: 50,
    });

    expect(updated).not.toBeNull();
    expect(updated!.title).toBe("Updated");
    expect(updated!.status).toBe("in_progress");
    expect(updated!.progress).toBe(50);
    // unchanged fields
    expect(updated!.priority).toBe("low");
  });

  it("completes a task", () => {
    const task = createTask(db, {
      project_id: projectId,
      title: "Completable",
      description: null,
      priority: "medium",
    });

    const done = completeTask(db, task.id);
    expect(done).not.toBeNull();
    expect(done!.status).toBe("done");
    expect(done!.progress).toBe(100);
  });

  it("filters tasks by project_id", () => {
    const project2 = createProject(db, { name: "Other", description: null });

    createTask(db, { project_id: projectId, title: "Task 1", description: null, priority: "low" });
    createTask(db, { project_id: project2.id, title: "Task 2", description: null, priority: "low" });

    const tasks = listTasks(db, { project_id: projectId });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Task 1");
  });

  it("filters tasks by status", () => {
    const t1 = createTask(db, { project_id: projectId, title: "T1", description: null, priority: "low" });
    createTask(db, { project_id: projectId, title: "T2", description: null, priority: "low" });

    updateTask(db, t1.id, { status: "in_progress" });

    const inProgress = listTasks(db, { status: "in_progress" });
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0].id).toBe(t1.id);
  });

  it("lists all tasks when no filters provided", () => {
    createTask(db, { project_id: projectId, title: "A", description: null, priority: "low" });
    createTask(db, { project_id: projectId, title: "B", description: null, priority: "low" });
    createTask(db, { project_id: projectId, title: "C", description: null, priority: "low" });

    expect(listTasks(db)).toHaveLength(3);
  });
});

// ─── Agents ───────────────────────────────────────────────────────────────────

describe("agents", () => {
  it("registers a new agent", () => {
    const agent = registerAgent(db, {
      name: "agent-1",
      model: "claude-3-5-sonnet",
      capabilities: ["read", "write"],
    });

    expect(agent.id).toBeTruthy();
    expect(agent.name).toBe("agent-1");
    expect(agent.model).toBe("claude-3-5-sonnet");
    expect(agent.capabilities).toEqual(["read", "write"]);
    expect(agent.registered_at).toBeTruthy();
    expect(agent.last_seen_at).toBeTruthy();
  });

  it("retrieves agent by name", () => {
    registerAgent(db, { name: "my-agent", model: null, capabilities: ["read"] });

    const found = getAgentByName(db, "my-agent");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("my-agent");
    expect(found!.capabilities).toEqual(["read"]);
  });

  it("returns null for unknown agent name", () => {
    expect(getAgentByName(db, "ghost")).toBeNull();
  });

  it("updates agent on re-register (upsert)", () => {
    const first = registerAgent(db, { name: "agent-x", model: "model-a", capabilities: ["read"] });
    // Wait a tick so timestamps can differ
    const second = registerAgent(db, { name: "agent-x", model: "model-b", capabilities: ["read", "write", "exec"] });

    expect(second.id).toBe(first.id);
    expect(second.model).toBe("model-b");
    expect(second.capabilities).toEqual(["read", "write", "exec"]);
  });
});

// ─── Activity Log ─────────────────────────────────────────────────────────────

describe("activity log", () => {
  let projectId: string;
  let taskId: string;
  let agentId: string;

  beforeEach(() => {
    projectId = createProject(db, { name: "P", description: null }).id;
    taskId = createTask(db, { project_id: projectId, title: "T", description: null, priority: "low" }).id;
    agentId = registerAgent(db, { name: "logger", model: null, capabilities: [] }).id;
  });

  it("logs an activity entry", () => {
    const entry = logActivity(db, { task_id: taskId, agent_id: agentId, message: "Started work" });

    expect(entry.id).toBeTruthy();
    expect(entry.task_id).toBe(taskId);
    expect(entry.agent_id).toBe(agentId);
    expect(entry.message).toBe("Started work");
    expect(entry.timestamp).toBeTruthy();
  });

  it("logs activity without an agent", () => {
    const entry = logActivity(db, { task_id: taskId, agent_id: null, message: "System event" });
    expect(entry.agent_id).toBeNull();
  });

  it("retrieves recent activity", () => {
    logActivity(db, { task_id: taskId, agent_id: null, message: "Event 1" });
    logActivity(db, { task_id: taskId, agent_id: null, message: "Event 2" });
    logActivity(db, { task_id: taskId, agent_id: null, message: "Event 3" });

    const recent = getRecentActivity(db, 2);
    expect(recent).toHaveLength(2);
  });

  it("returns all activity when limit exceeds count", () => {
    logActivity(db, { task_id: taskId, agent_id: null, message: "Only entry" });
    expect(getRecentActivity(db, 100)).toHaveLength(1);
  });

  it("bubbles sub-agent activity to parent agent last_seen_at", () => {
    const parent = registerAgent(db, { name: "parent-agent", model: null, capabilities: [] });
    const child = registerAgent(db, { name: "child-agent", model: null, capabilities: [], parent_agent_name: "parent-agent" });

    // Set parent last_seen_at to an old timestamp
    db.prepare("UPDATE agents SET last_seen_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(parent.id);

    logActivity(db, { task_id: taskId, agent_id: child.id, message: "sub-agent work" });

    const updatedParent = db.prepare("SELECT last_seen_at FROM agents WHERE id = ?").get(parent.id) as { last_seen_at: string };
    expect(new Date(updatedParent.last_seen_at).getFullYear()).toBeGreaterThan(2020);
  });
});

// ─── Blockers ─────────────────────────────────────────────────────────────────

describe("blockers", () => {
  let projectId: string;
  let taskId: string;

  beforeEach(() => {
    projectId = createProject(db, { name: "P", description: null }).id;
    taskId = createTask(db, { project_id: projectId, title: "T", description: null, priority: "low" }).id;
  });

  it("creates a blocker and sets task status to blocked", () => {
    const blocker = createBlocker(db, { task_id: taskId, reason: "Waiting on API" });

    expect(blocker.id).toBeTruthy();
    expect(blocker.task_id).toBe(taskId);
    expect(blocker.reason).toBe("Waiting on API");
    expect(blocker.reported_at).toBeTruthy();
    expect(blocker.resolved_at).toBeNull();

    const task = getTask(db, taskId);
    expect(task!.status).toBe("blocked");
  });

  it("resolves a blocker and sets task status to in_progress", () => {
    const blocker = createBlocker(db, { task_id: taskId, reason: "Dependency missing" });
    const resolved = resolveBlocker(db, blocker.id);

    expect(resolved).not.toBeNull();
    expect(resolved!.resolved_at).not.toBeNull();

    const task = getTask(db, taskId);
    expect(task!.status).toBe("in_progress");
  });

  it("returns active (unresolved) blockers", () => {
    const b1 = createBlocker(db, { task_id: taskId, reason: "Issue A" });
    const b2 = createBlocker(db, { task_id: taskId, reason: "Issue B" });
    resolveBlocker(db, b1.id);

    const active = getActiveBlockers(db);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(b2.id);
  });

  it("returns empty array when no active blockers", () => {
    expect(getActiveBlockers(db)).toHaveLength(0);
  });
});
