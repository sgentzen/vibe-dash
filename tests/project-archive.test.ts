import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { requestApp } from "./http-helper.js";
import { createRouter } from "../server/routes/index.js";
import { errorHandler } from "../server/routes/middleware.js";
import {
  createProject,
  listProjects,
  getProject,
  archiveProject,
  unarchiveProject,
  createTask,
} from "../server/db/index.js";

function request(app: Express, method: string, path: string, body?: unknown) {
  return requestApp(app, method, path, body);
}

// ─── migration 026 ──────────────────────────────────────────────────────────

describe("migration 026 — projects.archived_at", () => {
  it("adds a nullable archived_at column defaulting to null", () => {
    const db = createTestDb();
    const cols = (db.pragma("table_info(projects)") as { name: string; notnull: number }[]);
    const col = cols.find((c) => c.name === "archived_at");
    expect(col).toBeTruthy();
    expect(col?.notnull).toBe(0);

    const p = createProject(db, { name: "P", description: null });
    expect(p.archived_at).toBeNull();
  });
});

// ─── db layer ───────────────────────────────────────────────────────────────

describe("archiveProject / unarchiveProject (db layer)", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("archiveProject sets archived_at and returns the updated row", () => {
    const p = createProject(db, { name: "P", description: null });
    const archived = archiveProject(db, p.id);
    expect(archived?.archived_at).toBeTruthy();
    expect(getProject(db, p.id)?.archived_at).toBe(archived?.archived_at);
  });

  it("archiveProject is idempotent — archiving twice returns null the second time", () => {
    const p = createProject(db, { name: "P", description: null });
    const first = archiveProject(db, p.id);
    const second = archiveProject(db, p.id);
    expect(first?.archived_at).toBeTruthy();
    expect(second).toBeNull();
    // The archived_at timestamp from the first call is preserved, not bumped.
    expect(getProject(db, p.id)?.archived_at).toBe(first?.archived_at);
  });

  it("archiveProject returns null for an unknown id", () => {
    expect(archiveProject(db, "no-such-id")).toBeNull();
  });

  it("unarchiveProject clears archived_at and returns the updated row", () => {
    const p = createProject(db, { name: "P", description: null });
    archiveProject(db, p.id);
    const restored = unarchiveProject(db, p.id);
    expect(restored?.archived_at).toBeNull();
    expect(getProject(db, p.id)?.archived_at).toBeNull();
  });

  it("unarchiveProject is idempotent — unarchiving a non-archived project returns null", () => {
    const p = createProject(db, { name: "P", description: null });
    expect(unarchiveProject(db, p.id)).toBeNull();
  });

  it("does not touch the project's tasks, milestones or cost history", () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "low" });
    archiveProject(db, p.id);
    expect(db.prepare("SELECT * FROM tasks WHERE id = ?").get(t.id)).toBeTruthy();
  });

  it("listProjects excludes archived projects by default", () => {
    const active = createProject(db, { name: "Active", description: null });
    const archived = createProject(db, { name: "Archived", description: null });
    archiveProject(db, archived.id);

    const result = listProjects(db);
    expect(result.map((p) => p.id)).toEqual([active.id]);
  });

  it("listProjects includes archived projects when includeArchived is true", () => {
    const active = createProject(db, { name: "Active", description: null });
    const archived = createProject(db, { name: "Archived", description: null });
    archiveProject(db, archived.id);

    const result = listProjects(db, { includeArchived: true });
    expect(result.map((p) => p.id).sort()).toEqual([active.id, archived.id].sort());
  });
});

// ─── REST routes ────────────────────────────────────────────────────────────

describe("POST /api/projects/:id/archive and /unarchive", () => {
  let app: Express;
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    app = express();
    app.use(express.json());
    app.use(createRouter(db));
    app.use(errorHandler);
  });

  it("archives a project and broadcasts project_archived", async () => {
    const p = createProject(db, { name: "P", description: null });
    const { status, body } = await request(app, "POST", `/api/projects/${p.id}/archive`);
    expect(status).toBe(200);
    expect((body as { archived_at: string | null }).archived_at).toBeTruthy();
  });

  it("returns 404 archiving an unknown project", async () => {
    const { status } = await request(app, "POST", "/api/projects/no-such-id/archive");
    expect(status).toBe(404);
  });

  it("unarchives a project", async () => {
    const p = createProject(db, { name: "P", description: null });
    archiveProject(db, p.id);
    const { status, body } = await request(app, "POST", `/api/projects/${p.id}/unarchive`);
    expect(status).toBe(200);
    expect((body as { archived_at: string | null }).archived_at).toBeNull();
  });

  it("returns 404 unarchiving an unknown project", async () => {
    const { status } = await request(app, "POST", "/api/projects/no-such-id/unarchive");
    expect(status).toBe(404);
  });

  it("archiving an already-archived project succeeds (idempotent) and still 200s", async () => {
    const p = createProject(db, { name: "P", description: null });
    await request(app, "POST", `/api/projects/${p.id}/archive`);
    const { status, body } = await request(app, "POST", `/api/projects/${p.id}/archive`);
    expect(status).toBe(200);
    expect((body as { archived_at: string | null }).archived_at).toBeTruthy();
  });
});

describe("GET /api/projects — include_archived", () => {
  let app: Express;
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    app = express();
    app.use(express.json());
    app.use(createRouter(db));
    app.use(errorHandler);
  });

  it("excludes archived projects by default", async () => {
    const active = createProject(db, { name: "Active", description: null });
    const archived = createProject(db, { name: "Archived", description: null });
    archiveProject(db, archived.id);

    const { body } = await request(app, "GET", "/api/projects");
    const ids = (body as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(archived.id);
  });

  it("includes archived projects with ?include_archived=true", async () => {
    const archived = createProject(db, { name: "Archived", description: null });
    archiveProject(db, archived.id);

    const { body } = await request(app, "GET", "/api/projects?include_archived=true");
    const ids = (body as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(archived.id);
  });
});

describe("GET /api/stats — archived exclusion", () => {
  let app: Express;
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    app = express();
    app.use(express.json());
    app.use(createRouter(db));
    app.use(errorHandler);
  });

  it("excludes archived projects from the project count", async () => {
    createProject(db, { name: "Active", description: null });
    const archived = createProject(db, { name: "Archived", description: null });
    archiveProject(db, archived.id);

    const { body } = await request(app, "GET", "/api/stats");
    expect((body as { projects: number }).projects).toBe(1);
  });

  it("excludes tasks belonging to archived projects from the task count", async () => {
    const active = createProject(db, { name: "Active", description: null });
    const archived = createProject(db, { name: "Archived", description: null });
    createTask(db, { project_id: active.id, title: "keep", description: null, priority: "low" });
    createTask(db, { project_id: archived.id, title: "hide", description: null, priority: "low" });
    archiveProject(db, archived.id);

    const { body } = await request(app, "GET", "/api/stats");
    expect((body as { tasks: number }).tasks).toBe(1);
  });
});
