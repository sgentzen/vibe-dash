import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import { createServer, type IncomingMessage } from "http";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createRouter } from "../server/routes.js";
import { notFoundHandler, errorHandler, asyncHandler } from "../server/routes/middleware.js";
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

describe("notFoundHandler", () => {
  it("returns 404 JSON for unknown /api/ routes", async () => {
    app.use(notFoundHandler);
    const { status, body } = await request("GET", "/api/nonexistent");
    expect(status).toBe(404);
    expect(body).toEqual({ error: "Not found" });
  });

  it("passes through for non-API routes", async () => {
    app.use(notFoundHandler);
    // After notFoundHandler, non-API routes fall through to whatever is next.
    // Without a catch-all, Express returns its default 404 HTML.
    app.use((_req, res) => { res.json({ ok: true }); });
    const { status, body } = await request("GET", "/some-page");
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
  });
});

describe("errorHandler", () => {
  it("catches thrown errors and returns 500 JSON", async () => {
    app.get("/api/throw-test", () => { throw new Error("test boom"); });
    app.use(errorHandler);
    const { status, body } = await request("GET", "/api/throw-test");
    expect(status).toBe(500);
    expect(body).toEqual({ error: "Internal server error" });
  });

  it("uses error.status if set", async () => {
    app.get("/api/custom-error", () => {
      const err: any = new Error("bad request");
      err.status = 400;
      throw err;
    });
    app.use(errorHandler);
    const { status, body } = await request("GET", "/api/custom-error");
    expect(status).toBe(400);
    expect(body).toEqual({ error: "bad request" });
  });
});

describe("asyncHandler", () => {
  it("catches rejected promises and forwards to error middleware", async () => {
    app.get("/api/async-fail", asyncHandler(async () => {
      throw new Error("async boom");
    }));
    app.use(errorHandler);
    const { status, body } = await request("GET", "/api/async-fail");
    expect(status).toBe(500);
    expect(body).toEqual({ error: "Internal server error" });
  });

  it("allows successful async handlers to respond normally", async () => {
    app.get("/api/async-ok", asyncHandler(async (_req, res) => {
      res.json({ success: true });
    }));
    app.use(errorHandler);
    const { status, body } = await request("GET", "/api/async-ok");
    expect(status).toBe(200);
    expect(body).toEqual({ success: true });
  });
});
