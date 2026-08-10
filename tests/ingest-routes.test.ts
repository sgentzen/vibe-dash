import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import express from "express";
import type { Express } from "express";
import { createTestDb } from "./setup.js";
import { createProject } from "../server/db/index.js";
import { ingestRoutes } from "../server/routes/ingest.js";
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
});

describe("GET /api/ingest/status", () => {
  it("returns zeroed counts on a fresh database", async () => {
    const res = await request("GET", "/api/ingest/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ filesTracked: 0, transcriptRows: 0, unpriced: 0, unattributed: 0 });
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
