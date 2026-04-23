import Database from "better-sqlite3";
import { seedBuiltInTemplates } from "./templates.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS projects (",
  "  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,",
  "  created_at TEXT NOT NULL, updated_at TEXT NOT NULL",
  ");",
  "CREATE TABLE IF NOT EXISTS milestones (",
  "  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),",
  "  name TEXT NOT NULL, description TEXT,",
  "  acceptance_criteria TEXT NOT NULL DEFAULT '[]',",
  "  target_date TEXT,",
  "  status TEXT NOT NULL DEFAULT 'open',",
  "  created_at TEXT NOT NULL, updated_at TEXT NOT NULL",
  ");",
  "CREATE TABLE IF NOT EXISTS tasks (",
  "  id TEXT PRIMARY KEY,",
  "  project_id TEXT NOT NULL REFERENCES projects(id),",
  "  parent_task_id TEXT REFERENCES tasks(id),",
  "  milestone_id TEXT REFERENCES milestones(id),",
  "  assigned_agent_id TEXT REFERENCES agents(id),",
  "  title TEXT NOT NULL, description TEXT,",
  "  status TEXT NOT NULL DEFAULT 'planned',",
  "  priority TEXT NOT NULL DEFAULT 'medium',",
  "  progress INTEGER NOT NULL DEFAULT 0,",
  "  due_date TEXT,",
  "  start_date TEXT,",
  "  estimate INTEGER,",
  "  recurrence_rule TEXT,",
  "  task_type TEXT,",
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
  "CREATE TABLE IF NOT EXISTS milestone_daily_stats (",
  "  milestone_id TEXT NOT NULL REFERENCES milestones(id),",
  "  date TEXT NOT NULL,",
  "  completed_tasks INTEGER NOT NULL DEFAULT 0,",
  "  total_tasks INTEGER NOT NULL DEFAULT 0,",
  "  completion_pct REAL NOT NULL DEFAULT 0,",
  "  PRIMARY KEY(milestone_id, date)",
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
  "CREATE INDEX IF NOT EXISTS idx_milestones_project_id ON milestones(project_id);",
  "CREATE TABLE IF NOT EXISTS cost_entries (",
  "  id TEXT PRIMARY KEY,",
  "  agent_id TEXT REFERENCES agents(id),",
  "  task_id TEXT REFERENCES tasks(id),",
  "  milestone_id TEXT REFERENCES milestones(id),",
  "  project_id TEXT REFERENCES projects(id),",
  "  model TEXT NOT NULL,",
  "  provider TEXT NOT NULL,",
  "  input_tokens INTEGER NOT NULL DEFAULT 0,",
  "  output_tokens INTEGER NOT NULL DEFAULT 0,",
  "  cost_usd REAL NOT NULL DEFAULT 0,",
  "  created_at TEXT NOT NULL",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_cost_entries_agent_id ON cost_entries(agent_id);",
  "CREATE INDEX IF NOT EXISTS idx_cost_entries_project_id ON cost_entries(project_id);",
  "CREATE INDEX IF NOT EXISTS idx_cost_entries_created_at ON cost_entries(created_at);",

  "CREATE TABLE IF NOT EXISTS task_reviews (",
  "  id TEXT PRIMARY KEY,",
  "  task_id TEXT NOT NULL REFERENCES tasks(id),",
  "  reviewer_agent_id TEXT REFERENCES agents(id),",
  "  reviewer_name TEXT NOT NULL,",
  "  status TEXT NOT NULL DEFAULT 'pending',",
  "  comments TEXT,",
  "  diff_summary TEXT,",
  "  created_at TEXT NOT NULL,",
  "  updated_at TEXT NOT NULL",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_task_reviews_task_id ON task_reviews(task_id);",
  "CREATE INDEX IF NOT EXISTS idx_task_reviews_reviewer ON task_reviews(reviewer_agent_id);",

  "CREATE TABLE IF NOT EXISTS completion_metrics (",
  "  id TEXT PRIMARY KEY,",
  "  task_id TEXT NOT NULL REFERENCES tasks(id),",
  "  agent_id TEXT NOT NULL REFERENCES agents(id),",
  "  lines_added INTEGER NOT NULL DEFAULT 0,",
  "  lines_removed INTEGER NOT NULL DEFAULT 0,",
  "  files_changed INTEGER NOT NULL DEFAULT 0,",
  "  tests_added INTEGER NOT NULL DEFAULT 0,",
  "  tests_passing INTEGER NOT NULL DEFAULT 0,",
  "  duration_seconds INTEGER NOT NULL DEFAULT 0,",
  "  created_at TEXT NOT NULL",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_completion_metrics_agent_id ON completion_metrics(agent_id);",
  "CREATE INDEX IF NOT EXISTS idx_completion_metrics_task_id ON completion_metrics(task_id);",

  // Foreign-key indexes for query performance (columns from CREATE TABLE only)
  "CREATE INDEX IF NOT EXISTS idx_activity_log_agent_id ON activity_log(agent_id);",
  "CREATE INDEX IF NOT EXISTS idx_activity_log_task_id ON activity_log(task_id);",
  "CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp);",
  "CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);",
  "CREATE INDEX IF NOT EXISTS idx_blockers_task_id ON blockers(task_id);",
  "CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent_id ON agent_sessions(agent_id);",
  "CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);",
  "CREATE INDEX IF NOT EXISTS idx_agent_file_locks_agent_id ON agent_file_locks(agent_id);",
  "CREATE INDEX IF NOT EXISTS idx_notifications_rule_id ON notifications(rule_id);",
  "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);",
  "CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);",
  // task_tags.task_id and task_dependencies.task_id are covered by the UNIQUE
  // composite indexes (leftmost prefix). Only index the non-leftmost columns.
  "CREATE INDEX IF NOT EXISTS idx_task_tags_tag_id ON task_tags(tag_id);",
  "CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);",
  "CREATE INDEX IF NOT EXISTS idx_tags_project_id ON tags(project_id);",
  "CREATE INDEX IF NOT EXISTS idx_task_comments_agent_id ON task_comments(agent_id);",
  "CREATE INDEX IF NOT EXISTS idx_agent_file_locks_task_id ON agent_file_locks(task_id);",
  "CREATE INDEX IF NOT EXISTS idx_cost_entries_task_id ON cost_entries(task_id);",
  "CREATE INDEX IF NOT EXISTS idx_completion_metrics_created_at ON completion_metrics(created_at);",
  "CREATE INDEX IF NOT EXISTS idx_blockers_resolved_at ON blockers(resolved_at);",

  "CREATE TABLE IF NOT EXISTS task_worktrees (",
  "  id TEXT PRIMARY KEY,",
  "  task_id TEXT NOT NULL REFERENCES tasks(id),",
  "  repo_path TEXT NOT NULL,",
  "  branch_name TEXT NOT NULL,",
  "  worktree_path TEXT NOT NULL,",
  "  status TEXT NOT NULL DEFAULT 'active',",
  "  created_at TEXT NOT NULL,",
  "  updated_at TEXT NOT NULL",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_task_worktrees_task_id ON task_worktrees(task_id);",
  "CREATE INDEX IF NOT EXISTS idx_task_worktrees_status ON task_worktrees(status);",
].join("\n");

