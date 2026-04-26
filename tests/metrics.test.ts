import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import { createServer, type IncomingMessage } from "http";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createRouter } from "../server/routes.js";
import {
  createProject,
  createTask,
  registerAgent,
  logCompletionMetrics,
  getAgentPerformance,
  getAgentComparison,
  getTaskTypeBreakdown,
} from "../server/db/index.js";
import http from "http";

let app: Express;
let db: Database.Database;

function request(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": String(Buffer.byteLength(payload)) } : {}),
        },
      };
      const req = http.request(options, (res: IncomingMessage) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk; });
        res.on("end", () => {
          server.close();
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data });
          }
        });
      });
      req.on("error", (err: Error) => { server.close(); reject(err); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

beforeEach(() => {
  db = createTestDb();
  app = express();
  app.use(express.json());
  app.use(createRouter(db));
});

describe("completion_metrics DB functions", () => {
  it("logCompletionMetrics creates a metrics entry", () => {
    const project = createProject(db, { name: "P1", description: null });
    const task = createTask(db, {
      project_id: project.id, title: "T1", priority: "medium",
      parent_task_id: null, sprint_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null, recurrence_rule: null,
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
      parent_task_id: null, sprint_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null, recurrence_rule: null,
    });
    const task2 = createTask(db, {
      project_id: project.id, title: "T2", priority: "medium",
      parent_task_id: null, sprint_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null, recurrence_rule: null,
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
      parent_task_id: null, sprint_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null, recurrence_rule: null,
    });
    const task2 = createTask(db, {
      project_id: project.id, title: "T2", priority: "medium",
      parent_task_id: null, sprint_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null, recurrence_rule: null,
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
      parent_task_id: null, sprint_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null, recurrence_rule: null,
    });
    const taskMed = createTask(db, {
      project_id: project.id, title: "T2", priority: "medium",
      parent_task_id: null, sprint_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null, recurrence_rule: null,
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
      parent_task_id: null, sprint_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null, recurrence_rule: null,
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

  it("GET /api/agents/:id/performance returns metrics", async () => {
    const project = createProject(db, { name: "P1", description: null });
    const agent = registerAgent(db, { name: "agent-1", model: null, capabilities: [] });
    const task = createTask(db, {
      project_id: project.id, title: "T1", priority: "medium",
      parent_task_id: null, sprint_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null, recurrence_rule: null,
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
      parent_task_id: null, sprint_id: null, assigned_agent_id: null,
      description: null, due_date: null, start_date: null, estimate: null, recurrence_rule: null,
    });
    logCompletionMetrics(db, { task_id: task.id, agent_id: agent.id, lines_added: 30 });

    const { status, body } = await request("GET", `/api/agents/${agent.id}/task-type-breakdown`);
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].priority).toBe("high");
  });
});
