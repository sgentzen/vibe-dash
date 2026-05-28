import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { initDb, createProject, listProjects, createTask, listTasks } from "../server/db/index.js";
import { resolveDbPath } from "../server/db/path.js";
import { createTestDb } from "./setup.js";

describe("DB persistence across restarts", () => {
  let dbDir: string;
  let dbPath: string;

  beforeEach(() => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-dash-test-"));
    dbPath = path.join(dbDir, "vibe-dash.db");
  });

  afterEach(() => {
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  it("preserves rows when the DB is closed and reopened (no destructive migrations)", () => {
    // First "session": create data.
    const db1 = new Database(dbPath);
    initDb(db1);
    const project = createProject(db1, { name: "persistent-project", description: "should survive restart" });
    createTask(db1, {
      project_id: project.id,
      title: "persistent-task",
      description: null,
      priority: "medium",
      milestone_id: null,
    });
    db1.close();

    // Second "session": reopen, run init/migrations again, verify data is intact.
    const db2 = new Database(dbPath);
    initDb(db2);
    const projects = listProjects(db2);
    const tasks = listTasks(db2);
    expect(projects.find((p) => p.name === "persistent-project")).toBeDefined();
    expect(tasks.find((t) => t.title === "persistent-task")).toBeDefined();
    db2.close();
  });

  it("opens the same DB across worktree-style cwd changes", () => {
    const db1 = new Database(dbPath);
    initDb(db1);
    createProject(db1, { name: "cwd-project", description: null });
    db1.close();

    // Simulate CLI being invoked from a different cwd: pass an explicit override.
    const resolved = resolveDbPath(dbPath);
    expect(path.resolve(resolved)).toBe(path.resolve(dbPath));

    const db2 = new Database(resolved);
    initDb(db2);
    expect(listProjects(db2).some((p) => p.name === "cwd-project")).toBe(true);
    db2.close();
  });
});

describe("resolveDbPath", () => {
  it("prefers explicit override over env vars", () => {
    const prevEnv = process.env.VIBE_DASH_DB;
    const envPath = path.join(os.tmpdir(), "from-env.db");
    const explicitPath = path.join(os.tmpdir(), "explicit.db");
    process.env.VIBE_DASH_DB = envPath;
    try {
      expect(resolveDbPath(explicitPath)).toBe(path.resolve(explicitPath));
    } finally {
      if (prevEnv === undefined) delete process.env.VIBE_DASH_DB;
      else process.env.VIBE_DASH_DB = prevEnv;
    }
  });

  it("returns an absolute path", () => {
    expect(path.isAbsolute(resolveDbPath())).toBe(true);
  });

  it("uses VIBE_DASH_DB when set and no override", () => {
    const prevEnv = process.env.VIBE_DASH_DB;
    process.env.VIBE_DASH_DB = path.join(os.tmpdir(), "env-db.sqlite");
    try {
      expect(resolveDbPath()).toBe(path.resolve(path.join(os.tmpdir(), "env-db.sqlite")));
    } finally {
      if (prevEnv === undefined) delete process.env.VIBE_DASH_DB;
      else process.env.VIBE_DASH_DB = prevEnv;
    }
  });
});

describe("migration 014 — commits + milestone_history (create-then-drop)", () => {
  it("migration sequence runs cleanly (014 creates, 015 drops)", () => {
    // 014 creates commits + milestone_history; 015 immediately drops them.
    // A fresh DB running all migrations should NOT have these tables.
    const db = createTestDb();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).not.toContain("commits");
    expect(tables).not.toContain("milestone_history");
  });
});

describe("migration 015 — orphan schema dropped", () => {
  it("drops all orphan tables", () => {
    const db = createTestDb();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    for (const orphan of [
      "task_reviews", "webhooks", "commits", "milestone_history",
      "git_linked_items", "git_integrations", "ingestion_events",
      "ingestion_sources", "users",
    ]) {
      expect(tables).not.toContain(orphan);
    }
  });

  it("drops the recurrence_rule column from tasks", () => {
    const db = createTestDb();
    const cols = (db.pragma("table_info(tasks)") as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain("recurrence_rule");
  });

  it("keeps the core tables intact", () => {
    const db = createTestDb();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    for (const kept of ["projects", "milestones", "tasks", "agents", "blockers"]) {
      expect(tables).toContain(kept);
    }
  });
});
