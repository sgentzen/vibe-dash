import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  initDb,
  createProject,
  createTask,
  registerAgent,
  completeTask,
  logActivity,
  createBlocker,
  createSprint,
  updateSprint,
  getAgentStats,
  getSprintAgentContributions,
  recordDailyStats,
  getSprintDailyStats,
  getVelocityTrend,
  getAgentActivityHeatmap,
  generateReport,
  getSprintCapacity,
} from "../server/db/index.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initDb(db);
});

// ─── 1.5 Agent Performance Metrics ──────────────────────────────────────────

describe("1.5 Agent Performance Metrics", () => {
  it("computes basic agent stats", () => {
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });

    logActivity(db, { task_id: task.id, agent_id: agent.id, message: "working" });
    completeTask(db, task.id);

    const stats = getAgentStats(db, agent.id);
    expect(stats.agent_id).toBe(agent.id);
    expect(stats.tasks_completed_total).toBeGreaterThanOrEqual(1);
    expect(stats.blocker_rate).toBe(0);
  });

  it("computes blocker rate", () => {
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium" });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "medium" });

    logActivity(db, { task_id: t1.id, agent_id: agent.id, message: "working on t1" });
    logActivity(db, { task_id: t2.id, agent_id: agent.id, message: "working on t2" });
    createBlocker(db, { task_id: t1.id, reason: "stuck" });

    const stats = getAgentStats(db, agent.id);
    expect(stats.blocker_rate).toBe(0.5); // 1 out of 2 tasks blocked
  });

  it("computes sprint-scoped stats", () => {
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const sprint = createSprint(db, { project_id: project.id, name: "S1" });
    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium", sprint_id: sprint.id });

    logActivity(db, { task_id: t1.id, agent_id: agent.id, message: "done" });
    completeTask(db, t1.id);

    const stats = getAgentStats(db, agent.id, sprint.id);
    expect(stats.tasks_completed_sprint).toBeGreaterThanOrEqual(1);
  });

  it("returns sprint agent contributions", () => {
    const agent1 = registerAgent(db, { name: "bot-1", model: null, capabilities: [] });
    const agent2 = registerAgent(db, { name: "bot-2", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const sprint = createSprint(db, { project_id: project.id, name: "S1" });

    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium", sprint_id: sprint.id, estimate: 3, assigned_agent_id: agent1.id });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "medium", sprint_id: sprint.id, estimate: 5, assigned_agent_id: agent2.id });

    logActivity(db, { task_id: t1.id, agent_id: agent1.id, message: "done" });
    logActivity(db, { task_id: t2.id, agent_id: agent2.id, message: "done" });
    completeTask(db, t1.id);
    completeTask(db, t2.id);

    const contribs = getSprintAgentContributions(db, sprint.id);
    expect(contribs).toHaveLength(2);
    const bot1 = contribs.find((c) => c.agent_name === "bot-1");
    const bot2 = contribs.find((c) => c.agent_name === "bot-2");
    expect(bot1?.completed_points).toBe(3);
    expect(bot2?.completed_points).toBe(5);
  });
});

// ─── 2.4 Sprint Velocity & Burndown ─────────────────────────────────────────

describe("2.4 Sprint Velocity & Burndown", () => {
  it("records and retrieves daily stats", () => {
    const project = createProject(db, { name: "P", description: null });
    const sprint = createSprint(db, { project_id: project.id, name: "S1" });
    createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium", sprint_id: sprint.id, estimate: 5 });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "medium", sprint_id: sprint.id, estimate: 3 });
    completeTask(db, t2.id);

    const stats = recordDailyStats(db, sprint.id);
    expect(stats.completed_points).toBe(3);
    expect(stats.remaining_points).toBe(5);

    const history = getSprintDailyStats(db, sprint.id);
    expect(history).toHaveLength(1);
    expect(history[0].date).toBe(new Date().toISOString().slice(0, 10));
  });

  it("updates daily stats on re-record", () => {
    const project = createProject(db, { name: "P", description: null });
    const sprint = createSprint(db, { project_id: project.id, name: "S1" });
    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium", sprint_id: sprint.id, estimate: 5 });

    recordDailyStats(db, sprint.id);
    completeTask(db, t1.id);
    const stats = recordDailyStats(db, sprint.id);

    expect(stats.completed_points).toBe(5);
    expect(stats.remaining_points).toBe(0);
    // Should still be 1 row (upsert)
    expect(getSprintDailyStats(db, sprint.id)).toHaveLength(1);
  });

  it("computes velocity trend from completed sprints", () => {
    const project = createProject(db, { name: "P", description: null });
    const s1 = createSprint(db, { project_id: project.id, name: "Sprint 1" });
    const s2 = createSprint(db, { project_id: project.id, name: "Sprint 2" });

    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium", sprint_id: s1.id, estimate: 5 });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "medium", sprint_id: s2.id, estimate: 8 });

    completeTask(db, t1.id);
    completeTask(db, t2.id);
    updateSprint(db, s1.id, { status: "completed" });
    updateSprint(db, s2.id, { status: "completed" });

    const velocity = getVelocityTrend(db, 5);
    expect(velocity).toHaveLength(2);
    expect(velocity.some((v) => v.completed_points === 5)).toBe(true);
    expect(velocity.some((v) => v.completed_points === 8)).toBe(true);
  });

  it("returns empty velocity for no completed sprints", () => {
    expect(getVelocityTrend(db)).toHaveLength(0);
  });
});

// ─── Activity Heatmap ────────────────────────────────────────────────────────

describe("Activity Heatmap", () => {
  it("returns activity grouped by hour and agent", () => {
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });

    logActivity(db, { task_id: task.id, agent_id: agent.id, message: "work 1" });
    logActivity(db, { task_id: task.id, agent_id: agent.id, message: "work 2" });

    const heatmap = getAgentActivityHeatmap(db);
    expect(heatmap.length).toBeGreaterThanOrEqual(1);
    const entry = heatmap.find((e) => e.agent_id === agent.id);
    expect(entry).toBeDefined();
    expect(entry!.count).toBeGreaterThanOrEqual(2);
  });
});

// ─── 4.4 Report Generation ──────────────────────────────────────────────────

describe("4.4 Report Generation", () => {
  it("generates a markdown report", () => {
    const project = createProject(db, { name: "Test Project", description: null });
    const task = createTask(db, { project_id: project.id, title: "Fix bug", description: null, priority: "high" });
    completeTask(db, task.id);

    const report = generateReport(db, project.id, "week");
    expect(report).toContain("Test Project");
    expect(report).toContain("Fix bug");
    expect(report).toContain("Tasks Completed");
  });

  it("includes blocker info", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });
    createBlocker(db, { task_id: task.id, reason: "DB is down" });

    const report = generateReport(db, project.id, "day");
    expect(report).toContain("DB is down");
    expect(report).toContain("unresolved");
  });

  it("includes sprint progress when active sprint exists", () => {
    const project = createProject(db, { name: "P", description: null });
    const sprint = createSprint(db, { project_id: project.id, name: "Active Sprint" });
    updateSprint(db, sprint.id, { status: "active" });
    createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium", sprint_id: sprint.id, estimate: 5 });

    const report = generateReport(db, project.id, "sprint");
    expect(report).toContain("Active Sprint");
    expect(report).toContain("Points:");
  });

  it("returns error for unknown project", () => {
    const report = generateReport(db, "nonexistent", "week");
    expect(report).toContain("not found");
  });
});
