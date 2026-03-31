import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  initDb,
  createProject,
  createTask,
  registerAgent,
  completeTask,
  updateTask,
  addComment,
  listComments,
  reportWorkingOn,
  releaseFileLocks,
  getActiveFileLocks,
  getFileConflicts,
  createAlertRule,
  listAlertRules,
  toggleAlertRule,
  deleteAlertRule,
  createNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
  evaluateAlertRules,
  bulkUpdateTasks,
} from "../server/db";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initDb(db);
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

// ─── 1.4 Agent Conflict Detection ───────────────────────────────────────────

describe("1.4 Agent Conflict Detection", () => {
  it("reports working on files and creates locks", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });

    const locks = reportWorkingOn(db, agent.id, task.id, ["src/a.ts", "src/b.ts"]);
    expect(locks).toHaveLength(2);
    expect(locks[0].file_path).toBe("src/a.ts");
  });

  it("detects conflicts when two agents work on same file", () => {
    const project = createProject(db, { name: "P", description: null });
    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium" });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "medium" });
    const a1 = registerAgent(db, { name: "agent-1", model: null, capabilities: [] });
    const a2 = registerAgent(db, { name: "agent-2", model: null, capabilities: [] });

    reportWorkingOn(db, a1.id, t1.id, ["src/shared.ts"]);
    reportWorkingOn(db, a2.id, t2.id, ["src/shared.ts"]);

    const conflicts = getFileConflicts(db);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].file_path).toBe("src/shared.ts");
    expect(conflicts[0].agents).toHaveLength(2);
  });

  it("no conflicts when agents work on different files", () => {
    const project = createProject(db, { name: "P", description: null });
    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium" });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "medium" });
    const a1 = registerAgent(db, { name: "agent-1", model: null, capabilities: [] });
    const a2 = registerAgent(db, { name: "agent-2", model: null, capabilities: [] });

    reportWorkingOn(db, a1.id, t1.id, ["src/a.ts"]);
    reportWorkingOn(db, a2.id, t2.id, ["src/b.ts"]);

    expect(getFileConflicts(db)).toHaveLength(0);
  });

  it("releases file locks", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });

    reportWorkingOn(db, agent.id, task.id, ["src/a.ts", "src/b.ts"]);
    expect(getActiveFileLocks(db)).toHaveLength(2);

    releaseFileLocks(db, agent.id, task.id);
    expect(getActiveFileLocks(db)).toHaveLength(0);
  });

  it("releases all locks for an agent", () => {
    const project = createProject(db, { name: "P", description: null });
    const t1 = createTask(db, { project_id: project.id, title: "T1", description: null, priority: "medium" });
    const t2 = createTask(db, { project_id: project.id, title: "T2", description: null, priority: "medium" });
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });

    reportWorkingOn(db, agent.id, t1.id, ["src/a.ts"]);
    reportWorkingOn(db, agent.id, t2.id, ["src/b.ts"]);
    expect(getActiveFileLocks(db)).toHaveLength(2);

    releaseFileLocks(db, agent.id);
    expect(getActiveFileLocks(db)).toHaveLength(0);
  });
});

// ─── 4.2 Notifications & Alerts ─────────────────────────────────────────────

describe("4.2 Notifications & Alerts", () => {
  it("creates and lists alert rules", () => {
    const rule = createAlertRule(db, "task_blocked", JSON.stringify({ priority: "high" }));
    expect(rule.event_type).toBe("task_blocked");
    expect(rule.enabled).toBeTruthy();

    const rules = listAlertRules(db);
    expect(rules).toHaveLength(1);
  });

  it("toggles alert rule", () => {
    const rule = createAlertRule(db, "task_completed");
    const toggled = toggleAlertRule(db, rule.id, false);
    expect(toggled!.enabled).toBeFalsy();
  });

  it("deletes alert rule", () => {
    const rule = createAlertRule(db, "blocker_reported");
    expect(deleteAlertRule(db, rule.id)).toBe(true);
    expect(listAlertRules(db)).toHaveLength(0);
  });

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

  it("evaluates alert rules and creates notifications", () => {
    createAlertRule(db, "task_blocked", JSON.stringify({ priority: "high" }));
    createAlertRule(db, "task_blocked", JSON.stringify({ priority: "low" }));

    const notifs = evaluateAlertRules(db, "task_blocked", { priority: "high" });
    expect(notifs).toHaveLength(1);
    expect(listNotifications(db)).toHaveLength(1);
  });

  it("skips disabled rules", () => {
    const rule = createAlertRule(db, "task_completed");
    toggleAlertRule(db, rule.id, false);

    const notifs = evaluateAlertRules(db, "task_completed", {});
    expect(notifs).toHaveLength(0);
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
    const t3After = db.prepare("SELECT * FROM tasks WHERE id = ?").get(t3.id) as any;
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
