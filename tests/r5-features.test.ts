import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  initDb,
  createProject,
  createTask,
  registerAgent,
  completeTask,
  updateTask,
  logActivity,
  addComment,
  extractMentions,
  listMentions,
  handleRecurringTaskCompletion,
  getTask,
  createTemplate,
  listTemplates,
  getTemplate,
  deleteTemplate,
  createProjectFromTemplate,
  getActivityStream,
} from "../server/db/index.js";
import { getNextDueDate } from "../server/recurrence";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initDb(db);
});

// ─── 2.6 Recurring Tasks ────────────────────────────────────────────────────

describe("2.6 Recurring Tasks", () => {
  it("creates task with recurrence_rule", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, {
      project_id: project.id, title: "Standup", description: null,
      priority: "medium", recurrence_rule: "daily", due_date: "2026-04-01",
    });
    expect(task.recurrence_rule).toBe("daily");
  });

  it("updates recurrence_rule", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });
    const updated = updateTask(db, task.id, { recurrence_rule: "weekly" });
    expect(updated!.recurrence_rule).toBe("weekly");
  });

  it("auto-creates next instance on completion", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, {
      project_id: project.id, title: "Weekly Review", description: "Do review",
      priority: "high", recurrence_rule: "weekly", due_date: "2026-04-01",
    });

    const nextTask = handleRecurringTaskCompletion(db, task.id);
    expect(nextTask).not.toBeNull();
    expect(nextTask!.title).toBe("Weekly Review");
    expect(nextTask!.recurrence_rule).toBe("weekly");
    expect(nextTask!.due_date).toBe("2026-04-08");
    expect(nextTask!.status).toBe("planned");
  });

  it("returns null for non-recurring task", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });
    expect(handleRecurringTaskCompletion(db, task.id)).toBeNull();
  });
});

describe("getNextDueDate", () => {
  it("computes daily", () => {
    expect(getNextDueDate("2026-04-01", "daily")).toBe("2026-04-02");
  });

  it("computes weekly", () => {
    expect(getNextDueDate("2026-04-01", "weekly")).toBe("2026-04-08");
  });

  it("computes monthly", () => {
    expect(getNextDueDate("2026-04-01", "monthly")).toBe("2026-05-01");
  });

  it("computes yearly", () => {
    expect(getNextDueDate("2026-04-01", "yearly")).toBe("2027-04-01");
  });

  it("computes every Nd", () => {
    expect(getNextDueDate("2026-04-01", "every 3d")).toBe("2026-04-04");
  });

  it("computes every Nw", () => {
    expect(getNextDueDate("2026-04-01", "every 2w")).toBe("2026-04-15");
  });

  it("defaults to daily for unknown rule", () => {
    expect(getNextDueDate("2026-04-01", "unknown_rule")).toBe("2026-04-02");
  });
});

// ─── 4.3 @Mentions ──────────────────────────────────────────────────────────

describe("4.3 @Mentions", () => {
  it("extracts @mentions from text", () => {
    const mentions = extractMentions("Hey @alice and @bob-agent, check this out");
    expect(mentions).toContain("alice");
    expect(mentions).toContain("bob-agent");
    expect(mentions).toHaveLength(2);
  });

  it("deduplicates mentions", () => {
    const mentions = extractMentions("@alice said @alice should review");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toBe("alice");
  });

  it("returns empty for no mentions", () => {
    expect(extractMentions("no mentions here")).toHaveLength(0);
  });

  it("lists mentions for an agent", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });

    addComment(db, task.id, "Hey @bot-1 check this", "User");
    addComment(db, task.id, "Also @bot-2 review please", "User");
    addComment(db, task.id, "No mentions here", "User");

    const mentions = listMentions(db, "bot-1");
    expect(mentions).toHaveLength(1);
    expect(mentions[0].message).toContain("@bot-1");
  });
});

// ─── 5.2 Project Templates ──────────────────────────────────────────────────

