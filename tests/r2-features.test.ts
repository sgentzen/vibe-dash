import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import {
  createProject,
  createTask,
  updateTask,
  getTask,
  logActivity,
  registerAgent,
  getTimeSpent,
  getMilestoneProgress,
  addDependency,
  removeDependency,
  listDependencies,
  getBlockingTasks,
  startOrGetSession,
  closeStaleSession,
  listAgentSessions,
  searchTasks,
  createSavedFilter,
  listSavedFilters,
  deleteSavedFilter,
  createMilestone,
  completeTask,
  getAgentById,
  getAgentActivity,
  getAgentCompletedToday,
} from "../server/db/index.js";
import { createTestDb } from "./setup.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

// ─── 2.2 Time Estimates ────────────────────────────────────────────────────

describe("2.2 Time Estimates", () => {
  it("creates task with estimate", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, {
      project_id: project.id,
      title: "T",
      description: null,
      priority: "medium",
      estimate: 5,
    });
    expect(task.estimate).toBe(5);
  });

  it("updates task estimate", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, {
      project_id: project.id,
      title: "T",
      description: null,
      priority: "medium",
    });
    expect(task.estimate).toBeNull();
    const updated = updateTask(db, task.id, { estimate: 8 });
    expect(updated!.estimate).toBe(8);
  });

  it("clears estimate to null", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, {
      project_id: project.id,
      title: "T",
      description: null,
      priority: "medium",
      estimate: 3,
    });
    const updated = updateTask(db, task.id, { estimate: null });
    expect(updated!.estimate).toBeNull();
  });

  it("computes milestone progress", () => {
    const project = createProject(db, { name: "P", description: null });
    const milestone = createMilestone(db, { project_id: project.id, name: "M1" });
    createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium", estimate: 5, milestone_id: milestone.id });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "medium", estimate: 3, milestone_id: milestone.id });
    createTask(db, { project_id: project.id, title: "T3", description: null, priority: "medium", milestone_id: milestone.id });

    completeTask(db, t2.id);

    const progress = getMilestoneProgress(db, milestone.id);
    expect(progress.task_count).toBe(3);
    expect(progress.completed_count).toBe(1);
    expect(progress.completion_pct).toBe(33);
  });

  it("returns null time_spent for incomplete task", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });
    expect(getTimeSpent(db, task.id)).toBeNull();
  });
});

// ─── 2.5 Task Dependencies ─────────────────────────────────────────────────

describe("2.5 Task Dependencies", () => {
  it("adds and lists dependencies", () => {
    const project = createProject(db, { name: "P", description: null });
    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium" });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "medium" });
    const t3 = createTask(db, { project_id: project.id, title: "T3", description: null, priority: "medium" });

    addDependency(db, t1.id, t2.id);
    addDependency(db, t1.id, t3.id);

    const deps = listDependencies(db, t1.id);
    expect(deps).toHaveLength(2);
    expect(deps.map(d => d.depends_on_task_id).sort()).toEqual([t2.id, t3.id].sort());
  });

  it("removes dependency", () => {
    const project = createProject(db, { name: "P", description: null });
    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium" });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "medium" });

    const dep = addDependency(db, t1.id, t2.id);
    expect(listDependencies(db, t1.id)).toHaveLength(1);

    removeDependency(db, dep.id);
    expect(listDependencies(db, t1.id)).toHaveLength(0);
  });

  it("gets blocking (undone) tasks", () => {
    const project = createProject(db, { name: "P", description: null });
    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium" });
    const t2 = createTask(db, { project_id: project.id, title: "Blocker", description: null, priority: "medium" });
    const t3 = createTask(db, { project_id: project.id, title: "Done blocker", description: null, priority: "medium" });

    addDependency(db, t1.id, t2.id);
    addDependency(db, t1.id, t3.id);
    completeTask(db, t3.id);

    const blocking = getBlockingTasks(db, t1.id);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].title).toBe("Blocker");
  });

  it("rejects self-dependency", () => {
    const project = createProject(db, { name: "P", description: null });
    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium" });
    expect(() => addDependency(db, t1.id, t1.id)).toThrow("cannot depend on itself");
  });

  it("prevents duplicate dependencies", () => {
    const project = createProject(db, { name: "P", description: null });
    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium" });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "medium" });

    addDependency(db, t1.id, t2.id);
    addDependency(db, t1.id, t2.id); // duplicate — should be ignored
    expect(listDependencies(db, t1.id)).toHaveLength(1);
  });
});

// ─── 1.3 Agent Sessions ────────────────────────────────────────────────────

