import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import express from "express";
import type { Express } from "express";
import { createTestDb } from "./setup.js";
import { createProject } from "../server/db/index.js";
import { ingestRoutes } from "../server/routes/ingest.js";
import { errorHandler } from "../server/routes/middleware.js";
import { requestApp } from "./http-helper.js";

let db: Database.Database;
let app: Express;

// Same shape as tests/routes.test.ts: requestApp mounts the app on a one-shot
// server per call and returns { status, body }.
function request(method: string, path: string, body?: unknown) {
  return requestApp(app, method, path, body);
}

beforeEach(() => {
  db = createTestDb();
  app = express();
  app.use(express.json());
  app.use(ingestRoutes(db, () => {}));
  // Mounted last, as server/index.ts does, so this app answers errors in the
  // shape production does. Nothing in this file reaches it today — the two
  // `{ error }` assertions below come from the route's own validation, not
  // from here — but a future test that throws, or that sends a raw payload,
  // gets `{ error }` rather than Express's default HTML page. See
  // tests/http-helper.test.ts, which pins both shapes.
  app.use(errorHandler);
});

describe("GET /api/ingest/status", () => {
  it("returns zeroed counts on a fresh database", async () => {
    const res = await request("GET", "/api/ingest/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      filesTracked: 0, transcriptRows: 0, unpriced: 0, unattributed: 0,
      otlpRows: 0, otlpUnmapped: 0, otlpUnattributed: 0,
    });
  });

  it("includes knownModels as a non-empty array of strings", async () => {
    const res = await request("GET", "/api/ingest/status");
    expect(res.status).toBe(200);
    const { knownModels } = res.body as { knownModels: string[] };
    expect(Array.isArray(knownModels)).toBe(true);
    expect(knownModels.length).toBeGreaterThan(0);
    expect(knownModels.every((m) => typeof m === "string")).toBe(true);
    expect(knownModels).toContain("claude-opus-5");
  });
});

describe("project path links", () => {
  it("links a directory to a project and lists it", async () => {
    const project = createProject(db, { name: "demo", description: null });

    const created = await request("POST", "/api/ingest/paths", {
      project_id: project.id,
      path: "C:/repos/demo",
    });
    expect(created.status).toBe(201);

    const listed = await request("GET", "/api/ingest/paths");
    const paths = (listed.body as { paths: { project_id: string }[] }).paths;
    expect(paths).toHaveLength(1);
    expect(paths[0].project_id).toBe(project.id);
  });

  it("rejects a link with no project_id", async () => {
    const res = await request("POST", "/api/ingest/paths", { path: "C:/repos/demo" });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toBeTruthy();
  });

  // A truthy non-string passed the old `!projectId || !rawPath` guard: an object
  // project_id reached the prepared statement as named parameters, and an object
  // path reached normalisePath's string methods. Both threw, both became 500s.
  it("rejects a non-string project_id with 400, not 500", async () => {
    const res = await request("POST", "/api/ingest/paths", {
      project_id: { a: 1 },
      path: "C:/repos/demo",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toBeTruthy();
  });

  it("rejects a non-string path with 400, not 500", async () => {
    const project = createProject(db, { name: "demo", description: null });
    const res = await request("POST", "/api/ingest/paths", {
      project_id: project.id,
      path: { a: 1 },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toBeTruthy();
  });

  it("rejects a link to a project that does not exist", async () => {
    const res = await request("POST", "/api/ingest/paths", {
      project_id: "no-such-project",
      path: "C:/repos/demo",
    });
    expect(res.status).toBe(404);
  });

  it("rejects linking the same path twice", async () => {
    const project = createProject(db, { name: "demo", description: null });
    const body = { project_id: project.id, path: "C:/repos/demo" };
    expect((await request("POST", "/api/ingest/paths", body)).status).toBe(201);
    expect((await request("POST", "/api/ingest/paths", body)).status).toBe(409);
  });

  it("rejects linking a filesystem root with 400, not 409", async () => {
    // 409 would tell the caller the path was already linked, which is a lie.
    const project = createProject(db, { name: "demo", description: null });
    const res = await request("POST", "/api/ingest/paths", { project_id: project.id, path: "/" });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toMatch(/whole filesystem or drive/);

    const listed = await request("GET", "/api/ingest/paths");
    expect((listed.body as { paths: unknown[] }).paths).toHaveLength(0);
  });

  it("deletes a link", async () => {
    const project = createProject(db, { name: "demo", description: null });
    const created = await request("POST", "/api/ingest/paths", {
      project_id: project.id,
      path: "C:/repos/demo",
    });
    const { id } = created.body as { id: string };

    const deleted = await request("DELETE", `/api/ingest/paths/${id}`);
    expect(deleted.status).toBe(204);

    const listed = await request("GET", "/api/ingest/paths");
    expect((listed.body as { paths: unknown[] }).paths).toHaveLength(0);
  });
});
