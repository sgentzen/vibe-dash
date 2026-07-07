import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import {
  createProject,
  createTask,
  bulkUpdateTasks,
} from "../server/db/index.js";
import { createTestDb } from "./setup.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

// ─── 3.2 Bulk Update ────────────────────────────────────────────────────────

describe("3.2 Bulk Update", () => {
  it("updates multiple tasks at once", () => {
    const project = createProject(db, { name: "P", description: null });
    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "low" });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "low" });
    const t3 = createTask(db, { project_id: project.id, title: "T3", description: null, priority: "medium" });

    const updated = bulkUpdateTasks(db, [t1.id, t2.id], { priority: "high" });
    expect(updated).toHaveLength(2);
    expect(updated[0].priority).toBe("high");
    expect(updated[1].priority).toBe("high");

    // t3 should be unchanged
    const t3After = db.prepare("SELECT * FROM tasks WHERE id = ?").get(t3.id) as { priority: string };
    expect(t3After.priority).toBe("medium");
  });

  it("bulk updates status", () => {
    const project = createProject(db, { name: "P", description: null });
    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium" });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "medium" });

    const updated = bulkUpdateTasks(db, [t1.id, t2.id], { status: "in_progress" });
    expect(updated.every((t) => t.status === "in_progress")).toBe(true);
  });

  it("handles empty task ids", () => {
    const updated = bulkUpdateTasks(db, [], { priority: "high" });
    expect(updated).toHaveLength(0);
  });
});
