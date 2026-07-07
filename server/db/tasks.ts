import type Database from "better-sqlite3";
import type { Task, TaskStatus, TaskPriority } from "../types.js";
import { now, genId } from "./helpers.js";
import { DEFAULT_TASK_LIST_LIMIT, MAX_TASK_LIST_LIMIT } from "../constants.js";

/** Clamp a caller-supplied limit to [1, MAX_TASK_LIST_LIMIT], defaulting when absent/invalid. */
function clampListLimit(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TASK_LIST_LIMIT;
  return Math.min(n, MAX_TASK_LIST_LIMIT);
}

/** Clamp a caller-supplied offset to a non-negative, finite integer (guards NaN/Infinity). */
function clampListOffset(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface CreateTaskInput {
  project_id: string;
  parent_task_id?: string | null;
  milestone_id?: string | null;
  assigned_agent_id?: string | null;
  title: string;
  description?: string | null;
  priority: TaskPriority;
  status?: TaskStatus;
  due_date?: string | null;
  start_date?: string | null;
  estimate?: number | null;
}

export function createTask(
  db: Database.Database,
  input: CreateTaskInput
): Task {
  const id = genId();
  const ts = now();
  const status: TaskStatus = input.status ?? "planned";
  return db.prepare(
    "INSERT INTO tasks (id, project_id, parent_task_id, milestone_id, assigned_agent_id, title, description, status, priority, progress, due_date, start_date, estimate, created_at, updated_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?) RETURNING *"
  ).get(
    id,
    input.project_id,
    input.parent_task_id ?? null,
    input.milestone_id ?? null,
    input.assigned_agent_id ?? null,
    input.title,
    input.description ?? null,
    status,
    input.priority,
    input.due_date ?? null,
    input.start_date ?? null,
    input.estimate ?? null,
    ts,
    ts
  ) as Task;
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
  /**
   * When `status` is not set, exclude tasks in these statuses (e.g. done/cancelled).
   * Ignored when `status` is set to an explicit value.
   */
  exclude_statuses?: TaskStatus[];
  parent_task_id?: string;
  milestone_id?: string;
  assigned_agent_id?: string;
  /**
   * When provided, results are paginated: LIMIT is clamped to
   * [1, MAX_TASK_LIST_LIMIT] (default DEFAULT_TASK_LIST_LIMIT), OFFSET to >= 0.
   * Omit `limit` entirely to return every matching row (used by REST/CLI callers
   * that render a full board and manage volume themselves).
   */
  limit?: number;
  offset?: number;
}

/** Shared WHERE builder for listTasks/countTasks so both filter identically. */
function taskListConditions(filter?: ListTasksFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.project_id !== undefined) { conditions.push("project_id = ?"); params.push(filter.project_id); }
  if (filter?.status !== undefined) {
    conditions.push("status = ?");
    params.push(filter.status);
  } else if (filter?.exclude_statuses && filter.exclude_statuses.length > 0) {
    conditions.push(`status NOT IN (${filter.exclude_statuses.map(() => "?").join(", ")})`);
    params.push(...filter.exclude_statuses);
  }
  if (filter?.parent_task_id !== undefined) { conditions.push("parent_task_id = ?"); params.push(filter.parent_task_id); }
  if (filter?.milestone_id !== undefined) { conditions.push("milestone_id = ?"); params.push(filter.milestone_id); }
  if (filter?.assigned_agent_id !== undefined) { conditions.push("assigned_agent_id = ?"); params.push(filter.assigned_agent_id); }

  const where = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";
  return { where, params };
}

export function listTasks(
  db: Database.Database,
  filter?: ListTasksFilter
): Task[] {
  const { where, params } = taskListConditions(filter);
  let sql = "SELECT * FROM tasks" + where + " ORDER BY created_at ASC";
  if (filter?.limit !== undefined) {
    sql += " LIMIT ? OFFSET ?";
    params.push(clampListLimit(filter.limit), clampListOffset(filter.offset));
  }
  // SQL fragments are hardcoded; values bound via ?
  return db.prepare(sql).all(...params) as Task[];
}

/** Total matching rows for a filter, ignoring limit/offset — used for has_more hints. */
export function countTasks(db: Database.Database, filter?: ListTasksFilter): number {
  const { where, params } = taskListConditions(filter);
  const row = db.prepare("SELECT COUNT(*) AS n FROM tasks" + where).get(...params) as { n: number };
  return row.n;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  progress?: number;
  parent_task_id?: string | null;
  milestone_id?: string | null;
  assigned_agent_id?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  estimate?: number | null;
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
  if (input.start_date !== undefined) {
    sets.push("start_date = ?");
    params.push(input.start_date);
  }

  if (sets.length === 0) return getTask(db, id);

  sets.push("updated_at = ?");
  params.push(now(), id);

  // SQL fragments are hardcoded; values bound via ?
  const row = db.prepare("UPDATE tasks SET " + sets.join(", ") + " WHERE id = ? RETURNING *").get(
    ...params
  ) as Task | undefined;
  return row ?? null;
}

export function completeTask(db: Database.Database, id: string): Task | null {
  return updateTask(db, id, { status: "done", progress: 100 });
}

export function getTasksCompletedToday(db: Database.Database): number {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'done' AND updated_at >= ?")
    .get(todayStart.toISOString()) as { n: number };
  return row.n;
}

// ─── Search ─────────────────────────────────────────────────────────────────

export interface SearchTasksFilter {
  query?: string;
  project_id?: string;
  milestone_id?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_agent_id?: string;
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
  if (filter.milestone_id) { conditions.push("t.milestone_id = ?"); params.push(filter.milestone_id); }
  if (filter.status) { conditions.push("t.status = ?"); params.push(filter.status); }
  if (filter.priority) { conditions.push("t.priority = ?"); params.push(filter.priority); }
  if (filter.assigned_agent_id) { conditions.push("t.assigned_agent_id = ?"); params.push(filter.assigned_agent_id); }
  if (filter.due_before) { conditions.push("t.due_date <= ?"); params.push(filter.due_before); }
  if (filter.due_after) { conditions.push("t.due_date >= ?"); params.push(filter.due_after); }

  let sql = "SELECT t.* FROM tasks t";

  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");

  sql += " ORDER BY t.created_at DESC LIMIT ? OFFSET ?";
  params.push(clampListLimit(filter.limit), clampListOffset(filter.offset));

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

