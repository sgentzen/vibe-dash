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
  createTask,
  logActivity,
  completeTask,
  getTimeSpent,
} from "../server/db/index.js";

let db: Database.Database;
let app: Express;
beforeEach(() => {
  db = createTestDb();
  app = express();
  app.use(express.json());
  app.use(createRouter(db));
  app.use(errorHandler);
});

/**
 * A done task carrying one activity entry. Both timestamps are overwritten
 * afterwards, because the unreadable values these tests pin behaviour on cannot
 * be produced through the public API — they have to be written as the
 * corruption would leave them.
 */
function doneTask(): string {
  const project = createProject(db, { name: "P", description: null });
  const task = createTask(db, {
    project_id: project.id,
    title: "T",
    description: null,
    priority: "medium",
  });
  logActivity(db, { task_id: task.id, agent_id: null, message: "started" });
  completeTask(db, task.id);
  return task.id;
}

/** Overwrite every activity timestamp for the task, so `MIN(timestamp)` is `ts`. */
function setFirstActivity(taskId: string, ts: string): void {
  db.prepare("UPDATE activity_log SET timestamp = ? WHERE task_id = ?").run(ts, taskId);
}

function setUpdatedAt(taskId: string, ts: string): void {
  db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(ts, taskId);
}

/**
 * `new Date('not-a-date').getTime()` is NaN, and every arithmetic step that
 * follows preserves it: `NaN - x`, `Math.round(NaN)` and `Math.max(0, NaN)` are
 * all NaN. So getTimeSpent returned NaN, a value outside its own
 * `number | null` return type. The route did not make that visible, because
 * `JSON.stringify(NaN)` is `null` — on the wire an unreadable timestamp looked
 * exactly like a task with no activity or one that is not finished, while any
 * in-process caller doing arithmetic on the result got NaN.
 *
 * The declared contract already has a value for "no span to report", so an
 * unreadable timestamp returns that same null rather than NaN.
 */
describe("getTimeSpent with unreadable timestamps", () => {
  it("returns null when the first activity timestamp cannot be read", () => {
    const id = doneTask();
    setFirstActivity(id, "not-a-date");

    expect(getTimeSpent(db, id)).toBeNull();
  });

  it("returns null when the task's updated_at cannot be read", () => {
    const id = doneTask();
    setUpdatedAt(id, "not-a-date");

    expect(getTimeSpent(db, id)).toBeNull();
  });

  // The pre-existing `!first?.ts` guard covered a blank activity timestamp by
  // luck of it being falsy. Nothing covered a blank updated_at, which parses to
  // NaN exactly like a garbage one.
  it("returns null when the task's updated_at is blank", () => {
    const id = doneTask();
    setUpdatedAt(id, "");

    expect(getTimeSpent(db, id)).toBeNull();
  });

  it("returns null when the task's updated_at is whitespace", () => {
    const id = doneTask();
    setUpdatedAt(id, " ");

    expect(getTimeSpent(db, id)).toBeNull();
  });

  it("returns null when both timestamps are unreadable", () => {
    const id = doneTask();
    setFirstActivity(id, "not-a-date");
    setUpdatedAt(id, "garbage");

    expect(getTimeSpent(db, id)).toBeNull();
  });

  it("never returns NaN in place of a number", () => {
    const id = doneTask();
    setFirstActivity(id, "not-a-date");

    const result = getTimeSpent(db, id);
    expect(Number.isNaN(result)).toBe(false);
  });
});

describe("getTimeSpent with readable timestamps", () => {
  it("measures the span between the first activity and completion", () => {
    const id = doneTask();
    const completedAt = new Date();
    setFirstActivity(id, new Date(completedAt.getTime() - 3600 * 1000).toISOString());
    setUpdatedAt(id, completedAt.toISOString());

    expect(getTimeSpent(db, id)).toBe(3600);
  });

  it("clamps a completion that precedes the first activity to zero", () => {
    const id = doneTask();
    const completedAt = new Date();
    setFirstActivity(id, new Date(completedAt.getTime() + 3600 * 1000).toISOString());
    setUpdatedAt(id, completedAt.toISOString());

    expect(getTimeSpent(db, id)).toBe(0);
  });

  it("returns null for a task that has no activity", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, {
      project_id: project.id,
      title: "T",
      description: null,
      priority: "medium",
    });
    completeTask(db, task.id);

    expect(getTimeSpent(db, task.id)).toBeNull();
  });

  // There is deliberately no case for a SQL NULL in activity_log.timestamp:
  // the column is declared NOT NULL, so the only way `MIN(timestamp)` yields
  // NULL is the no-rows case above. A test for it fails on the constraint, not
  // on the guard.
  it("returns null for a task id that does not exist", () => {
    expect(getTimeSpent(db, "no-such-task")).toBeNull();
  });
});

/**
 * The guard closes the unparseable subset of bad timestamps, not the whole
 * class. `new Date()` is lenient: `'0'` is a valid date literal that parses to
 * 2000-01-01 and `'2026'` to that year's 1 January, both finite and both
 * indistinguishable from a date someone meant to store. Nothing can tell a
 * wrong-but-readable value from a right one, so these tests pin the boundary
 * rather than claim it away — and they show the shape the survivor takes, which
 * is a clean-looking number rather than an obvious absence.
 */
describe("getTimeSpent with a leniently parsed timestamp", () => {
  it("still measures a span from a readable but nonsensical updated_at", () => {
    const id = doneTask();
    setFirstActivity(id, new Date().toISOString());
    setUpdatedAt(id, "0");

    // 2000-01-01 precedes the activity, so Math.max clamps the negative span
    // and the task reads as finishing instantly. Wrong, but not unreadable.
    expect(getTimeSpent(db, id)).toBe(0);
  });
});

describe("getTimeSpent over HTTP", () => {
  /**
   * This pins the route's shape and status, not the guard. Reverting the guard
   * would not fail it: `res.json` runs the NaN through `JSON.stringify`, which
   * renders it `null`, so the body reads the same either way. That coincidence
   * is precisely why the bug was invisible here, and why the guard itself is
   * pinned at the unit level above. What this test does catch is the route
   * throwing, 404-ing, or changing the field name or status on a corrupt row.
   */
  it("serves null for a task whose updated_at cannot be read", async () => {
    const id = doneTask();
    setUpdatedAt(id, "not-a-date");

    const res = await requestApp(app, "GET", `/api/tasks/${id}/time-spent`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ time_spent_seconds: null });
  });

  it("serves the measured span for a readable task", async () => {
    const id = doneTask();
    const completedAt = new Date();
    setFirstActivity(id, new Date(completedAt.getTime() - 120 * 1000).toISOString());
    setUpdatedAt(id, completedAt.toISOString());

    const res = await requestApp(app, "GET", `/api/tasks/${id}/time-spent`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ time_spent_seconds: 120 });
  });
});
