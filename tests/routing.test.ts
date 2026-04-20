import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  createProject,
  createTask,
  registerAgent,
  logCompletionMetrics,
} from "../server/db/index.js";
import { scoreAgents, suggestAgent } from "../server/db/routing.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

describe("intelligent agent routing", () => {
  it("scoreAgents returns [] when no completion data", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T1", priority: "medium" });
    registerAgent(db, { name: "agent-no-metrics", model: null, capabilities: [] });

    const scores = scoreAgents(db, task.id);
    expect(scores).toEqual([]);
  });

  it("ranks faster agent above slower agent", () => {
    const project = createProject(db, { name: "P", description: null });
    const task1 = createTask(db, { project_id: project.id, title: "T1", priority: "medium" });
    const task2 = createTask(db, { project_id: project.id, title: "T2", priority: "medium" });
    const targetTask = createTask(db, { project_id: project.id, title: "Target", priority: "medium" });

    const fastAgent = registerAgent(db, { name: "fast-agent", model: null, capabilities: [] });
    const slowAgent = registerAgent(db, { name: "slow-agent", model: null, capabilities: [] });

    // fast agent: 1800s (within SPEED_FAST range)
    logCompletionMetrics(db, {
      task_id: task1.id,
      agent_id: fastAgent.id,
      duration_seconds: 1800,
      tests_added: 0,
      tests_passing: 0,
    });

    // slow agent: 90000s (>= 86400, clamps to zero on speed_score)
    logCompletionMetrics(db, {
      task_id: task2.id,
      agent_id: slowAgent.id,
      duration_seconds: 90000,
      tests_added: 0,
      tests_passing: 0,
    });

    const scores = scoreAgents(db, targetTask.id);
    expect(scores.length).toBe(2);
    expect(scores[0].agent_id).toBe(fastAgent.id);
    expect(scores[0].speed_score).toBeGreaterThan(scores[1].speed_score);
  });

  it("familiarity_score boosts local project agent", () => {
    const project = createProject(db, { name: "P", description: null });
    const otherProject = createProject(db, { name: "Other", description: null });

    const localTask = createTask(db, { project_id: project.id, title: "Local T1", priority: "medium" });
    const otherTask = createTask(db, { project_id: otherProject.id, title: "Other T1", priority: "medium" });
    const targetTask = createTask(db, { project_id: project.id, title: "Target", priority: "medium" });

    const localAgent = registerAgent(db, { name: "local-agent", model: null, capabilities: [] });
    const foreignAgent = registerAgent(db, { name: "foreign-agent", model: null, capabilities: [] });

    // local agent completed tasks in target project
    logCompletionMetrics(db, {
      task_id: localTask.id,
      agent_id: localAgent.id,
      duration_seconds: 3600,
      tests_added: 0,
      tests_passing: 0,
    });

    // foreign agent completed tasks in a different project
    logCompletionMetrics(db, {
      task_id: otherTask.id,
      agent_id: foreignAgent.id,
      duration_seconds: 3600,
      tests_added: 0,
      tests_passing: 0,
    });

    const scores = scoreAgents(db, targetTask.id);
    const localScore = scores.find((s) => s.agent_id === localAgent.id);
    const foreignScore = scores.find((s) => s.agent_id === foreignAgent.id);

    expect(localScore).toBeDefined();
    expect(foreignScore).toBeDefined();
    expect(localScore!.familiarity_score).toBeGreaterThan(foreignScore!.familiarity_score);
  });

  it("suggestAgent returns null when no completion data", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", priority: "medium" });

    const result = suggestAgent(db, task.id);
    expect(result).toBeNull();
  });

  it("confidence caps at 100 with 5+ tasks", () => {
    const project = createProject(db, { name: "P", description: null });
    const targetTask = createTask(db, { project_id: project.id, title: "Target", priority: "medium" });
    const agent = registerAgent(db, { name: "veteran-agent", model: null, capabilities: [] });

    // Log 5 completion metrics for different tasks
    for (let i = 0; i < 5; i++) {
      const t = createTask(db, { project_id: project.id, title: `Task ${i}`, priority: "medium" });
      logCompletionMetrics(db, {
        task_id: t.id,
        agent_id: agent.id,
        duration_seconds: 1800,
        tests_added: 0,
        tests_passing: 0,
      });
    }

    const suggestion = suggestAgent(db, targetTask.id);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.confidence).toBe(100);
  });

  it("confidence is proportional below threshold", () => {
    const project = createProject(db, { name: "P", description: null });
    const targetTask = createTask(db, { project_id: project.id, title: "Target", priority: "medium" });
    const agent = registerAgent(db, { name: "junior-agent", model: null, capabilities: [] });

    // Log exactly 1 completion metric
    const t = createTask(db, { project_id: project.id, title: "Task 0", priority: "medium" });
    logCompletionMetrics(db, {
      task_id: t.id,
      agent_id: agent.id,
      duration_seconds: 1800,
      tests_added: 0,
      tests_passing: 0,
    });

    const suggestion = suggestAgent(db, targetTask.id);
    expect(suggestion).not.toBeNull();
    // 1 task / 5 threshold = 20%
    expect(suggestion!.confidence).toBe(20);
  });
});
