import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { requestApp, requestAppRaw } from "./http-helper.js";
import { createRouter } from "../server/routes/index.js";
import { errorHandler } from "../server/routes/middleware.js";
import {
  createProject,
  createTask,
  registerAgent,
  logCompletionMetrics,
  getAgentPerformance,
  getAgentComparison,
  getTaskTypeBreakdown,
} from "../server/db/index.js";

let app: Express;
let db: Database.Database;

function request(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  return requestApp(app, method, path, body);
}

/** As `request`, but sends an already-serialised body verbatim. */
function requestRaw(
  method: string,
  path: string,
  payload: string
): Promise<{ status: number; body: any }> {
  return requestAppRaw(app, method, path, payload);
}

beforeEach(() => {
  db = createTestDb();
  app = express();
  app.use(express.json());
  app.use(createRouter(db));
  // Mounted last, as server/index.ts does, and load-bearing here: the
  // malformed-body test below reaches it, because express.json() rejects that
  // payload before any route runs. Without it that test would get Express's
  // default HTML page instead of `{ error }`. See tests/http-helper.test.ts.
  app.use(errorHandler);
});

describe("completion_metrics DB functions", () => {
  it("logCompletionMetrics creates a metrics entry", () => {
    const project = createProject(db, { name: "P1", description: null });
    const task = createTask(db, {
      project_id: project.id, title: "T1", priority: "medium",
      parent_task_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null,
    });
    const agent = registerAgent(db, { name: "agent-1", model: null, capabilities: [] });

    const metrics = logCompletionMetrics(db, {
      task_id: task.id,
      agent_id: agent.id,
      lines_added: 100,
      lines_removed: 20,
      files_changed: 5,
      tests_added: 3,
      tests_passing: 10,
      duration_seconds: 3600,
    });

    expect(metrics.id).toBeTruthy();
    expect(metrics.task_id).toBe(task.id);
    expect(metrics.agent_id).toBe(agent.id);
    expect(metrics.lines_added).toBe(100);
    expect(metrics.lines_removed).toBe(20);
    expect(metrics.files_changed).toBe(5);
    expect(metrics.tests_added).toBe(3);
    expect(metrics.tests_passing).toBe(10);
    expect(metrics.duration_seconds).toBe(3600);
  });

  it("getAgentPerformance returns aggregated metrics", () => {
    const project = createProject(db, { name: "P1", description: null });
    const agent = registerAgent(db, { name: "agent-1", model: null, capabilities: [] });

    const task1 = createTask(db, {
      project_id: project.id, title: "T1", priority: "high",
      parent_task_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null,
    });
    const task2 = createTask(db, {
      project_id: project.id, title: "T2", priority: "medium",
      parent_task_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null,
    });

    logCompletionMetrics(db, { task_id: task1.id, agent_id: agent.id, lines_added: 100, duration_seconds: 1000 });
    logCompletionMetrics(db, { task_id: task2.id, agent_id: agent.id, lines_added: 200, duration_seconds: 2000 });

    const perf = getAgentPerformance(db, agent.id);
    expect(perf).not.toBeNull();
    expect(perf!.tasks_completed).toBe(2);
    expect(perf!.total_lines_added).toBe(300);
    expect(perf!.avg_duration_seconds).toBe(1500);
    expect(perf!.agent_name).toBe("agent-1");
  });

  it("getAgentPerformance returns null for agent with no metrics", () => {
    const agent = registerAgent(db, { name: "agent-empty", model: null, capabilities: [] });
    expect(getAgentPerformance(db, agent.id)).toBeNull();
  });

  it("getAgentComparison returns all agents with metrics", () => {
    const project = createProject(db, { name: "P1", description: null });
    const agent1 = registerAgent(db, { name: "agent-1", model: null, capabilities: [] });
    const agent2 = registerAgent(db, { name: "agent-2", model: null, capabilities: [] });

    const task1 = createTask(db, {
      project_id: project.id, title: "T1", priority: "high",
      parent_task_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null,
    });
    const task2 = createTask(db, {
      project_id: project.id, title: "T2", priority: "medium",
      parent_task_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null,
    });

    logCompletionMetrics(db, { task_id: task1.id, agent_id: agent1.id, lines_added: 50 });
    logCompletionMetrics(db, { task_id: task2.id, agent_id: agent2.id, lines_added: 100 });

    const comparison = getAgentComparison(db);
    expect(comparison.agents).toHaveLength(2);
  });

  it("getTaskTypeBreakdown returns breakdown by priority", () => {
    const project = createProject(db, { name: "P1", description: null });
    const agent = registerAgent(db, { name: "agent-1", model: null, capabilities: [] });

    const taskHigh = createTask(db, {
      project_id: project.id, title: "T1", priority: "high",
      parent_task_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null,
    });
    const taskMed = createTask(db, {
      project_id: project.id, title: "T2", priority: "medium",
      parent_task_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null,
    });

    logCompletionMetrics(db, { task_id: taskHigh.id, agent_id: agent.id, lines_added: 50 });
    logCompletionMetrics(db, { task_id: taskMed.id, agent_id: agent.id, lines_added: 100 });

    const breakdown = getTaskTypeBreakdown(db, agent.id);
    expect(breakdown).toHaveLength(2);
    const priorities = breakdown.map((b) => b.priority);
    expect(priorities).toContain("high");
    expect(priorities).toContain("medium");
  });
});

