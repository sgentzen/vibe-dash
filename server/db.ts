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
  TaskComment,
  AgentFileLock,
  FileConflict,
  AlertRule,
  AppNotification,
  AgentStats,
  AgentContribution,
  SprintDailyStats,
  VelocityData,
  ActivityHeatmapEntry,
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
  "CREATE TABLE IF NOT EXISTS sprint_daily_stats (",
  "  sprint_id TEXT NOT NULL REFERENCES sprints(id),",
  "  date TEXT NOT NULL,",
  "  completed_points INTEGER NOT NULL DEFAULT 0,",
  "  remaining_points INTEGER NOT NULL DEFAULT 0,",
  "  completed_tasks INTEGER NOT NULL DEFAULT 0,",
  "  remaining_tasks INTEGER NOT NULL DEFAULT 0,",
  "  PRIMARY KEY(sprint_id, date)",
  ");",
  "CREATE TABLE IF NOT EXISTS task_comments (",
  "  id TEXT PRIMARY KEY,",
  "  task_id TEXT NOT NULL REFERENCES tasks(id),",
  "  agent_id TEXT REFERENCES agents(id),",
  "  author_name TEXT NOT NULL,",
  "  message TEXT NOT NULL,",
  "  created_at TEXT NOT NULL",
  ");",
  "CREATE TABLE IF NOT EXISTS agent_file_locks (",
  "  id TEXT PRIMARY KEY,",
  "  agent_id TEXT NOT NULL REFERENCES agents(id),",
  "  task_id TEXT NOT NULL REFERENCES tasks(id),",
  "  file_path TEXT NOT NULL,",
  "  started_at TEXT NOT NULL,",
  "  UNIQUE(agent_id, file_path)",
  ");",
  "CREATE TABLE IF NOT EXISTS alert_rules (",
  "  id TEXT PRIMARY KEY,",
  "  event_type TEXT NOT NULL,",
  "  filter_json TEXT NOT NULL DEFAULT '{}',",
  "  enabled INTEGER NOT NULL DEFAULT 1,",
  "  created_at TEXT NOT NULL",
  ");",
  "CREATE TABLE IF NOT EXISTS notifications (",
  "  id TEXT PRIMARY KEY,",
  "  rule_id TEXT REFERENCES alert_rules(id),",
  "  message TEXT NOT NULL,",
  "  read INTEGER NOT NULL DEFAULT 0,",
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

// ─── Task Comments ───────────────────────────────────────────────────────────

