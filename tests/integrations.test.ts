import { describe, it, expect, beforeEach } from "vitest";
import express, { type Express } from "express";
import { createServer, type IncomingMessage } from "http";
import http from "http";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createRouter } from "../server/routes.js";
import { createProject, listTasks, registerAgent } from "../server/db/index.js";

let app: Express;
let db: Database.Database;

function request(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
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
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode ?? 0, body: data }); }
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

describe("POST /api/integrations/*", () => {
  it("rejects missing project_id", async () => {
    const { status, body } = await request("POST", "/api/integrations/generic", { title: "x" });
    expect(status).toBe(400);
    expect(body.error).toMatch(/project_id/);
  });

  it("rejects unknown project_id", async () => {
    const { status, body } = await request("POST", "/api/integrations/generic?project_id=nope", { title: "x" });
    expect(status).toBe(400);
    expect(body.error).toMatch(/project not found/);
  });

  it("rejects payload missing title", async () => {
    const p = createProject(db, { name: "P", description: null });
    const { status } = await request("POST", `/api/integrations/generic?project_id=${p.id}`, { severity: "high" });
    expect(status).toBe(400);
  });

  it("creates a task from a PagerDuty incident (critical → urgent)", async () => {
    const p = createProject(db, { name: "P", description: null });
    const { status, body } = await request(
      "POST",
      `/api/integrations/pagerduty?project_id=${p.id}`,
      { event: { data: { id: "PD-1", title: "Database down", severity: "critical", description: "All writes failing" } } },
    );
    expect(status).toBe(201);
    expect(body.task.priority).toBe("urgent");
    expect(body.task.title).toContain("[pagerduty]");
    expect(body.task.title).toContain("Database down");
    expect(body.task.description).toContain("PD-1");
    const tasks = listTasks(db, { project_id: p.id });
    expect(tasks).toHaveLength(1);
  });

  it("maps Sentry fatal → urgent, warning → medium", async () => {
    const p = createProject(db, { name: "P", description: null });
    const r1 = await request("POST", `/api/integrations/sentry?project_id=${p.id}`, {
      data: { issue: { id: "S1", title: "Crash", level: "fatal" } },
    });
    expect(r1.body.task.priority).toBe("urgent");
    const r2 = await request("POST", `/api/integrations/sentry?project_id=${p.id}`, {
      data: { issue: { id: "S2", title: "Slow query", level: "warning" } },
    });
    expect(r2.body.task.priority).toBe("medium");
  });

  it("maps Grafana alerting → high, ok → low", async () => {
    const p = createProject(db, { name: "P", description: null });
    const r1 = await request("POST", `/api/integrations/grafana?project_id=${p.id}`, {
      ruleId: "G1", ruleName: "CPU high", state: "alerting", message: "CPU > 90%",
    });
    expect(r1.body.task.priority).toBe("high");
    const r2 = await request("POST", `/api/integrations/grafana?project_id=${p.id}`, {
      ruleId: "G2", ruleName: "CPU recovered", state: "ok", message: "ok",
    });
    expect(r2.body.task.priority).toBe("low");
  });

  it("generic endpoint defaults to medium when severity missing", async () => {
    const p = createProject(db, { name: "P", description: null });
    const { status, body } = await request("POST", `/api/integrations/generic?project_id=${p.id}`, {
      title: "Something happened",
    });
    expect(status).toBe(201);
    expect(body.task.priority).toBe("medium");
  });

  it("rejects unknown assigned_agent_id", async () => {
    const p = createProject(db, { name: "P", description: null });
    const { status, body } = await request(
      "POST",
      `/api/integrations/generic?project_id=${p.id}&assigned_agent_id=ghost`,
      { title: "Alert", severity: "high" },
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/assigned_agent_id/);
  });

  it("assigns to an agent when assigned_agent_id is passed", async () => {
    const p = createProject(db, { name: "P", description: null });
    const agent = registerAgent(db, { name: "on-call", model: null, capabilities: [] });
    const { body } = await request(
      "POST",
      `/api/integrations/generic?project_id=${p.id}&assigned_agent_id=${agent.id}`,
      { title: "Alert", severity: "high" },
    );
    expect(body.task.assigned_agent_id).toBe(agent.id);
    expect(body.task.priority).toBe("high");
  });
});
