import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import {
  createProject,
  createTask,
  registerAgent,
  addComment,
  listComments,
  createNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
  bulkUpdateTasks,
} from "../server/db/index.js";
import { createTestDb } from "./setup.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

// ─── 4.1 Task Comments ──────────────────────────────────────────────────────

describe("4.1 Task Comments", () => {
  it("adds and lists comments", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });

    addComment(db, task.id, "First comment", "Alice");
    addComment(db, task.id, "Second comment", "Bob");

    const comments = listComments(db, task.id);
    expect(comments).toHaveLength(2);
    expect(comments[0].author_name).toBe("Alice");
    expect(comments[1].message).toBe("Second comment");
  });

  it("supports agent comments", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });

    const comment = addComment(db, task.id, "Agent says hi", agent.name, agent.id);
    expect(comment.agent_id).toBe(agent.id);
    expect(comment.author_name).toBe("bot");
  });

  it("returns empty list for task with no comments", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });
    expect(listComments(db, task.id)).toHaveLength(0);
  });
});

// ─── 4.2 Notifications ──────────────────────────────────────────────────────

describe("4.2 Notifications", () => {
  it("creates and lists notifications", () => {
    createNotification(db, "Task blocked!");
    createNotification(db, "Task completed!");

    const notifs = listNotifications(db);
    expect(notifs).toHaveLength(2);
    expect(notifs[0].read).toBeFalsy();
  });

  it("marks notification as read", () => {
    const n = createNotification(db, "Test");
    expect(getUnreadNotificationCount(db)).toBe(1);

    markNotificationRead(db, n.id);
    expect(getUnreadNotificationCount(db)).toBe(0);
  });

  it("marks all notifications read", () => {
    createNotification(db, "A");
    createNotification(db, "B");
    createNotification(db, "C");
    expect(getUnreadNotificationCount(db)).toBe(3);

    markAllNotificationsRead(db);
    expect(getUnreadNotificationCount(db)).toBe(0);
  });

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