describe("5.2 Project Templates", () => {
  it("seeds built-in templates on init", () => {
    const templates = listTemplates(db);
    expect(templates.length).toBeGreaterThanOrEqual(4);
    expect(templates.some(t => t.name === "API Project")).toBe(true);
    expect(templates.some(t => t.name === "Bug Triage")).toBe(true);
  });

  it("creates and lists custom templates", () => {
    const t = createTemplate(db, "My Template", "Custom", JSON.stringify([{ title: "Task 1" }]));
    expect(t.name).toBe("My Template");

    const all = listTemplates(db);
    expect(all.some(x => x.name === "My Template")).toBe(true);
  });

  it("gets template by id", () => {
    const t = createTemplate(db, "Test", null, "[]");
    const found = getTemplate(db, t.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Test");
  });

  it("deletes template", () => {
    const t = createTemplate(db, "ToDelete", null, "[]");
    expect(deleteTemplate(db, t.id)).toBe(true);
    expect(getTemplate(db, t.id)).toBeNull();
  });

  it("creates project from template with tasks", () => {
    const t = createTemplate(db, "WithTasks", "Test", JSON.stringify([
      { title: "Parent Task", priority: "high", children: [
        { title: "Subtask A" },
        { title: "Subtask B" },
      ]},
      { title: "Another Task" },
    ]));

    const project = createProjectFromTemplate(db, t.id, "New Project");
    expect(project).not.toBeNull();
    expect(project!.name).toBe("New Project");

    // Check tasks were created
    const tasks = db.prepare("SELECT * FROM tasks WHERE project_id = ?").all(project!.id) as any[];
    expect(tasks.length).toBe(4); // 2 parents + 2 children
    expect(tasks.some((x: any) => x.title === "Parent Task")).toBe(true);
    expect(tasks.some((x: any) => x.title === "Subtask A")).toBe(true);
  });

  it("returns null for unknown template", () => {
    expect(createProjectFromTemplate(db, "nonexistent", "Test")).toBeNull();
  });
});

// ─── 3.3 Timeline — start_date ──────────────────────────────────────────────

describe("3.3 Timeline — start_date", () => {
  it("creates task with start_date", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, {
      project_id: project.id, title: "T", description: null,
      priority: "medium", start_date: "2026-04-01", due_date: "2026-04-15",
    });
    expect(task.start_date).toBe("2026-04-01");
  });

  it("updates start_date", () => {
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });
    const updated = updateTask(db, task.id, { start_date: "2026-04-05" });
    expect(updated!.start_date).toBe("2026-04-05");
  });
});

// ─── 3.5 Activity Stream ────────────────────────────────────────────────────

describe("3.5 Activity Stream", () => {
  it("returns activity with no filters", () => {
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });

    logActivity(db, { task_id: task.id, agent_id: agent.id, message: "working" });
    logActivity(db, { task_id: task.id, agent_id: agent.id, message: "done" });

    const stream = getActivityStream(db);
    expect(stream.length).toBeGreaterThanOrEqual(2);
  });

  it("filters by agent_id", () => {
    const a1 = registerAgent(db, { name: "bot-1", model: null, capabilities: [] });
    const a2 = registerAgent(db, { name: "bot-2", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });

    logActivity(db, { task_id: task.id, agent_id: a1.id, message: "a1 work" });
    logActivity(db, { task_id: task.id, agent_id: a2.id, message: "a2 work" });

    const stream = getActivityStream(db, { agent_id: a1.id });
    expect(stream).toHaveLength(1);
    expect(stream[0].message).toBe("a1 work");
  });

  it("filters by project_id", () => {
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const p1 = createProject(db, { name: "P1", description: null });
    const p2 = createProject(db, { name: "P2", description: null });
    const t1 = createTask(db, { project_id: p1.id, title: "T1", description: null, priority: "medium" });
    const t2 = createTask(db, { project_id: p2.id, title: "T2", description: null, priority: "medium" });

    logActivity(db, { task_id: t1.id, agent_id: agent.id, message: "p1 work" });
    logActivity(db, { task_id: t2.id, agent_id: agent.id, message: "p2 work" });

    const stream = getActivityStream(db, { project_id: p1.id });
    expect(stream).toHaveLength(1);
    expect(stream[0].message).toBe("p1 work");
  });

  it("respects limit", () => {
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "T", description: null, priority: "medium" });

    for (let i = 0; i < 10; i++) {
      logActivity(db, { task_id: task.id, agent_id: agent.id, message: `work ${i}` });
    }

    const stream = getActivityStream(db, { limit: 3 });
    expect(stream).toHaveLength(3);
  });
});