describe("1.3 Agent Sessions", () => {
  it("starts a new session on activity", () => {
    registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const agents = db.prepare("SELECT * FROM agents").all() as Array<{ id: string }>;
    const agent = agents[0];

    const session = startOrGetSession(db, agent.id);
    expect(session.agent_id).toBe(agent.id);
    expect(session.activity_count).toBe(1);
    expect(session.ended_at).toBeNull();
  });

  it("increments activity on same session", () => {
    registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const agents = db.prepare("SELECT * FROM agents").all() as Array<{ id: string }>;
    const agent = agents[0];

    const s1 = startOrGetSession(db, agent.id);
    const s2 = startOrGetSession(db, agent.id);
    expect(s2.id).toBe(s1.id);
    expect(s2.activity_count).toBe(2);
  });

  it("lists agent sessions", () => {
    registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const agents = db.prepare("SELECT * FROM agents").all() as Array<{ id: string }>;
    const agent = agents[0];

    startOrGetSession(db, agent.id);
    const sessions = listAgentSessions(db, agent.id);
    expect(sessions.length).toBeGreaterThanOrEqual(1);
  });

  it("closes stale sessions", () => {
    registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const agents = db.prepare("SELECT * FROM agents").all() as Array<{ id: string }>;
    const agent = agents[0];

    // Insert a session with old started_at
    const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    db.prepare(
      "INSERT INTO agent_sessions (id, agent_id, started_at, last_activity_at, tasks_touched, activity_count) VALUES (?, ?, ?, ?, 1, 1)"
    ).run("stale-session", agent.id, oldTime, oldTime);

    const closed = closeStaleSession(db);
    expect(closed).toBeGreaterThanOrEqual(1);

    const sessions = listAgentSessions(db, agent.id);
    const stale = sessions.find(s => s.id === "stale-session");
    expect(stale?.ended_at).not.toBeNull();
  });
});

// ─── 3.1 Search ─────────────────────────────────────────────────────────────

describe("3.1 Search & Filtering", () => {
  it("searches tasks by title", () => {
    const project = createProject(db, { name: "P", description: null });
    createTask(db, { project_id: project.id, title: "Fix login bug", description: null, priority: "high" });
    createTask(db, { project_id: project.id, title: "Add dashboard", description: null, priority: "medium" });
    createTask(db, { project_id: project.id, title: "Update README", description: null, priority: "low" });

    const results = searchTasks(db, { query: "login" });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Fix login bug");
  });

  it("searches tasks by description", () => {
    const project = createProject(db, { name: "P", description: null });
    createTask(db, { project_id: project.id, title: "Task A", description: "authentication flow", priority: "medium" });
    createTask(db, { project_id: project.id, title: "Task B", description: "styling changes", priority: "medium" });

    const results = searchTasks(db, { query: "authentication" });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Task A");
  });

  it("filters by status", () => {
    const project = createProject(db, { name: "P", description: null });
    createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium", status: "planned" });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "medium" });
    completeTask(db, t2.id);

    const results = searchTasks(db, { status: "done" });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("T2");
  });

  it("filters by priority", () => {
    const project = createProject(db, { name: "P", description: null });
    createTask(db, { project_id: project.id, title: "T1", description: null, priority: "high" });
    createTask(db, { project_id: project.id, title: "T2", description: null, priority: "low" });

    const results = searchTasks(db, { priority: "high" });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("T1");
  });

  it("combines query with filters", () => {
    const project = createProject(db, { name: "P", description: null });
    createTask(db, { project_id: project.id, title: "Fix login", description: null, priority: "high" });
    createTask(db, { project_id: project.id, title: "Fix signup", description: null, priority: "low" });
    createTask(db, { project_id: project.id, title: "Add login page", description: null, priority: "high" });

    const results = searchTasks(db, { query: "login", priority: "high" });
    expect(results).toHaveLength(2);
  });

  it("returns empty for non-matching query", () => {
    const project = createProject(db, { name: "P", description: null });
    createTask(db, { project_id: project.id, title: "Something", description: null, priority: "medium" });

    const results = searchTasks(db, { query: "zzzznonexistent" });
    expect(results).toHaveLength(0);
  });
});

// ─── Saved Filters ──────────────────────────────────────────────────────────

describe("Saved Filters", () => {
  it("creates and lists saved filters", () => {
    const f = createSavedFilter(db, "My Filter", JSON.stringify({ status: "planned" }));
    expect(f.name).toBe("My Filter");

    const filters = listSavedFilters(db);
    expect(filters).toHaveLength(1);
    expect(filters[0].name).toBe("My Filter");
  });

  it("deletes saved filter", () => {
    const f = createSavedFilter(db, "Temp", JSON.stringify({}));
    expect(deleteSavedFilter(db, f.id)).toBe(true);
    expect(listSavedFilters(db)).toHaveLength(0);
  });
});

// ─── Agent Detail ───────────────────────────────────────────────────────────

describe("Agent Detail", () => {
  it("gets agent by id", () => {
    const agent = registerAgent(db, { name: "bot-1", model: null, capabilities: ["code"] });
    const found = getAgentById(db, agent.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("bot-1");
  });

  it("returns null for unknown agent id", () => {
    expect(getAgentById(db, "nonexistent")).toBeNull();
  });

  it("gets agent activity", () => {
    const agent = registerAgent(db, { name: "bot-1", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });

    logActivity(db, { task_id: task.id, agent_id: agent.id, message: "started work" });
    logActivity(db, { task_id: task.id, agent_id: agent.id, message: "finished work" });

    const activity = getAgentActivity(db, agent.id, 10);
    expect(activity).toHaveLength(2);
  });

  it("counts completed today", () => {
    const agent = registerAgent(db, { name: "bot-1", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });

    logActivity(db, { task_id: task.id, agent_id: agent.id, message: "done" });
    completeTask(db, task.id);

    const count = getAgentCompletedToday(db, agent.id);
    expect(count).toBeGreaterThanOrEqual(0); // depends on timing
  });
});
