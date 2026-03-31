import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type {
  Project,
  Task,
  Sprint,
  Agent,
  ActivityEntry,
  Blocker,
  Tag,
  TaskTag,
  AgentSession,
  TaskDependency,
  SavedFilter,
  SprintCapacity,
  TaskStatus,
  TaskPriority,
  SprintStatus,
  AgentHealthStatus,
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
  "  role TEXT NOT NULL DEFAULT 'agent',",
  "  parent_agent_id TEXT REFERENCES agents(id),",
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
  "CREATE TABLE IF NOT EXISTS tags (",
  "  id TEXT PRIMARY KEY,",
  "  project_id TEXT NOT NULL REFERENCES projects(id),",
  "  name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6366f1',",
  "  created_at TEXT NOT NULL,",
  "  UNIQUE(project_id, name)",
  ");",
  "CREATE TABLE IF NOT EXISTS task_tags (",
  "  id TEXT PRIMARY KEY,",
  "  task_id TEXT NOT NULL REFERENCES tasks(id),",
  "  tag_id TEXT NOT NULL REFERENCES tags(id),",
  "  UNIQUE(task_id, tag_id)",
  ");",
  "CREATE TABLE IF NOT EXISTS agent_sessions (",
  "  id TEXT PRIMARY KEY,",
  "  agent_id TEXT NOT NULL REFERENCES agents(id),",
  "  started_at TEXT NOT NULL, ended_at TEXT,",
  "  last_activity_at TEXT NOT NULL,",
  "  tasks_touched INTEGER NOT NULL DEFAULT 0,",
  "  activity_count INTEGER NOT NULL DEFAULT 0",
  ");",
  "CREATE TABLE IF NOT EXISTS task_dependencies (",
  "  id TEXT PRIMARY KEY,",
  "  task_id TEXT NOT NULL REFERENCES tasks(id),",
  "  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id),",
  "  created_at TEXT NOT NULL,",
  "  UNIQUE(task_id, depends_on_task_id)",
  ");",
  "CREATE TABLE IF NOT EXISTS saved_filters (",
  "  id TEXT PRIMARY KEY,",
  "  name TEXT NOT NULL,",
  "  filter_json TEXT NOT NULL,",
  "  created_at TEXT NOT NULL",
  ");",
].join("\n");

export function initDb(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
}

