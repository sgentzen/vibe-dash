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
} from "../server/db/index.js";
import http from "http";

let app: Express;
let db: Database.Database;

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

describe("GET /api/tasks/:id/suggest-agent", () => {
  it("returns null when there are no agents with completion data", async () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", priority: "medium" });

    const { status, body } = await request("GET", `/api/tasks/${task.id}/suggest-agent`);
    expect(status).toBe(200);
    expect(body).toBeNull();
  });

  it("returns a suggestion when completion data exists", async () => {
    const project = createProject(db, { name: "P", description: null });
    const completedTask = createTask(db, { project_id: project.id, title: "Done Task", priority: "medium" });
    const targetTask = createTask(db, { project_id: project.id, title: "Target", priority: "medium" });
    const agent = registerAgent(db, { name: "veteran-agent", model: null, capabilities: [] });

    logCompletionMetrics(db, {
      task_id: completedTask.id,
      agent_id: agent.id,
      duration_seconds: 1800,
      tests_added: 2,
      tests_passing: 2,
    });

    const { status, body } = await request("GET", `/api/tasks/${targetTask.id}/suggest-agent`);
    expect(status).toBe(200);
    expect(body).not.toBeNull();
    const suggestion = body as { agent: { agent_id: string; agent_name: string; score: number }; confidence: number };
    expect(suggestion.agent.agent_id).toBe(agent.id);
    expect(suggestion.agent.agent_name).toBe("veteran-agent");
    expect(typeof suggestion.agent.score).toBe("number");
    expect(typeof suggestion.confidence).toBe("number");
  });

  it("returns null for a nonexistent task id", async () => {
    const { status, body } = await request("GET", "/api/tasks/nonexistent-task-id/suggest-agent");
    expect(status).toBe(200);
    expect(body).toBeNull();
  });
});
