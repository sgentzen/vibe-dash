import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type {
  Project,
  Task,
  Sprint,
  Agent,
  ActivityEntry,
  Blocker,
  TaskStatus,
  TaskPriority,
  SprintStatus,
} from "./types.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS projects (",
  "  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,",
  "  created_at TEXT NOT NULL, updated_at TEXT NOT NULL",
  ");",
  "CREATE TABLE IF NOT EXISTS sprints (",
  "  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),",
  "  name TEXT NOT NULL, description TEXT,",
  "  status TEXT NOT NULL DEFAULT 'planned',",
  "  start_date TEXT, end_date TEXT,",
  "  created_at TEXT NOT NULL, updated_at TEXT NOT NULL",
  ");",
  "CREATE TABLE IF NOT EXISTS tasks (",
  "  id TEXT PRIMARY KEY,",
  "  project_id TEXT NOT NULL REFERENCES projects(id),",
  "  parent_task_id TEXT REFERENCES tasks(id),",
  "  sprint_id TEXT REFERENCES sprints(id),",
  "  title TEXT NOT NULL, description TEXT,",
  "  status TEXT NOT NULL DEFAULT 'planned',",
  "  priority TEXT NOT NULL DEFAULT 'medium',",
  "  progress INTEGER NOT NULL DEFAULT 0,",
  "  created_at TEXT NOT NULL, updated_at TEXT NOT NULL",
  ");",
  "CREATE TABLE IF NOT EXISTS agents (",
  "  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, model TEXT,",
  "  capabilities TEXT NOT NULL DEFAULT '[]',",
  "  registered_at TEXT NOT NULL, last_seen_at TEXT NOT NULL",
  ");",
  "CREATE TABLE IF NOT EXISTS activity_log (",
  "  id TEXT PRIMARY KEY,",
  "  task_id TEXT NOT NULL REFERENCES tasks(id),",
  "  agent_id TEXT REFERENCES agents(id),",
  "  message TEXT NOT NULL, timestamp TEXT NOT NULL",
  ");",
  "CREATE TABLE IF NOT EXISTS blockers (",
  "  id TEXT PRIMARY KEY,",
  "  task_id TEXT NOT NULL REFERENCES tasks(id),",
  "  reason TEXT NOT NULL, reported_at TEXT NOT NULL, resolved_at TEXT",
  ");",
].join("\n");

export function initDb(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
}

function migrate(db: Database.Database): void {
  // Add sprint_id column to tasks if missing (existing DBs before sprints feature)
  const cols = db.pragma("table_info(tasks)") as { name: string }[];
  if (!cols.some((c) => c.name === "sprint_id")) {
    db.prepare("ALTER TABLE tasks ADD COLUMN sprint_id TEXT REFERENCES sprints(id)").run();
  }
}

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  initDb(db);
  return db;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function parseAgent(row: Record<string, unknown>): Agent {
  return {
    ...(row as Omit<Agent, "capabilities">),
    capabilities: JSON.parse(row.capabilities as string) as string[],
  };
}

// ─── Projects ────────────────────────────────────────────────────────────────

export function createProject(
  db: Database.Database,
  input: { name: string; description: string | null }
): Project {
  const id = randomUUID();
  const ts = now();
  db.prepare(
    "INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, input.name, input.description ?? null, ts, ts);
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project;
}

export function listProjects(db: Database.Database): Project[] {
  return db
    .prepare("SELECT * FROM projects ORDER BY created_at ASC")
    .all() as Project[];
}

// ─── Sprints ──────────────────────────────────────────────────────────────────

export interface CreateSprintInput {
  project_id: string;
  name: string;
  description?: string | null;
  status?: SprintStatus;
  start_date?: string | null;
  end_date?: string | null;
}

export function createSprint(
  db: Database.Database,
  input: CreateSprintInput
): Sprint {
  const id = randomUUID();
  const ts = now();
  db.prepare(
    "INSERT INTO sprints (id, project_id, name, description, status, start_date, end_date, created_at, updated_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    input.project_id,
    input.name,
    input.description ?? null,
    input.status ?? "planned",
    input.start_date ?? null,
    input.end_date ?? null,
    ts,
    ts
  );
  return db.prepare("SELECT * FROM sprints WHERE id = ?").get(id) as Sprint;
}

export interface UpdateSprintInput {
  name?: string;
  description?: string | null;
  status?: SprintStatus;
  start_date?: string | null;
  end_date?: string | null;
}

export function updateSprint(
  db: Database.Database,
  id: string,
  input: UpdateSprintInput
): Sprint | null {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.description !== undefined) { sets.push("description = ?"); params.push(input.description); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }
  if (input.start_date !== undefined) { sets.push("start_date = ?"); params.push(input.start_date); }
  if (input.end_date !== undefined) { sets.push("end_date = ?"); params.push(input.end_date); }

  if (sets.length === 0) return getSprint(db, id);

  sets.push("updated_at = ?");
  params.push(now());
  params.push(id);

  db.prepare("UPDATE sprints SET " + sets.join(", ") + " WHERE id = ?").run(...params);
  return getSprint(db, id);
}

export function getSprint(db: Database.Database, id: string): Sprint | null {
  return (
    (db.prepare("SELECT * FROM sprints WHERE id = ?").get(id) as Sprint | undefined) ?? null
  );
}

export function listSprints(
  db: Database.Database,
  projectId?: string
): Sprint[] {
  if (projectId) {
    return db
      .prepare("SELECT * FROM sprints WHERE project_id = ? ORDER BY created_at ASC")
      .all(projectId) as Sprint[];
  }
  return db
    .prepare("SELECT * FROM sprints ORDER BY created_at ASC")
    .all() as Sprint[];
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  project_id: string;
  parent_task_id?: string | null;
  sprint_id?: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status?: TaskStatus;
}

