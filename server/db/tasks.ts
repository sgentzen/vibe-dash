import type Database from "better-sqlite3";
import type { Task, TaskStatus, TaskPriority } from "../types.js";
import { now, genId } from "./helpers.js";
import { getNextDueDate } from "../recurrence.js";

export interface CreateTaskInput {
  project_id: string;
  parent_task_id?: string | null;
  sprint_id?: string | null;
  milestone_id?: string | null;
  assigned_agent_id?: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status?: TaskStatus;
  due_date?: string | null;
  start_date?: string | null;
  estimate?: number | null;
  recurrence_rule?: string | null;
}

export function createTask(
  db: Database.Database,
  input: CreateTaskInput
): Task {
  const id = genId();
  const ts = now();
  const status: TaskStatus = input.status ?? "planned";
  db.prepare(
    "INSERT INTO tasks (id, project_id, parent_task_id, sprint_id, milestone_id, assigned_agent_id, title, description, status, priority, progress, due_date, start_date, estimate, recurrence_rule, created_at, updated_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    input.project_id,
    input.parent_task_id ?? null,
    input.sprint_id ?? null,
    input.milestone_id ?? null,
    input.assigned_agent_id ?? null,
    input.title,
    input.description ?? null,
    status,
    input.priority,
    input.due_date ?? null,
    input.start_date ?? null,
    input.estimate ?? null,
    input.recurrence_rule ?? null,
    ts,
    ts
  );
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task;
}

export function getTask(db: Database.Database, id: string): Task | null {
  return (
    (db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | Task
      | undefined) ?? null
  );
}

export interface ListTasksFilter {
  project_id?: string;
  status?: TaskStatus;
  parent_task_id?: string;
  sprint_id?: string;
  assigned_agent_id?: string;
}

export function listTasks(
  db: Database.Database,
  filter?: ListTasksFilter
): Task[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.project_id !== undefined) {
    conditions.push("project_id = ?");
    params.push(filter.project_id);
  }
  if (filter?.status !== undefined) {
    conditions.push("status = ?");
    params.push(filter.status);
  }
  if (filter?.parent_task_id !== undefined) {
    conditions.push("parent_task_id = ?");
    params.push(filter.parent_task_id);
  }
  if (filter?.sprint_id !== undefined) {
    conditions.push("sprint_id = ?");
    params.push(filter.sprint_id);
  }
  if (filter?.assigned_agent_id !== undefined) {
    conditions.push("assigned_agent_id = ?");
    params.push(filter.assigned_agent_id);
  }

  const where =
    conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  return db
    .prepare("SELECT * FROM tasks " + where + " ORDER BY created_at ASC")
    .all(...params) as Task[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  progress?: number;
  parent_task_id?: string | null;
  sprint_id?: string | null;
  milestone_id?: string | null;
  assigned_agent_id?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  estimate?: number | null;
  recurrence_rule?: string | null;
}

export function updateTask(
  db: Database.Database,
  id: string,
  input: UpdateTaskInput
): Task | null {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.title !== undefined) {
    sets.push("title = ?");
    params.push(input.title);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.priority !== undefined) {
    sets.push("priority = ?");
    params.push(input.priority);
  }
  if (input.progress !== undefined) {
    sets.push("progress = ?");
    params.push(input.progress);
  }
  if (input.parent_task_id !== undefined) {
    sets.push("parent_task_id = ?");
    params.push(input.parent_task_id);
  }
  if (input.sprint_id !== undefined) {
    sets.push("sprint_id = ?");
    params.push(input.sprint_id);
  }
  if (input.milestone_id !== undefined) {
    sets.push("milestone_id = ?");
    params.push(input.milestone_id);
  }
  if (input.assigned_agent_id !== undefined) {
    sets.push("assigned_agent_id = ?");
    params.push(input.assigned_agent_id);
  }
  if (input.due_date !== undefined) {
    sets.push("due_date = ?");
    params.push(input.due_date);
  }
  if (input.estimate !== undefined) {
    sets.push("estimate = ?");
    params.push(input.estimate);
  }
  if (input.recurrence_rule !== undefined) {
    sets.push("recurrence_rule = ?");
    params.push(input.recurrence_rule);
  }
  if (input.start_date !== undefined) {
    sets.push("start_date = ?");
    params.push(input.start_date);
  }

  if (sets.length === 0) return getTask(db, id);

  sets.push("updated_at = ?");
  params.push(now());
  params.push(id);

  db.prepare("UPDATE tasks SET " + sets.join(", ") + " WHERE id = ?").run(
    ...params
  );
  return getTask(db, id);
}

