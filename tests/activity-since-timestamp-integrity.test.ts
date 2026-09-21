import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import express from "express";
import { runMigrations } from "../server/db/migrator.js";
import { requestApp } from "./http-helper.js";
import { createRouter } from "../server/routes/index.js";
import { errorHandler } from "../server/routes/middleware.js";
import { getActivityStream, createProject, createTask, logActivity } from "../server/db/index.js";

let db: Database.Database;
let taskId: string;

beforeEach(() => {
  db = createTestDb();
  const project = createProject(db, { name: "P", description: null });
  taskId = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" }).id;
});

const SINCE = "2026-09-18T00:00:00.000Z";

/** An activity row written with `timestamp` exactly as given. */
function addActivity(message: string, timestamp: string): void {
  const row = logActivity(db, { task_id: taskId, agent_id: null, message });
  db.prepare("UPDATE activity_log SET timestamp = ? WHERE id = ?").run(timestamp, row.id);
}

function messages(since: string): string[] {
  return getActivityStream(db, { since }).map((e) => e.message).sort();
}

/**
 * The `since` filter compared raw ISO strings, which is string order, not date
 * order: 'not-a-date' >= '2026-09-18T...' is true because 'n' outranks '2', so
 * an activity row with an unreadable timestamp passed every `since` filter. It
 * now compares parsed dates through julianDaySql(), so such a row fails the
 * comparison and drops out of any `since` query. That is a deliberate change to
 * what a `since` query returns for a corrupt row.
 */
describe("getActivityStream since filter with an unreadable timestamp", () => {
  it("keeps a row at or after since", () => {
    addActivity("later", "2026-09-19T12:00:00.000Z");

    expect(messages(SINCE)).toEqual(["later"]);
  });

  it("drops a row before since", () => {
    addActivity("earlier", "2026-09-17T12:00:00.000Z");

    expect(messages(SINCE)).toEqual([]);
  });

  it.each([
    ["is not a date", "not-a-date"],
    ["is blank", ""],
    // Read off the clock by julianday() if it reached it, i.e. "this instant".
    ["reads the clock rather than a date", "now"],
  ])("drops a row whose timestamp %s", (_label, corrupt) => {
    addActivity("real", "2026-09-19T12:00:00.000Z");
    addActivity("corrupt", corrupt);

    expect(messages(SINCE)).toEqual(["real"]);
  });

  it("includes a row sitting exactly on since", () => {
    addActivity("boundary", SINCE);

    expect(messages(SINCE)).toEqual(["boundary"]);
  });

  it("still returns an unreadable row when no since filter is given", () => {
    // Without a window nothing is being asked about when, so the row is listed.
    addActivity("corrupt", "not-a-date");

    expect(getActivityStream(db).map((e) => e.message)).toEqual(["corrupt"]);
  });

  it("places a readable non-ISO timestamp by date rather than by text", () => {
    // 'YYYY-MM-DD HH:MM:SS' sorts below the ISO cutoff as text (' ' < 'T')
    // although it is later in time.
    addActivity("spaced", "2026-09-18 12:00:00");

    expect(messages(SINCE)).toEqual(["spaced"]);
  });
});

describe("getActivityStream with a since that cannot be read", () => {
  it("matches nothing rather than everything", () => {
    addActivity("real", "2026-09-19T12:00:00.000Z");

    expect(messages("garbage")).toEqual([]);
  });

  it("treats a blank since as no filter", () => {
    addActivity("real", "2026-09-19T12:00:00.000Z");
    addActivity("corrupt", "not-a-date");

    expect(getActivityStream(db, { since: "" }).map((e) => e.message).sort()).toEqual(["corrupt", "real"]);
  });

  it("composes with agent, project and limit without a corrupt row using up the limit", () => {
    addActivity("newest", "2026-09-20T12:00:00.000Z");
    addActivity("corrupt", "zzz");
    addActivity("older", "2026-09-19T12:00:00.000Z");

    const rows = getActivityStream(db, { since: SINCE, limit: 2 });

    expect(rows.map((e) => e.message)).toEqual(["newest", "older"]);
  });
});

describe("GET /api/activity-stream since", () => {
  it("leaves out a corrupt row and answers 200 for an unreadable since", async () => {
    addActivity("real", "2026-09-19T12:00:00.000Z");
    addActivity("corrupt", "not-a-date");
    const app = express();
    app.use(express.json());
    app.use(createRouter(db));
    app.use(errorHandler);

    const ok = await requestApp(app, "GET", `/api/activity-stream?since=${SINCE}`);
    const junk = await requestApp(app, "GET", "/api/activity-stream?since=garbage");

    expect((ok.body as { message: string }[]).map((e) => e.message)).toEqual(["real"]);
    expect(junk.status).toBe(200);
    expect(junk.body).toEqual([]);
  });
});

/**
 * The since predicate compares julianday(timestamp), which idx_activity_log_timestamp
 * (over the raw column) cannot serve: without migration 025 a since that matches
 * few rows walked all of activity_log on an unauthenticated route.
 */
describe("the since window stays sargable", () => {
  it("creates the expression index", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get("idx_activity_log_timestamp_jd");

    expect(row).not.toBeUndefined();
  });

  it("resolves the real query through the expression index", () => {
    const captured: string[] = [];
    const real = db.prepare.bind(db);
    (db as unknown as { prepare: unknown }).prepare = (sql: string) => {
      captured.push(sql);
      return real(sql);
    };
    try {
      getActivityStream(db, { since: SINCE });
    } finally {
      delete (db as unknown as { prepare?: unknown }).prepare;
    }
    const sql = captured.find((q) => q.includes("activity_log"))!;
    const holes = (sql.match(/\?/g) ?? []).length;
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array.from({ length: holes }, () => SINCE)) as { detail: string }[])
      .map((r) => r.detail)
      .join(" | ");

    expect(plan).toContain("idx_activity_log_timestamp_jd");
  });

  it("builds the index on a database that already holds a clock-reading timestamp", () => {
    db.prepare("DROP INDEX idx_activity_log_timestamp_jd").run();
    db.prepare("DELETE FROM _migrations WHERE name = ?").run("025_activity_log_timestamp_julianday_index");
    addActivity("clock", "subsec");

    expect(() => runMigrations(db)).not.toThrow();
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get("idx_activity_log_timestamp_jd")
    ).not.toBeUndefined();
  });
});
