import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import type { Express } from "express";
import type Database from "better-sqlite3";
import helmet from "helmet";
import { createTestDb } from "./setup.js";
import { requestApp } from "./http-helper.js";
import { createRouter } from "../server/routes/index.js";
import { errorHandler, notFoundHandler } from "../server/routes/middleware.js";
import { buildAllowedNetwork, hostValidationMiddleware, crossSiteMutationGuard } from "../server/security/origin.js";
import { createProject } from "../server/db/projects.js";
import { createTask } from "../server/db/tasks.js";
import type { Task } from "../server/types.js";

// Mirrors the middleware ORDER in server/index.ts (SEC-2, SEC-5, SEC-7): helmet
// first so its headers land on every response including a rejection, then the
// Host check, then the cross-site mutation guard, both ahead of the routers —
// exactly what makes them cover /api uniformly instead of per-route. It does
// NOT mirror server/index.ts's allow-list CONSTRUCTION — buildAllowedNetwork
// is called here with no extraHosts/includeDevPort, deliberately, to keep
// these tests independent of NODE_ENV/VIBE_DASH_ALLOWED_HOSTS. The dev-port
// widening option itself is covered directly in security-origin.test.ts.
const PORT = 3001;
let app: Express;
let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  const network = buildAllowedNetwork(PORT);
  app = express();
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
  }));
  app.use(hostValidationMiddleware(network));
  app.use(crossSiteMutationGuard(network));
  app.use(express.json());
  app.use(createRouter(db));
  app.use(notFoundHandler);
  app.use(errorHandler);
});

function request(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  return requestApp(app, method, path, body, headers);
}

/**
 * A fresh, unrelated task per call — used as the body-less mutation route
 * from SEC-5 (`POST /api/tasks/:id/complete`) without touching the
 * filesystem the way `/api/ingest/scan` would (this repo keeps that route
 * untested precisely to avoid reading the real `VIBE_DASH_CLAUDE_HOME`).
 */
function newTaskCompletePath(): string {
  return `/api/tasks/${newFixtureTaskId()}/complete`;
}

/** A fresh, unrelated task id — the shared fixture behind every mutation-route test in this file. */
function newFixtureTaskId(): string {
  const project = createProject(db, { name: "boundary-test", description: null });
  const task: Task = createTask(db, { project_id: project.id, title: "t", priority: "medium" });
  return task.id;
}

describe("hostValidationMiddleware (SEC-2)", () => {
  it("rejects a foreign Host header with 421 and { error } JSON", async () => {
    const { status, body } = await request("GET", "/api/projects", undefined, { Host: "evil.example.com" });
    expect(status).toBe(421);
    expect(body).toMatchObject({ error: expect.stringContaining("Invalid Host") });
  });

  it("passes an allowed Host through to the route", async () => {
    const { status, body } = await request("GET", "/api/projects", undefined, { Host: "localhost:3001" });
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it("rejects a missing Host header", async () => {
    // Node's http.request always sets Host, so simulate absence via an empty value.
    const { status } = await request("GET", "/api/projects", undefined, { Host: "" });
    expect(status).toBe(421);
  });
});

describe("crossSiteMutationGuard (SEC-5)", () => {
  it("rejects a cross-site POST via Sec-Fetch-Site with 403 and { error } JSON", async () => {
    const { status, body } = await request("POST", newTaskCompletePath(), undefined, {
      Host: "localhost:3001",
      "Sec-Fetch-Site": "cross-site",
    });
    expect(status).toBe(403);
    expect(body).toMatchObject({ error: expect.stringContaining("Cross-site") });
  });

  it("rejects a POST carrying a foreign Origin", async () => {
    const { status, body } = await request("POST", newTaskCompletePath(), undefined, {
      Host: "localhost:3001",
      Origin: "http://attacker.example",
    });
    expect(status).toBe(403);
    expect(body).toMatchObject({ error: expect.stringContaining("Invalid Origin") });
  });

  it("allows a same-origin POST", async () => {
    const { status } = await request("POST", newTaskCompletePath(), undefined, {
      Host: "localhost:3001",
      Origin: "http://localhost:3001",
    });
    expect(status).toBe(200);
  });

  it("allows a POST with no Origin at all (OTLP exporters, MCP HTTP clients)", async () => {
    const { status } = await request("POST", newTaskCompletePath(), undefined, { Host: "localhost:3001" });
    expect(status).toBe(200);
  });

  it("allows a same-site Sec-Fetch-Site POST", async () => {
    const { status } = await request("POST", newTaskCompletePath(), undefined, {
      Host: "localhost:3001",
      "Sec-Fetch-Site": "same-origin",
    });
    expect(status).toBe(200);
  });

  it("rejects a same-site request from a different port via the Origin fallback", async () => {
    // "same-site" is not "same-origin": localhost:4000 and localhost:3001 are
    // same-site (registrable domain matches) but different origins. A
    // same-machine process on another port is exactly the DNS-rebinding-
    // adjacent case this guard exists for, and Sec-Fetch-Site alone would
    // call it safe — the Origin allow-list is what actually rejects it.
    const { status } = await request("POST", newTaskCompletePath(), undefined, {
      Host: "localhost:3001",
      "Sec-Fetch-Site": "same-site",
      Origin: "http://localhost:4000",
    });
    expect(status).toBe(403);
  });

  it("never gates GET requests", async () => {
    const { status } = await request("GET", "/api/projects", undefined, {
      Host: "localhost:3001",
      "Sec-Fetch-Site": "cross-site",
    });
    expect(status).toBe(200);
  });

  // The guard's own logic is method-agnostic (it exempts GET/HEAD/OPTIONS and
  // gates everything else), but that's only worth trusting once it's pinned
  // against methods other than POST — SEC-5's own examples include a PATCH
  // (task update) and a DELETE (dependency removal), not just POSTs.
  it("rejects a cross-site PATCH", async () => {
    const { status } = await request("PATCH", `/api/tasks/${newFixtureTaskId()}`, {}, {
      Host: "localhost:3001",
      "Sec-Fetch-Site": "cross-site",
    });
    expect(status).toBe(403);
  });

  it("allows a same-origin PATCH", async () => {
    const { status } = await request("PATCH", `/api/tasks/${newFixtureTaskId()}`, {}, {
      Host: "localhost:3001",
      Origin: "http://localhost:3001",
    });
    expect(status).toBe(200);
  });

  it("rejects a cross-site DELETE", async () => {
    const { status } = await request("DELETE", "/api/dependencies/nonexistent", undefined, {
      Host: "localhost:3001",
      "Sec-Fetch-Site": "cross-site",
    });
    expect(status).toBe(403);
  });

  it("allows a same-origin DELETE", async () => {
    const { status, body } = await request("DELETE", "/api/dependencies/nonexistent", undefined, {
      Host: "localhost:3001",
      Origin: "http://localhost:3001",
    });
    expect(status).toBe(200);
    expect(body).toEqual({ success: false });
  });
});

describe("CSP connect-src (SEC-7)", () => {
  it("scopes connect-src to 'self' with no bare ws:/wss: entry", async () => {
    const { headers } = await request("GET", "/api/projects", undefined, { Host: "localhost:3001" });
    const csp = headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/connect-src[^;]*\bws:/);
    expect(csp).not.toMatch(/connect-src[^;]*\bwss:/);
  });
});
