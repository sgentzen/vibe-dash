import { describe, it, expect, beforeEach } from "vitest";
import express, { type Express } from "express";
import { createServer, type IncomingMessage } from "http";
import http from "http";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createRouter } from "../server/routes.js";
import { createProject, createTask } from "../server/db/index.js";

let app: Express;
let db: Database.Database;

function request(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
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
        res.on("data", (c: Buffer) => { data += c; });
        res.on("end", () => {
          server.close();
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode ?? 0, body: data }); }
        });
      });
      req.on("error", (err) => { server.close(); reject(err); });
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

describe("5.4 review routes", () => {
  async function makeTask() {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    return t;
  }

  it("POST /api/tasks/:id/reviews creates a review", async () => {
    const t = await makeTask();
    const { status, body } = await request("POST", `/api/tasks/${t.id}/reviews`, {
      reviewer_name: "alice",
      diff_summary: "+5 -2",
    });
    expect(status).toBe(201);
    const review = body as { id: string; status: string; reviewer_name: string };
    expect(review.reviewer_name).toBe("alice");
    expect(review.status).toBe("pending");
  });

  it("POST rejects missing reviewer_name", async () => {
    const t = await makeTask();
    const { status } = await request("POST", `/api/tasks/${t.id}/reviews`, {});
    expect(status).toBe(400);
  });

  it("POST rejects invalid status", async () => {
    const t = await makeTask();
    const { status } = await request("POST", `/api/tasks/${t.id}/reviews`, {
      reviewer_name: "a",
      status: "bogus",
    });
    expect(status).toBe(400);
  });

  it("GET /api/tasks/:id/reviews lists reviews", async () => {
    const t = await makeTask();
    await request("POST", `/api/tasks/${t.id}/reviews`, { reviewer_name: "a" });
    await request("POST", `/api/tasks/${t.id}/reviews`, { reviewer_name: "b" });
    const { status, body } = await request("GET", `/api/tasks/${t.id}/reviews`);
    expect(status).toBe(200);
    expect((body as unknown[]).length).toBe(2);
  });

  it("PATCH /api/reviews/:id updates status", async () => {
    const t = await makeTask();
    const created = await request("POST", `/api/tasks/${t.id}/reviews`, { reviewer_name: "a" });
    const id = (created.body as { id: string }).id;
    const { status, body } = await request("PATCH", `/api/reviews/${id}`, { status: "approved" });
    expect(status).toBe(200);
    expect((body as { status: string }).status).toBe("approved");
  });

  it("POST returns 404 for unknown task", async () => {
    const { status } = await request("POST", "/api/tasks/nope/reviews", { reviewer_name: "a" });
    expect(status).toBe(404);
  });

  it("PATCH returns 404 for unknown review", async () => {
    const { status } = await request("PATCH", "/api/reviews/nope", { status: "approved" });
    expect(status).toBe(404);
  });
});