export function createTask(
  db: Database.Database,
  input: CreateTaskInput
): Task {
  const id = randomUUID();
  const ts = now();
  const status: TaskStatus = input.status ?? "planned";
  const parent = input.parent_task_id ?? null;
  const sprint = input.sprint_id ?? null;
  db.prepare(
    "INSERT INTO tasks (id, project_id, parent_task_id, sprint_id, title, description, status, priority, progress, created_at, updated_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)"
  ).run(
    id,
    input.project_id,
    parent,
    sprint,
    input.title,
    input.description ?? null,
    status,
    input.priority,
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

// ─── Agents ───────────────────────────────────────────────────────────────────

export interface RegisterAgentInput {
  name: string;
  model: string | null;
  capabilities: string[];
}

export function registerAgent(
  db: Database.Database,
  input: RegisterAgentInput
): Agent {
  const ts = now();
  const capJson = JSON.stringify(input.capabilities);
  const existing = db
    .prepare("SELECT * FROM agents WHERE name = ?")
    .get(input.name) as Record<string, unknown> | undefined;

  if (existing) {
    db.prepare(
      "UPDATE agents SET model = ?, capabilities = ?, last_seen_at = ? WHERE name = ?"
    ).run(input.model ?? null, capJson, ts, input.name);
  } else {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO agents (id, name, model, capabilities, registered_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, input.name, input.model ?? null, capJson, ts, ts);
  }

  const row = db
    .prepare("SELECT * FROM agents WHERE name = ?")
    .get(input.name) as Record<string, unknown>;
  return parseAgent(row);
}

export function listAgents(db: Database.Database): Agent[] {
  const rows = db
    .prepare("SELECT * FROM agents ORDER BY registered_at ASC")
    .all() as Record<string, unknown>[];
  return rows.map(parseAgent);
}

export function getAgentByName(
  db: Database.Database,
  name: string
): Agent | null {
  const row = db
    .prepare("SELECT * FROM agents WHERE name = ?")
    .get(name) as Record<string, unknown> | undefined;
  if (!row) return null;
  return parseAgent(row);
}

export function touchAgent(db: Database.Database, name: string): Agent {
  const existing = getAgentByName(db, name);
  if (existing) {
    db.prepare("UPDATE agents SET last_seen_at = ? WHERE name = ?").run(now(), name);
    return { ...existing, last_seen_at: now() };
  }
  return registerAgent(db, { name, model: null, capabilities: [] });
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

export interface LogActivityInput {
  task_id: string;
  agent_id: string | null;
  message: string;
}

export function logActivity(
  db: Database.Database,
  input: LogActivityInput
): ActivityEntry {
  const id = randomUUID();
  const ts = now();
  db.prepare(
    "INSERT INTO activity_log (id, task_id, agent_id, message, timestamp) VALUES (?, ?, ?, ?, ?)"
  ).run(id, input.task_id, input.agent_id ?? null, input.message, ts);
  return db
    .prepare("SELECT * FROM activity_log WHERE id = ?")
    .get(id) as ActivityEntry;
}

export function getRecentActivity(
  db: Database.Database,
  limit: number
): ActivityEntry[] {
  return db
    .prepare(
      `SELECT a.*, ag.name AS agent_name, t.title AS task_title
       FROM activity_log a
       LEFT JOIN agents ag ON a.agent_id = ag.id
       LEFT JOIN tasks t ON a.task_id = t.id
       ORDER BY a.timestamp DESC LIMIT ?`
    )
    .all(limit) as ActivityEntry[];
}

export function getAgentCurrentTask(
  db: Database.Database,
  agentId: string
): string | null {
  const row = db
    .prepare(
      `SELECT t.title FROM activity_log a
       JOIN tasks t ON a.task_id = t.id
       WHERE a.agent_id = ? AND t.status IN ('in_progress', 'planned')
       ORDER BY a.timestamp DESC LIMIT 1`
    )
    .get(agentId) as { title: string } | undefined;
  return row?.title ?? null;
}

// ─── Blockers ─────────────────────────────────────────────────────────────────

export interface CreateBlockerInput {
  task_id: string;
  reason: string;
}

export function createBlocker(
  db: Database.Database,
  input: CreateBlockerInput
): Blocker {
  const id = randomUUID();
  const ts = now();
  db.prepare(
    "INSERT INTO blockers (id, task_id, reason, reported_at, resolved_at) VALUES (?, ?, ?, ?, NULL)"
  ).run(id, input.task_id, input.reason, ts);
  updateTask(db, input.task_id, { status: "blocked" });
  return db.prepare("SELECT * FROM blockers WHERE id = ?").get(id) as Blocker;
}

export function resolveBlocker(
  db: Database.Database,
  id: string
): Blocker | null {
  const blocker = db
    .prepare("SELECT * FROM blockers WHERE id = ?")
    .get(id) as Blocker | undefined;
  if (!blocker) return null;
  const ts = now();
  db.prepare("UPDATE blockers SET resolved_at = ? WHERE id = ?").run(ts, id);
  updateTask(db, blocker.task_id, { status: "in_progress" });
  return db.prepare("SELECT * FROM blockers WHERE id = ?").get(id) as Blocker;
}

export function getActiveBlockers(db: Database.Database): Blocker[] {
  return db
    .prepare(
      "SELECT * FROM blockers WHERE resolved_at IS NULL ORDER BY reported_at ASC"
    )
    .all() as Blocker[];
}
