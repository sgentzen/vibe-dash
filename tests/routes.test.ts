import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import { createServer, type Server, type IncomingMessage } from "http";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createRouter } from "../server/routes.js";
import {
  createProject,
  createTask,
  registerAgent,
  createBlocker,
  resolveBlocker,
} from "../server/db.js";
import http from "http";

let app: Express;
let db: Database.Database;

// Minimal HTTP helper: creates a one-shot server on a random port per call
function request(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
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
          ...(payload
            ? { "Content-Length": String(Buffer.byteLength(payload)) }
            : {}),
        },
      };
      const req = http.request(options, (res: IncomingMessage) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk;
        });
        res.on("end", () => {
          server.close();
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data });
          }
        });
      });
      req.on("error", (err: Error) => {
        server.close();
        reject(err);
      });
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

describe("GET /api/stats", () => {
  it("returns zero counts for an empty database", async () => {
    const { status, body } = await request("GET", "/api/stats");
    expect(status).toBe(200);
    expect(body).toEqual({ projects: 0, tasks: 0, activeAgents: 0, alerts: 0 });
  });

  it("returns correct counts after inserting data", async () => {
    const p = createProject(db, { name: "P1", description: null });
    const t = createTask(db, {
      project_id: p.id,
      title: "T1",
      description: null,
      priority: "low",
    });
    registerAgent(db, { name: "agent-1", model: null, capabilities: [] });
    createBlocker(db, { task_id: t.id, reason: "blocked by something" });

    const { status, body } = await request("GET", "/api/stats");
    expect(status).toBe(200);
    expect(body).toEqual({ projects: 1, tasks: 1, activeAgents: 1, alerts: 1 });
  });

  it("does not count resolved blockers as alerts", async () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, {
      project_id: p.id,
      title: "T",
      description: null,
      priority: "low",
    });
    const blocker = createBlocker(db, { task_id: t.id, reason: "reason" });
    resolveBlocker(db, blocker.id);

    const { body } = await request("GET", "/api/stats");
    expect((body as { alerts: number }).alerts).toBe(0);
  });
});

describe("GET /api/projects", () => {
  it("returns all projects", async () => {
    createProject(db, { name: "Alpha", description: null });
    createProject(db, { name: "Beta", description: "desc" });

    const { status, body } = await request("GET", "/api/projects");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(2);
  });
});

describe("POST /api/projects", () => {
  it("creates a project", async () => {
    const { status, body } = await request("POST", "/api/projects", {
      name: "New Project",
    });
    expect(status).toBe(201);
    expect((body as { name: string }).name).toBe("New Project");
  });

  it("returns 400 when name is missing", async () => {
    const { status } = await request("POST", "/api/projects", {});
    expect(status).toBe(400);
  });
});

describe("GET /api/tasks", () => {
  it("filters tasks by project_id", async () => {
    const p1 = createProject(db, { name: "P1", description: null });
    const p2 = createProject(db, { name: "P2", description: null });
    createTask(db, {
      project_id: p1.id,
      title: "T1",
      description: null,
      priority: "low",
    });
    createTask(db, {
      project_id: p2.id,
      title: "T2",
      description: null,
      priority: "low",
    });

    const { body } = await request("GET", `/api/tasks?project_id=${p1.id}`);
    expect((body as unknown[]).length).toBe(1);
    expect((body as Array<{ title: string }>)[0].title).toBe("T1");
  });
});

describe("POST /api/tasks", () => {
  it("creates a task", async () => {
    const p = createProject(db, { name: "P", description: null });
    const { status, body } = await request("POST", "/api/tasks", {
      project_id: p.id,
      title: "My Task",
      priority: "high",
    });
    expect(status).toBe(201);
    expect((body as { title: string }).title).toBe("My Task");
  });
});

describe("PATCH /api/tasks/:id", () => {
  it("updates a task", async () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, {
      project_id: p.id,
      title: "Old",
      description: null,
      priority: "low",
    });

    const { status, body } = await request("PATCH", `/api/tasks/${t.id}`, {
      title: "New",
    });
    expect(status).toBe(200);
    expect((body as { title: string }).title).toBe("New");
  });

  it("returns 404 for unknown task", async () => {
    const { status } = await request("PATCH", "/api/tasks/no-such-id", {
      title: "x",
    });
    expect(status).toBe(404);
  });
});

describe("POST /api/tasks/:id/complete", () => {
  it("marks a task done", async () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, {
      project_id: p.id,
      title: "T",
      description: null,
      priority: "low",
    });

    const { status, body } = await request(
      "POST",
      `/api/tasks/${t.id}/complete`
    );
    expect(status).toBe(200);
    expect((body as { status: string }).status).toBe("done");
  });
});

describe("GET /api/blockers", () => {
  it("returns only active blockers", async () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, {
      project_id: p.id,
      title: "T",
      description: null,
      priority: "low",
    });
    createBlocker(db, { task_id: t.id, reason: "blocked" });

    const { body } = await request("GET", "/api/blockers");
    expect((body as unknown[]).length).toBe(1);
  });
});