function migrate(db: Database.Database): void {
  const cols = db.pragma("table_info(tasks)") as { name: string }[];
  if (!cols.some((c) => c.name === "sprint_id")) {
    db.prepare("ALTER TABLE tasks ADD COLUMN sprint_id TEXT REFERENCES sprints(id)").run();
  }
  if (!cols.some((c) => c.name === "assigned_agent_id")) {
    db.prepare("ALTER TABLE tasks ADD COLUMN assigned_agent_id TEXT REFERENCES agents(id)").run();
  }
  if (!cols.some((c) => c.name === "due_date")) {
    db.prepare("ALTER TABLE tasks ADD COLUMN due_date TEXT").run();
  }
  if (!cols.some((c) => c.name === "estimate")) {
    db.prepare("ALTER TABLE tasks ADD COLUMN estimate INTEGER").run();
  }

  // Agent migrations
  const agentCols = db.pragma("table_info(agents)") as { name: string }[];
  if (!agentCols.some((c) => c.name === "role")) {
    db.prepare("ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'agent'").run();
  }
  if (!agentCols.some((c) => c.name === "parent_agent_id")) {
    db.prepare("ALTER TABLE agents ADD COLUMN parent_agent_id TEXT REFERENCES agents(id)").run();
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
    ...(row as Omit<Agent, "capabilities" | "role">),
    capabilities: JSON.parse(row.capabilities as string) as string[],
    role: (row.role as Agent["role"]) ?? "agent",
    parent_agent_id: (row.parent_agent_id as string) ?? null,
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
  assigned_agent_id?: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status?: TaskStatus;
  due_date?: string | null;
  estimate?: number | null;
}

export function createTask(
  db: Database.Database,
  input: CreateTaskInput
): Task {
  const id = randomUUID();
  const ts = now();
  const status: TaskStatus = input.status ?? "planned";
  db.prepare(
    "INSERT INTO tasks (id, project_id, parent_task_id, sprint_id, assigned_agent_id, title, description, status, priority, progress, due_date, estimate, created_at, updated_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)"
  ).run(
    id,
    input.project_id,
    input.parent_task_id ?? null,
    input.sprint_id ?? null,
    input.assigned_agent_id ?? null,
    input.title,
    input.description ?? null,
    status,
    input.priority,
    input.due_date ?? null,
    input.estimate ?? null,
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
  assigned_agent_id?: string | null;
  due_date?: string | null;
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
  if (input.sprint_id !== undefined) {
    sets.push("sprint_id = ?");
    params.push(input.sprint_id);
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
  role?: Agent["role"];
  parent_agent_name?: string;
}

export function registerAgent(
  db: Database.Database,
  input: RegisterAgentInput
): Agent {
  const ts = now();
  const capJson = JSON.stringify(input.capabilities);
  const role = input.role ?? "agent";

  // Resolve parent agent by name
  let parentAgentId: string | null = null;
  if (input.parent_agent_name) {
    const parent = getAgentByName(db, input.parent_agent_name);
    if (parent) parentAgentId = parent.id;
  }

  const existing = db
    .prepare("SELECT * FROM agents WHERE name = ?")
    .get(input.name) as Record<string, unknown> | undefined;

  if (existing) {
    db.prepare(
      "UPDATE agents SET model = ?, capabilities = ?, role = ?, parent_agent_id = COALESCE(?, parent_agent_id), last_seen_at = ? WHERE name = ?"
    ).run(input.model ?? null, capJson, role, parentAgentId, ts, input.name);
  } else {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO agents (id, name, model, capabilities, role, parent_agent_id, registered_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, input.name, input.model ?? null, capJson, role, parentAgentId, ts, ts);
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

// ─── Agent Health ────────────────────────────────────────────────────────────

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;
const IDLE_THRESHOLD_MS = 30 * 60 * 1000;

export function getAgentHealthStatus(lastSeenAt: string): AgentHealthStatus {
  const elapsed = Date.now() - new Date(lastSeenAt).getTime();
  if (elapsed < ACTIVE_THRESHOLD_MS) return "active";
  if (elapsed < IDLE_THRESHOLD_MS) return "idle";
  return "offline";
}

// ─── Tags ────────────────────────────────────────────────────────────────────

export interface CreateTagInput {
  project_id: string;
  name: string;
  color?: string;
}

export function createTag(db: Database.Database, input: CreateTagInput): Tag {
  const id = randomUUID();
  const ts = now();
  db.prepare(
    "INSERT INTO tags (id, project_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, input.project_id, input.name, input.color ?? "#6366f1", ts);
  return db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as Tag;
}

export function listTags(db: Database.Database, projectId: string): Tag[] {
  return db
    .prepare("SELECT * FROM tags WHERE project_id = ? ORDER BY name ASC")
    .all(projectId) as Tag[];
}

export function addTagToTask(
  db: Database.Database,
  taskId: string,
  tagId: string
): TaskTag {
  const id = randomUUID();
  db.prepare(
    "INSERT OR IGNORE INTO task_tags (id, task_id, tag_id) VALUES (?, ?, ?)"
  ).run(id, taskId, tagId);
  return db
    .prepare("SELECT * FROM task_tags WHERE task_id = ? AND tag_id = ?")
    .get(taskId, tagId) as TaskTag;
}

export function removeTagFromTask(
  db: Database.Database,
  taskId: string,
  tagId: string
): boolean {
  const result = db
    .prepare("DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?")
    .run(taskId, tagId);
  return result.changes > 0;
}

export function getTaskTags(db: Database.Database, taskId: string): Tag[] {
  return db
    .prepare(
      "SELECT t.* FROM tags t JOIN task_tags tt ON t.id = tt.tag_id WHERE tt.task_id = ? ORDER BY t.name ASC"
    )
    .all(taskId) as Tag[];
}

export function getTag(db: Database.Database, id: string): Tag | null {
  return (
    (db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as Tag | undefined) ?? null
  );
}

// ─── Time Estimates ──────────────────────────────────────────────────────────

export function getTimeSpent(db: Database.Database, taskId: string): number | null {
  const first = db
    .prepare("SELECT MIN(timestamp) AS ts FROM activity_log WHERE task_id = ?")
    .get(taskId) as { ts: string | null } | undefined;
  const task = getTask(db, taskId);
  if (!first?.ts || !task || task.status !== "done") return null;
  const start = new Date(first.ts).getTime();
  const end = new Date(task.updated_at).getTime();
  return Math.max(0, Math.round((end - start) / 1000));
}

export function getSprintCapacity(db: Database.Database, sprintId: string): SprintCapacity {
  const tasks = listTasks(db, { sprint_id: sprintId });
  let totalEstimated = 0;
  let completedPoints = 0;
  let completedCount = 0;
  for (const t of tasks) {
    if (t.estimate) totalEstimated += t.estimate;
    if (t.status === "done") {
      completedCount++;
      if (t.estimate) completedPoints += t.estimate;
    }
  }
  return {
    total_estimated: totalEstimated,
    completed_points: completedPoints,
    remaining_points: totalEstimated - completedPoints,
    task_count: tasks.length,
    completed_count: completedCount,
  };
}

// ─── Agent Sessions ──────────────────────────────────────────────────────────

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export function startOrGetSession(db: Database.Database, agentId: string): AgentSession {
  const ts = now();
  // Find open session for this agent
  const open = db
    .prepare("SELECT * FROM agent_sessions WHERE agent_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1")
    .get(agentId) as AgentSession | undefined;

  if (open) {
    const elapsed = Date.now() - new Date(open.last_activity_at).getTime();
    if (elapsed > SESSION_TIMEOUT_MS) {
      // Close stale session, start new one
      db.prepare("UPDATE agent_sessions SET ended_at = ? WHERE id = ?").run(ts, open.id);
    } else {
      // Increment activity count and update last_activity_at
      db.prepare("UPDATE agent_sessions SET activity_count = activity_count + 1, last_activity_at = ? WHERE id = ?").run(ts, open.id);
      return db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(open.id) as AgentSession;
    }
  }

  // Start new session
  const id = randomUUID();
  db.prepare(
    "INSERT INTO agent_sessions (id, agent_id, started_at, last_activity_at, tasks_touched, activity_count) VALUES (?, ?, ?, ?, 1, 1)"
  ).run(id, agentId, ts, ts);
  return db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(id) as AgentSession;
}

export function closeAgentSessions(db: Database.Database, agentId: string): void {
  db.prepare("UPDATE agent_sessions SET ended_at = ? WHERE agent_id = ? AND ended_at IS NULL").run(now(), agentId);
}

export function closeStaleSession(db: Database.Database): number {
  const cutoff = new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString();
  const result = db.prepare(
    "UPDATE agent_sessions SET ended_at = ? WHERE ended_at IS NULL AND started_at < ?"
  ).run(now(), cutoff);
  return result.changes;
}

/** Remove agents with no open sessions whose last_seen_at is older than the idle threshold */
export function cleanupStaleAgents(db: Database.Database): number {
  const cutoff = new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString();
  const result = db.prepare(
    `DELETE FROM agents WHERE last_seen_at < ?
     AND id NOT IN (SELECT agent_id FROM agent_sessions WHERE ended_at IS NULL)`
  ).run(cutoff);
  return result.changes;
}

export function listAgentSessions(db: Database.Database, agentId: string): AgentSession[] {
  return db
    .prepare("SELECT * FROM agent_sessions WHERE agent_id = ? ORDER BY started_at DESC")
    .all(agentId) as AgentSession[];
}

// ─── Task Dependencies ───────────────────────────────────────────────────────

export function addDependency(
  db: Database.Database,
  taskId: string,
  dependsOnTaskId: string
): TaskDependency {
  if (taskId === dependsOnTaskId) {
    throw new Error("A task cannot depend on itself");
  }
  const id = randomUUID();
  const ts = now();
  db.prepare(
    "INSERT OR IGNORE INTO task_dependencies (id, task_id, depends_on_task_id, created_at) VALUES (?, ?, ?, ?)"
  ).run(id, taskId, dependsOnTaskId, ts);
  return db
    .prepare("SELECT * FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?")
    .get(taskId, dependsOnTaskId) as TaskDependency;
}

export function removeDependency(db: Database.Database, id: string): boolean {
  const result = db.prepare("DELETE FROM task_dependencies WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listDependencies(db: Database.Database, taskId: string): TaskDependency[] {
  return db
    .prepare("SELECT * FROM task_dependencies WHERE task_id = ? ORDER BY created_at ASC")
    .all(taskId) as TaskDependency[];
}

export function getBlockingTasks(db: Database.Database, taskId: string): Task[] {
  return db
    .prepare(
      `SELECT t.* FROM tasks t
       JOIN task_dependencies td ON t.id = td.depends_on_task_id
       WHERE td.task_id = ? AND t.status != 'done'
       ORDER BY t.created_at ASC`
    )
    .all(taskId) as Task[];
}

// ─── Search ──────────────────────────────────────────────────────────────────

export interface SearchTasksFilter {
  query?: string;
  project_id?: string;
  sprint_id?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_agent_id?: string;
  tag_id?: string;
  due_before?: string;
  due_after?: string;
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
  if (filter.due_before) { conditions.push("t.due_date <= ?"); params.push(filter.due_before); }
  if (filter.due_after) { conditions.push("t.due_date >= ?"); params.push(filter.due_after); }

  let sql = "SELECT DISTINCT t.* FROM tasks t";
  if (filter.tag_id) {
    sql += " JOIN task_tags tt ON t.id = tt.task_id";
    conditions.push("tt.tag_id = ?");
    params.push(filter.tag_id);
  }

  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY t.created_at DESC LIMIT 200";

  return db.prepare(sql).all(...params) as Task[];
}

// ─── Saved Filters ───────────────────────────────────────────────────────────

export function createSavedFilter(db: Database.Database, name: string, filterJson: string): SavedFilter {
  const id = randomUUID();
  const ts = now();
  db.prepare("INSERT INTO saved_filters (id, name, filter_json, created_at) VALUES (?, ?, ?, ?)").run(id, name, filterJson, ts);
  return db.prepare("SELECT * FROM saved_filters WHERE id = ?").get(id) as SavedFilter;
}

export function listSavedFilters(db: Database.Database): SavedFilter[] {
  return db.prepare("SELECT * FROM saved_filters ORDER BY created_at DESC").all() as SavedFilter[];
}

export function deleteSavedFilter(db: Database.Database, id: string): boolean {
  return db.prepare("DELETE FROM saved_filters WHERE id = ?").run(id).changes > 0;
}

// ─── Agent Detail ────────────────────────────────────────────────────────────

export function getAgentById(db: Database.Database, id: string): Agent | null {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return parseAgent(row);
}

export function getAgentActivity(db: Database.Database, agentId: string, limit = 50): ActivityEntry[] {
  return db
    .prepare(
      `SELECT a.*, ag.name AS agent_name, t.title AS task_title
       FROM activity_log a
       LEFT JOIN agents ag ON a.agent_id = ag.id
       LEFT JOIN tasks t ON a.task_id = t.id
       WHERE a.agent_id = ?
       ORDER BY a.timestamp DESC LIMIT ?`
    )
    .all(agentId, limit) as ActivityEntry[];
}

export function getAgentCompletedToday(db: Database.Database, agentId: string): number {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT t.id) AS count FROM activity_log a
       JOIN tasks t ON a.task_id = t.id
       WHERE a.agent_id = ? AND t.status = 'done' AND t.updated_at >= ?`
    )
    .get(agentId, todayStart.toISOString()) as { count: number };
  return row.count;
}