export function addComment(
  db: Database.Database,
  taskId: string,
  message: string,
  authorName: string,
  agentId?: string | null
): TaskComment {
  const id = randomUUID();
  const ts = now();
  db.prepare(
    "INSERT INTO task_comments (id, task_id, agent_id, author_name, message, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, taskId, agentId ?? null, authorName, message, ts);
  return db.prepare("SELECT * FROM task_comments WHERE id = ?").get(id) as TaskComment;
}

export function listComments(db: Database.Database, taskId: string): TaskComment[] {
  return db
    .prepare("SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC")
    .all(taskId) as TaskComment[];
}

// ─── Agent File Locks ────────────────────────────────────────────────────────

export function reportWorkingOn(
  db: Database.Database,
  agentId: string,
  taskId: string,
  filePaths: string[]
): AgentFileLock[] {
  const ts = now();
  const locks: AgentFileLock[] = [];
  for (const fp of filePaths) {
    const id = randomUUID();
    db.prepare(
      "INSERT OR REPLACE INTO agent_file_locks (id, agent_id, task_id, file_path, started_at) VALUES (?, ?, ?, ?, ?)"
    ).run(id, agentId, taskId, fp, ts);
    locks.push(
      db.prepare("SELECT * FROM agent_file_locks WHERE agent_id = ? AND file_path = ?").get(agentId, fp) as AgentFileLock
    );
  }
  return locks;
}

export function releaseFileLocks(db: Database.Database, agentId: string, taskId?: string): number {
  if (taskId) {
    return db.prepare("DELETE FROM agent_file_locks WHERE agent_id = ? AND task_id = ?").run(agentId, taskId).changes;
  }
  return db.prepare("DELETE FROM agent_file_locks WHERE agent_id = ?").run(agentId).changes;
}

export function getActiveFileLocks(db: Database.Database): AgentFileLock[] {
  return db.prepare("SELECT * FROM agent_file_locks ORDER BY started_at DESC").all() as AgentFileLock[];
}

export function getFileConflicts(db: Database.Database): FileConflict[] {
  const rows = db.prepare(
    `SELECT fl.file_path, fl.agent_id, a.name AS agent_name, fl.task_id
     FROM agent_file_locks fl
     JOIN agents a ON fl.agent_id = a.id
     WHERE fl.file_path IN (
       SELECT file_path FROM agent_file_locks GROUP BY file_path HAVING COUNT(DISTINCT agent_id) > 1
     )
     ORDER BY fl.file_path, a.name`
  ).all() as { file_path: string; agent_id: string; agent_name: string; task_id: string }[];

  const map = new Map<string, FileConflict>();
  for (const row of rows) {
    if (!map.has(row.file_path)) {
      map.set(row.file_path, { file_path: row.file_path, agents: [] });
    }
    map.get(row.file_path)!.agents.push({
      agent_id: row.agent_id,
      agent_name: row.agent_name,
      task_id: row.task_id,
    });
  }
  return [...map.values()];
}

// ─── Alert Rules & Notifications ─────────────────────────────────────────────

export function createAlertRule(
  db: Database.Database,
  eventType: string,
  filterJson = "{}"
): AlertRule {
  const id = randomUUID();
  const ts = now();
  db.prepare(
    "INSERT INTO alert_rules (id, event_type, filter_json, enabled, created_at) VALUES (?, ?, ?, 1, ?)"
  ).run(id, eventType, filterJson, ts);
  return db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(id) as AlertRule;
}

export function listAlertRules(db: Database.Database): AlertRule[] {
  return db.prepare("SELECT * FROM alert_rules ORDER BY created_at DESC").all() as AlertRule[];
}

export function toggleAlertRule(db: Database.Database, id: string, enabled: boolean): AlertRule | null {
  db.prepare("UPDATE alert_rules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  return db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(id) as AlertRule | null;
}

export function deleteAlertRule(db: Database.Database, id: string): boolean {
  return db.prepare("DELETE FROM alert_rules WHERE id = ?").run(id).changes > 0;
}

export function createNotification(db: Database.Database, message: string, ruleId?: string | null): AppNotification {
  const id = randomUUID();
  const ts = now();
  db.prepare(
    "INSERT INTO notifications (id, rule_id, message, read, created_at) VALUES (?, ?, ?, 0, ?)"
  ).run(id, ruleId ?? null, message, ts);
  return db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as AppNotification;
}

export function listNotifications(db: Database.Database, limit = 50): AppNotification[] {
  return db
    .prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?")
    .all(limit) as AppNotification[];
}

export function markNotificationRead(db: Database.Database, id: string): boolean {
  return db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(id).changes > 0;
}

export function markAllNotificationsRead(db: Database.Database): number {
  return db.prepare("UPDATE notifications SET read = 1 WHERE read = 0").run().changes;
}

export function getUnreadNotificationCount(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE read = 0").get() as { count: number };
  return row.count;
}

export function evaluateAlertRules(db: Database.Database, eventType: string, eventPayload: Record<string, unknown>): AppNotification[] {
  const rules = db
    .prepare("SELECT * FROM alert_rules WHERE event_type = ? AND enabled = 1")
    .all(eventType) as AlertRule[];

  const notifications: AppNotification[] = [];
  for (const rule of rules) {
    let filterMatch = true;
    try {
      const filter = JSON.parse(rule.filter_json) as Record<string, unknown>;
      for (const [key, value] of Object.entries(filter)) {
        if (eventPayload[key] !== value) { filterMatch = false; break; }
      }
    } catch { filterMatch = true; }

    if (filterMatch) {
      const msg = `Alert: ${eventType} event triggered (rule ${rule.id})`;
      notifications.push(createNotification(db, msg, rule.id));
    }
  }
  return notifications;
}

// ─── Bulk Update ─────────────────────────────────────────────────────────────

export function bulkUpdateTasks(
  db: Database.Database,
  taskIds: string[],
  updates: UpdateTaskInput
): Task[] {
  const results: Task[] = [];
  for (const id of taskIds) {
    const updated = updateTask(db, id, updates);
    if (updated) results.push(updated);
  }
  return results;
}

// ─── Agent Performance Metrics ───────────────────────────────────────────────

export function getAgentStats(db: Database.Database, agentId: string, sprintId?: string): AgentStats {
  // Total completed
  const totalRow = db.prepare(
    "SELECT COUNT(DISTINCT t.id) AS c FROM activity_log a JOIN tasks t ON a.task_id = t.id WHERE a.agent_id = ? AND t.status = 'done'"
  ).get(agentId) as { c: number };

  // Sprint completed
  let sprintCompleted = 0;
  if (sprintId) {
    const row = db.prepare(
      "SELECT COUNT(DISTINCT t.id) AS c FROM activity_log a JOIN tasks t ON a.task_id = t.id WHERE a.agent_id = ? AND t.sprint_id = ? AND t.status = 'done'"
    ).get(agentId, sprintId) as { c: number };
    sprintCompleted = row.c;
  }

  // Today completed
  const todayCompleted = getAgentCompletedToday(db, agentId);

  // Avg completion time: avg delta between first activity and task updated_at for done tasks
  const avgRow = db.prepare(
    `SELECT AVG(completion_sec) AS avg_sec FROM (
      SELECT (julianday(t.updated_at) - julianday(MIN(a.timestamp))) * 86400 AS completion_sec
      FROM activity_log a
      JOIN tasks t ON a.task_id = t.id
      WHERE a.agent_id = ? AND t.status = 'done'
      GROUP BY t.id
    )`
  ).get(agentId) as { avg_sec: number | null } | undefined;
  const avgCompletionTime = avgRow?.avg_sec != null ? Math.round(avgRow.avg_sec) : null;

  // Blocker rate
  const totalTasks = db.prepare(
    "SELECT COUNT(DISTINCT t.id) AS c FROM activity_log a JOIN tasks t ON a.task_id = t.id WHERE a.agent_id = ?"
  ).get(agentId) as { c: number };
  const blockedTasks = db.prepare(
    "SELECT COUNT(DISTINCT b.task_id) AS c FROM blockers b JOIN activity_log a ON b.task_id = a.task_id WHERE a.agent_id = ?"
  ).get(agentId) as { c: number };
  const blockerRate = totalTasks.c > 0 ? blockedTasks.c / totalTasks.c : 0;

  // Activity frequency (events per hour while active — using sessions)
  const sessions = listAgentSessions(db, agentId);
  let totalActivityCount = 0;
  let totalSessionHours = 0;
  for (const s of sessions) {
    totalActivityCount += s.activity_count;
    const start = new Date(s.started_at).getTime();
    const end = s.ended_at ? new Date(s.ended_at).getTime() : new Date(s.last_activity_at).getTime();
    totalSessionHours += Math.max((end - start) / 3600000, 0.01); // min 0.01h to avoid div/0
  }
  const activityFrequency = totalSessionHours > 0 ? Math.round((totalActivityCount / totalSessionHours) * 10) / 10 : 0;

  return {
    agent_id: agentId,
    tasks_completed_total: totalRow.c,
    tasks_completed_sprint: sprintCompleted,
    tasks_completed_today: todayCompleted,
    avg_completion_time_seconds: avgCompletionTime,
    blocker_rate: Math.round(blockerRate * 1000) / 1000,
    activity_frequency: activityFrequency,
  };
}

export function getSprintAgentContributions(db: Database.Database, sprintId: string): AgentContribution[] {
  const rows = db.prepare(
    `SELECT a.id AS agent_id, a.name AS agent_name,
       COUNT(t.id) AS completed_count,
       COALESCE(SUM(t.estimate), 0) AS completed_points
     FROM tasks t
     JOIN agents a ON t.assigned_agent_id = a.id
     WHERE t.sprint_id = ? AND t.status = 'done'
     GROUP BY a.id, a.name
     ORDER BY completed_count DESC`
  ).all(sprintId) as AgentContribution[];
  return rows;
}

// ─── Sprint Daily Stats & Velocity ───────────────────────────────────────────

export function recordDailyStats(db: Database.Database, sprintId: string): SprintDailyStats {
  const today = new Date().toISOString().slice(0, 10);
  const cap = getSprintCapacity(db, sprintId);

  db.prepare(
    `INSERT OR REPLACE INTO sprint_daily_stats (sprint_id, date, completed_points, remaining_points, completed_tasks, remaining_tasks)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sprintId, today, cap.completed_points, cap.remaining_points, cap.completed_count, cap.task_count - cap.completed_count);

  return db.prepare("SELECT * FROM sprint_daily_stats WHERE sprint_id = ? AND date = ?").get(sprintId, today) as SprintDailyStats;
}

export function getSprintDailyStats(db: Database.Database, sprintId: string): SprintDailyStats[] {
  return db
    .prepare("SELECT * FROM sprint_daily_stats WHERE sprint_id = ? ORDER BY date ASC")
    .all(sprintId) as SprintDailyStats[];
}

export function getVelocityTrend(db: Database.Database, limit = 5): VelocityData[] {
  return db.prepare(
    `SELECT s.id AS sprint_id, s.name AS sprint_name,
       COALESCE(SUM(CASE WHEN t.status = 'done' THEN t.estimate ELSE 0 END), 0) AS completed_points,
       COUNT(CASE WHEN t.status = 'done' THEN 1 END) AS completed_tasks
     FROM sprints s
     LEFT JOIN tasks t ON t.sprint_id = s.id
     WHERE s.status = 'completed'
     GROUP BY s.id, s.name
     ORDER BY s.created_at DESC
     LIMIT ?`
  ).all(limit) as VelocityData[];
}

// ─── Activity Heatmap ────────────────────────────────────────────────────────

export function getAgentActivityHeatmap(db: Database.Database): ActivityHeatmapEntry[] {
  return db.prepare(
    `SELECT CAST(strftime('%H', a.timestamp) AS INTEGER) AS hour,
       a.agent_id, ag.name AS agent_name, COUNT(*) AS count
     FROM activity_log a
     JOIN agents ag ON a.agent_id = ag.id
     GROUP BY hour, a.agent_id, ag.name
     ORDER BY hour ASC, count DESC`
  ).all() as ActivityHeatmapEntry[];
}

// ─── Report Generation ───────────────────────────────────────────────────────

export function generateReport(db: Database.Database, projectId: string, period: "day" | "week" | "sprint"): string {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Project | undefined;
  if (!project) return "# Report\n\nProject not found.";

  const now_ts = new Date();
  let sinceDate: string;
  if (period === "day") {
    sinceDate = new Date(now_ts.getTime() - 24 * 60 * 60 * 1000).toISOString();
  } else if (period === "week") {
    sinceDate = new Date(now_ts.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    sinceDate = new Date(now_ts.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  // Tasks completed in period
  const completedTasks = db.prepare(
    "SELECT * FROM tasks WHERE project_id = ? AND status = 'done' AND updated_at >= ? ORDER BY updated_at DESC"
  ).all(projectId, sinceDate) as Task[];

  // Blockers in period
  const blockers = db.prepare(
    "SELECT * FROM blockers WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?) AND reported_at >= ? ORDER BY reported_at DESC"
  ).all(projectId, sinceDate) as Blocker[];

  // Active agents
  const agents = listAgents(db);
  const activeAgents = agents.filter(a => {
    const elapsed = now_ts.getTime() - new Date(a.last_seen_at).getTime();
    return elapsed < 30 * 60 * 1000;
  });

  // Sprint progress
  const sprints = listSprints(db, projectId);
  const activeSprint = sprints.find(s => s.status === "active");
  let sprintSection = "";
  if (activeSprint) {
    const cap = getSprintCapacity(db, activeSprint.id);
    sprintSection = `## Sprint: ${activeSprint.name}\n- Tasks: ${cap.completed_count}/${cap.task_count} done\n- Points: ${cap.completed_points}/${cap.total_estimated} completed\n- Remaining: ${cap.remaining_points} points\n`;
  }

  const lines = [
    `# Status Report: ${project.name}`,
    `**Period:** ${period} | **Generated:** ${now_ts.toISOString().slice(0, 16)}`,
    "",
    sprintSection,
    `## Tasks Completed (${completedTasks.length})`,
    ...completedTasks.slice(0, 20).map(t => `- ${t.title}${t.estimate ? ` (${t.estimate}pt)` : ""}`),
    "",
    `## Blockers (${blockers.length})`,
    blockers.length === 0 ? "- None" : "",
    ...blockers.slice(0, 10).map(b => `- ${b.reason}${b.resolved_at ? " (resolved)" : " **unresolved**"}`),
    "",
    `## Agents (${activeAgents.length} active / ${agents.length} total)`,
    ...agents.map(a => `- ${a.name}: ${getAgentHealthStatus(a.last_seen_at)}`),
  ];

  return lines.filter(l => l !== undefined).join("\n");
}