export function completeTask(db: Database.Database, id: string): Task | null {
  return updateTask(db, id, { status: "done", progress: 100 });
}

// ─── Search ─────────────────────────────────────────────────────────────────

export interface SearchTasksFilter {
  query?: string;
  project_id?: string;
  sprint_id?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_agent_id?: string;
  tag_id?: string;
  milestone_id?: string;
  due_before?: string;
  due_after?: string;
  limit?: number;
  offset?: number;
}

export function searchTasks(db: Database.Database, filter: SearchTasksFilter): Task[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.query) {
    conditions.push("(t.title LIKE ? OR t.description LIKE ?)");
    const q = `%${filter.query}%`;
    params.push(q, q);
  }
  if (filter.project_id) { conditions.push("t.project_id = ?"); params.push(filter.project_id); }
  if (filter.sprint_id) { conditions.push("t.sprint_id = ?"); params.push(filter.sprint_id); }
  if (filter.status) { conditions.push("t.status = ?"); params.push(filter.status); }
  if (filter.priority) { conditions.push("t.priority = ?"); params.push(filter.priority); }
  if (filter.assigned_agent_id) { conditions.push("t.assigned_agent_id = ?"); params.push(filter.assigned_agent_id); }
  if (filter.milestone_id) { conditions.push("t.milestone_id = ?"); params.push(filter.milestone_id); }
  if (filter.due_before) { conditions.push("t.due_date <= ?"); params.push(filter.due_before); }
  if (filter.due_after) { conditions.push("t.due_date >= ?"); params.push(filter.due_after); }

  let sql = "SELECT DISTINCT t.* FROM tasks t";
  if (filter.tag_id) {
    sql += " JOIN task_tags tt ON t.id = tt.task_id";
    conditions.push("tt.tag_id = ?");
    params.push(filter.tag_id);
  }

  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");

  const limit = Math.min(filter.limit ?? 200, 500);
  const offset = filter.offset ?? 0;
  sql += ` ORDER BY t.created_at DESC LIMIT ${limit} OFFSET ${offset}`;

  return db.prepare(sql).all(...params) as Task[];
}

// ─── Bulk Update ────────────────────────────────────────────────────────────

export function bulkUpdateTasks(
  db: Database.Database,
  taskIds: string[],
  updates: UpdateTaskInput
): Task[] {
  const run = db.transaction(() => {
    const results: Task[] = [];
    for (const id of taskIds) {
      const updated = updateTask(db, id, updates);
      if (updated) results.push(updated);
    }
    return results;
  });
  return run();
}

// ─── Recurring Tasks ────────────────────────────────────────────────────────

export function handleRecurringTaskCompletion(db: Database.Database, taskId: string): Task | null {
  const task = getTask(db, taskId);
  if (!task || !task.recurrence_rule) return null;

  const nextDueDate = getNextDueDate(task.due_date, task.recurrence_rule);
  const nextStartDate = task.start_date ? getNextDueDate(task.start_date, task.recurrence_rule) : null;
  const nextTask = createTask(db, {
    project_id: task.project_id,
    parent_task_id: task.parent_task_id,
    sprint_id: task.sprint_id,
    milestone_id: task.milestone_id,
    assigned_agent_id: task.assigned_agent_id,
    title: task.title,
    description: task.description,
    priority: task.priority,
    due_date: nextDueDate,
    start_date: nextStartDate,
    estimate: task.estimate,
    recurrence_rule: task.recurrence_rule,
  });
  return nextTask;
}
