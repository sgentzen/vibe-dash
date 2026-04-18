import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import {
  createProject,
  createTask,
  registerAgent,
  completeTask,
  logActivity,
  createBlocker,
  createMilestone,
  updateMilestone,
  getAgentStats,
  getMilestoneAgentContributions,
  recordMilestoneDailyStats,
  getMilestoneDailyStats,
  getAgentActivityHeatmap,
  generateReport,
  getMilestoneProgress,
} from "../server/db/index.js";
import { createTestDb } from "./setup.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
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

  it("computes milestone-scoped stats", () => {
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const milestone = createMilestone(db, { project_id: project.id, name: "M1" });
    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium", milestone_id: milestone.id });

    logActivity(db, { task_id: t1.id, agent_id: agent.id, message: "done" });
    completeTask(db, t1.id);

    const stats = getAgentStats(db, agent.id, milestone.id);
    expect(stats.tasks_completed_milestone).toBeGreaterThanOrEqual(1);
  });

  it("returns milestone agent contributions", () => {
    const agent1 = registerAgent(db, { name: "bot-1", model: null, capabilities: [] });
    const agent2 = registerAgent(db, { name: "bot-2", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const milestone = createMilestone(db, { project_id: project.id, name: "M1" });

    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium", milestone_id: milestone.id, estimate: 3, assigned_agent_id: agent1.id });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "medium", milestone_id: milestone.id, estimate: 5, assigned_agent_id: agent2.id });

    logActivity(db, { task_id: t1.id, agent_id: agent1.id, message: "done" });
    logActivity(db, { task_id: t2.id, agent_id: agent2.id, message: "done" });
    completeTask(db, t1.id);
    completeTask(db, t2.id);

    const contribs = getMilestoneAgentContributions(db, milestone.id);
    expect(contribs).toHaveLength(2);
    const bot1 = contribs.find((c) => c.agent_name === "bot-1");
    const bot2 = contribs.find((c) => c.agent_name === "bot-2");
    expect(bot1?.completed_count).toBe(1);
    expect(bot2?.completed_count).toBe(1);
  });
});

// ─── 2.4 Milestone Progress & Burndown ──────────────────────────────────────

describe("2.4 Milestone Progress & Burndown", () => {
  it("records and retrieves daily stats", () => {
    const project = createProject(db, { name: "P", description: null });
    const milestone = createMilestone(db, { project_id: project.id, name: "M1" });
    createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium", milestone_id: milestone.id, estimate: 5 });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "medium", milestone_id: milestone.id, estimate: 3 });
    completeTask(db, t2.id);

    const stats = recordMilestoneDailyStats(db, milestone.id);
    expect(stats.completed_tasks).toBe(1);
    expect(stats.total_tasks).toBe(2);
    expect(stats.completion_pct).toBe(50);

    const history = getMilestoneDailyStats(db, milestone.id);
    expect(history).toHaveLength(1);
    expect(history[0].date).toBe(new Date().toISOString().slice(0, 10));
  });

  it("updates daily stats on re-record", () => {
    const project = createProject(db, { name: "P", description: null });
    const milestone = createMilestone(db, { project_id: project.id, name: "M1" });
    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium", milestone_id: milestone.id, estimate: 5 });

    recordMilestoneDailyStats(db, milestone.id);
    completeTask(db, t1.id);
    const stats = recordMilestoneDailyStats(db, milestone.id);

    expect(stats.completed_tasks).toBe(1);
    expect(stats.total_tasks).toBe(1);
    expect(stats.completion_pct).toBe(100);
    // Should still be 1 row (upsert)
    expect(getMilestoneDailyStats(db, milestone.id)).toHaveLength(1);
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

  it("includes milestone progress when open milestone exists", () => {
    const project = createProject(db, { name: "P", description: null });
    const milestone = createMilestone(db, { project_id: project.id, name: "Active Milestone" });
    updateMilestone(db, milestone.id, { status: "open" });
    createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium", milestone_id: milestone.id, estimate: 5 });

    const report = generateReport(db, project.id, "milestone");
    expect(report).toContain("Active Milestone");
    expect(report).toContain("Progress:");
  });

  it("returns error for unknown project", () => {
    const report = generateReport(db, "nonexistent", "week");
    expect(report).toContain("not found");
  });
});