describe("metrics REST endpoints", () => {
  it("POST /api/metrics logs metrics and returns 201", async () => {
    const project = createProject(db, { name: "P1", description: null });
    const task = createTask(db, {
      project_id: project.id, title: "T1", priority: "medium",
      parent_task_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null,
    });
    const agent = registerAgent(db, { name: "agent-1", model: null, capabilities: [] });

    const { status, body } = await request("POST", "/api/metrics", {
      task_id: task.id,
      agent_id: agent.id,
      lines_added: 42,
      files_changed: 3,
    });
    expect(status).toBe(201);
    expect(body.lines_added).toBe(42);
    expect(body.files_changed).toBe(3);
  });

  it("POST /api/metrics returns 400 without required fields", async () => {
    const { status } = await request("POST", "/api/metrics", { lines_added: 10 });
    expect(status).toBe(400);
  });

  describe("POST /api/metrics numeric field validation", () => {
    // Spelled out rather than imported from the route, so this stays an
    // independent statement of the contract: dropping a field from the
    // route's own NUMERIC_FIELDS list has to turn one of these red.
    const NUMERIC_FIELDS = [
      "lines_added", "lines_removed", "files_changed",
      "tests_added", "tests_passing", "duration_seconds",
    ];

    // Values that are not finite numbers, each paired with the field it is
    // sent as. better-sqlite3 binds some of these without complaint, so
    // without the guard they corrupt the row rather than failing loudly:
    // an array is spread as a positional parameter list, making [1] insert 1.
    const NON_NUMERIC_VALUES: Array<[string, string, unknown]> = [
      ["an object", "lines_added", {}],
      ["an array", "lines_added", [1]],
      ["a boolean", "tests_passing", true],
      ["null", "files_changed", null],
    ];

    let taskId: string;
    let agentId: string;

    beforeEach(() => {
      const project = createProject(db, { name: "P1", description: null });
      taskId = createTask(db, {
        project_id: project.id, title: "T1", priority: "medium",
        parent_task_id: null, assigned_agent_id: null,
        description: null, due_date: null, start_date: null, estimate: null,
      }).id;
      agentId = registerAgent(db, { name: "agent-1", model: null, capabilities: [] }).id;
    });

    it.each(NUMERIC_FIELDS)("rejects a non-numeric string for %s", async (field) => {
      const { status, body } = await request("POST", "/api/metrics", {
        task_id: taskId, agent_id: agentId, [field]: "abc",
      });
      expect(status).toBe(400);
      expect(body.error).toBe(`${field} must be a number`);
    });

    it.each(NON_NUMERIC_VALUES)("rejects %s", async (_label, field, value) => {
      const { status, body } = await request("POST", "/api/metrics", {
        task_id: taskId, agent_id: agentId, [field]: value,
      });
      expect(status).toBe(400);
      expect(body.error).toBe(`${field} must be a number`);
    });

    it("rejects a numeric literal that overflows to Infinity", async () => {
      // 1e400 is valid JSON but JSON.parse yields Infinity — a number that is
      // not finite, so a plain typeof check would let it through. It has to be
      // sent raw: JSON.stringify(Infinity) is "null". (NaN has no such case —
      // it is not valid JSON, so express.json() rejects it before the route.)
      const { status, body } = await requestRaw(
        "POST",
        "/api/metrics",
        `{"task_id":${JSON.stringify(taskId)},"agent_id":${JSON.stringify(agentId)},"duration_seconds":1e400}`,
      );
      expect(status).toBe(400);
      expect(body.error).toBe("duration_seconds must be a number");
    });

    it("rejects a body that is not valid JSON, in the same error shape", async () => {
      // express.json() rejects this before the route runs, so the 400 comes
      // from the mounted errorHandler rather than the route's own validation.
      // Pinned here against the real router because that is what makes the
      // errorHandler mount in this file's beforeEach load-bearing: drop it and
      // this returns Express's default HTML page instead.
      const { status, body } = await requestRaw("POST", "/api/metrics", "{not valid json");
      expect(status).toBe(400);
      expect(body).toEqual({ error: expect.any(String) });
    });
  });

  it("GET /api/agents/:id/performance returns metrics", async () => {
    const project = createProject(db, { name: "P1", description: null });
    const agent = registerAgent(db, { name: "agent-1", model: null, capabilities: [] });
    const task = createTask(db, {
      project_id: project.id, title: "T1", priority: "medium",
      parent_task_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null,
    });
    logCompletionMetrics(db, { task_id: task.id, agent_id: agent.id, lines_added: 50 });

    const { status, body } = await request("GET", `/api/agents/${agent.id}/performance`);
    expect(status).toBe(200);
    expect(body.tasks_completed).toBe(1);
    expect(body.total_lines_added).toBe(50);
  });

  it("GET /api/agents/:id/performance returns 404 for no metrics", async () => {
    const agent = registerAgent(db, { name: "agent-none", model: null, capabilities: [] });
    const { status } = await request("GET", `/api/agents/${agent.id}/performance`);
    expect(status).toBe(404);
  });

  it("GET /api/agents/comparison returns comparison", async () => {
    const { status, body } = await request("GET", "/api/agents/comparison");
    expect(status).toBe(200);
    expect(body.agents).toBeInstanceOf(Array);
  });

  it("GET /api/agents/:id/task-type-breakdown returns breakdown", async () => {
    const project = createProject(db, { name: "P1", description: null });
    const agent = registerAgent(db, { name: "agent-1", model: null, capabilities: [] });
    const task = createTask(db, {
      project_id: project.id, title: "T1", priority: "high",
      parent_task_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null,
    });
    logCompletionMetrics(db, { task_id: task.id, agent_id: agent.id, lines_added: 30 });

    const { status, body } = await request("GET", `/api/agents/${agent.id}/task-type-breakdown`);
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].priority).toBe("high");
  });
});
