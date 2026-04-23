import { describe, it, expect, beforeEach } from "vitest";
import express, { type Express } from "express";
import { createServer, type IncomingMessage } from "http";
import http from "http";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createRouter } from "../server/routes.js";

let app: Express;
let db: Database.Database;

function request(method: string, path: string): Promise<{ status: number; body: any; contentType: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      const req = http.request({ hostname: "127.0.0.1", port: addr.port, path, method }, (res: IncomingMessage) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk; });
        res.on("end", () => {
          server.close();
          const contentType = (res.headers["content-type"] as string) ?? "";
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data), contentType }); }
          catch { resolve({ status: res.statusCode ?? 0, body: data, contentType }); }
        });
      });
      req.on("error", (err: Error) => { server.close(); reject(err); });
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

describe("OpenAPI docs", () => {
  it("serves a valid OpenAPI 3.1 spec at /api/openapi.json", async () => {
    const { status, body } = await request("GET", "/api/openapi.json");
    expect(status).toBe(200);
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toBe("Vibe Dash API");
    expect(body.paths["/api/projects"]).toBeDefined();
    expect(body.paths["/api/tasks"]).toBeDefined();
    expect(body.paths["/api/integrations/pagerduty"]).toBeDefined();
    expect(body.components.schemas.Task).toBeDefined();
    expect(body.components.schemas.CreateTask.required).toContain("title");
  });

  it("serves Swagger UI HTML at /api/docs", async () => {
    const { status, body, contentType } = await request("GET", "/api/docs");
    expect(status).toBe(200);
    expect(contentType).toMatch(/text\/html/);
    expect(body).toContain("swagger-ui");
    expect(body).toContain("/api/openapi.json");
  });
});