function migrate(db: Database.Database): void {
  const cols = db.pragma("table_info(tasks)") as { name: string }[];
  if (!cols.some((c) => c.name === "milestone_id")) {
    // Legacy migration: rename sprint_id → milestone_id if it exists
    if (cols.some((c) => c.name === "sprint_id")) {
      db.prepare("ALTER TABLE tasks RENAME COLUMN sprint_id TO milestone_id").run();
    } else {
      db.prepare("ALTER TABLE tasks ADD COLUMN milestone_id TEXT REFERENCES milestones(id)").run();
    }
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
  if (!cols.some((c) => c.name === "task_type")) {
    db.prepare("ALTER TABLE tasks ADD COLUMN task_type TEXT").run();
  }

  const agentCols = db.pragma("table_info(agents)") as { name: string }[];
  if (!agentCols.some((c) => c.name === "role")) {
    db.prepare("ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'agent'").run();
  }
  if (!agentCols.some((c) => c.name === "parent_agent_id")) {
    db.prepare("ALTER TABLE agents ADD COLUMN parent_agent_id TEXT REFERENCES agents(id)").run();
  }

  // Fix: `ALTER TABLE tasks RENAME COLUMN sprint_id TO milestone_id` leaves the
  // FK still pointing at sprints(id). If sprints has been dropped this causes
  // every insert to fail. Detect via foreign_key_list and rebuild if needed.
  rebuildTasksIfFkStale(db);

  // Migrate sprints → milestones if legacy sprints table exists
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sprints'").all();
  if (tables.length > 0) {
    const milestoneCount = (db.prepare("SELECT COUNT(*) AS c FROM milestones").get() as { c: number }).c;
    if (milestoneCount === 0) {
      db.prepare(
        `INSERT INTO milestones (id, project_id, name, description, acceptance_criteria, target_date, status, created_at, updated_at)
         SELECT id, project_id, name, description, '[]', end_date,
           CASE WHEN status = 'completed' THEN 'achieved' ELSE 'open' END,
           created_at, updated_at
         FROM sprints`
      ).run();
    }
    // Migrate cost_entries sprint_id → milestone_id if needed
    const costCols = db.pragma("table_info(cost_entries)") as { name: string }[];
    if (costCols.some((c) => c.name === "sprint_id") && !costCols.some((c) => c.name === "milestone_id")) {
      db.prepare("ALTER TABLE cost_entries RENAME COLUMN sprint_id TO milestone_id").run();
    }

    // Migrate sprint_daily_stats → milestone_daily_stats if it exists
    const hasSDS = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sprint_daily_stats'").all();
    if (hasSDS.length > 0) {
      const mdCount = (db.prepare("SELECT COUNT(*) AS c FROM milestone_daily_stats").get() as { c: number }).c;
      if (mdCount === 0) {
        db.prepare(
          `INSERT INTO milestone_daily_stats (milestone_id, date, completed_tasks, total_tasks, completion_pct)
           SELECT sprint_id, date, completed_tasks,
             completed_tasks + remaining_tasks,
             CASE WHEN (completed_tasks + remaining_tasks) > 0
               THEN ROUND(completed_tasks * 100.0 / (completed_tasks + remaining_tasks), 1)
               ELSE 0 END
           FROM sprint_daily_stats`
        ).run();
      }
    }
  }
}

interface ForeignKeyRow { id: number; seq: number; table: string; from: string; to: string; on_update: string; on_delete: string; match: string }

function rebuildTasksIfFkStale(db: Database.Database): void {
  const fks = db.pragma("foreign_key_list(tasks)") as ForeignKeyRow[];
  const hasStaleSprintFk = fks.some((fk) => fk.from === "milestone_id" && fk.table === "sprints");
  if (!hasStaleSprintFk) return;

  // Rebuild tasks with correct FK target. Must run with foreign_keys OFF.
  const fkWasOn = (db.pragma("foreign_keys", { simple: true }) as number) === 1;
  if (fkWasOn) db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      BEGIN;
      CREATE TABLE tasks_new (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        parent_task_id TEXT REFERENCES tasks(id),
        milestone_id TEXT REFERENCES milestones(id),
        assigned_agent_id TEXT REFERENCES agents(id),
        title TEXT NOT NULL, description TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        priority TEXT NOT NULL DEFAULT 'medium',
        progress INTEGER NOT NULL DEFAULT 0,
        due_date TEXT,
        start_date TEXT,
        estimate INTEGER,
        recurrence_rule TEXT,
        task_type TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO tasks_new
        (id, project_id, parent_task_id, milestone_id, assigned_agent_id,
         title, description, status, priority, progress,
         due_date, start_date, estimate, recurrence_rule, task_type, created_at, updated_at)
      SELECT id, project_id, parent_task_id, milestone_id, assigned_agent_id,
         title, description, status, priority, progress,
         due_date, start_date, estimate, recurrence_rule, task_type, created_at, updated_at
      FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
      COMMIT;
    `);
  } finally {
    if (fkWasOn) db.pragma("foreign_keys = ON");
  }
}

// Indexes on columns added by migrate() — must run after ALTER TABLEs
const POST_MIGRATE_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_tasks_milestone_id ON tasks(milestone_id);",
  "CREATE INDEX IF NOT EXISTS idx_tasks_assigned_agent_id ON tasks(assigned_agent_id);",
  "CREATE INDEX IF NOT EXISTS idx_cost_entries_milestone_id ON cost_entries(milestone_id);",
].join("\n");

export function initDb(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  db.exec(POST_MIGRATE_INDEXES);
  seedBuiltInTemplates(db);
}

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  initDb(db);
  return db;
}
