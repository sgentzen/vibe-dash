import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { initDb, createProject, listProjects, createTask, listTasks, resolveDbPath } from "../server/db/index.js";

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
    process.env.VIBE_DASH_DB = "/tmp/from-env.db";
    try {
      expect(resolveDbPath("/tmp/explicit.db")).toBe(path.resolve("/tmp/explicit.db"));
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
