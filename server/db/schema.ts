import Database from "better-sqlite3";
import { seedBuiltInTemplates } from "./templates.js";

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
  "CREATE TABLE IF NOT EXISTS webhooks (",
  "  id TEXT PRIMARY KEY,",
  "  url TEXT NOT NULL,",
  "  event_types TEXT NOT NULL DEFAULT '[]',",
  "  active INTEGER NOT NULL DEFAULT 1,",
  "  created_at TEXT NOT NULL",
  ");",
  "CREATE TABLE IF NOT EXISTS project_templates (",
  "  id TEXT PRIMARY KEY,",
  "  name TEXT NOT NULL UNIQUE,",
  "  description TEXT,",
  "  template_json TEXT NOT NULL,",
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
  "CREATE TABLE IF NOT EXISTS cost_entries (",
  "  id TEXT PRIMARY KEY,",
  "  agent_id TEXT REFERENCES agents(id),",
  "  task_id TEXT REFERENCES tasks(id),",
  "  sprint_id TEXT REFERENCES sprints(id),",
  "  project_id TEXT REFERENCES projects(id),",
  "  model TEXT NOT NULL,",
  "  provider TEXT NOT NULL,",
  "  input_tokens INTEGER NOT NULL DEFAULT 0,",
  "  output_tokens INTEGER NOT NULL DEFAULT 0,",
  "  cost_usd REAL NOT NULL DEFAULT 0,",
  "  created_at TEXT NOT NULL",
  ");",
].join("\n");

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
  if (!cols.some((c) => c.name === "recurrence_rule")) {
    db.prepare("ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT").run();
  }
  if (!cols.some((c) => c.name === "start_date")) {
    db.prepare("ALTER TABLE tasks ADD COLUMN start_date TEXT").run();
  }

  const agentCols = db.pragma("table_info(agents)") as { name: string }[];
  if (!agentCols.some((c) => c.name === "role")) {
    db.prepare("ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'agent'").run();
  }
  if (!agentCols.some((c) => c.name === "parent_agent_id")) {
    db.prepare("ALTER TABLE agents ADD COLUMN parent_agent_id TEXT REFERENCES agents(id)").run();
  }
}

export function initDb(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  seedBuiltInTemplates(db);
}

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  initDb(db);
  return db;
}
