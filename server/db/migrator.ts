import Database from "better-sqlite3";
import {
  preMigrationFolder,
  preMigrationSnapshotDir,
  SnapshotError,
  takePreMigrationSnapshot,
  type PreMigrationSnapshot,
} from "./snapshot.js";

export interface Migration {
  name: string;
  /**
   * Run with foreign-key enforcement switched off: for a migration that
   * rebuilds a table other tables reference, SQLite's documented procedure
   * for a change ALTER TABLE cannot make ("Making Other Kinds Of Table Schema
   * Changes", https://www.sqlite.org/lang_altertable.html). DROP TABLE on a
   * referenced table fails under enforcement, and the pragma is inert inside
   * a transaction, which is where every migration runs, so the runner turns
   * it off before BEGIN and back on after COMMIT. In exchange it rolls the
   * migration back if foreign_key_check then finds a violation that was not
   * there before (DATA-7). Violations that were already there are left
   * alone: refusing to start over them would make the database unopenable,
   * the failure 020's comment describes. The comparison is row by row, so
   * such a migration must keep every row's rowid (027 copies it explicitly).
   */
  foreignKeysOff?: boolean;
  /**
   * For a foreignKeysOff migration: whether it has anything to do on this
   * database. When this returns false the migration is recorded without
   * switching enforcement off or running foreign_key_check, which reads every
   * table and throws outright on some salvaged schemas, so a migration with
   * nothing to do can never be what stops an install from starting.
   */
  isNeeded?: (db: Database.Database) => boolean;
  /** May return warnings for the entry point to log; the db layer never logs itself. */
  run: (db: Database.Database) => string[] | void;
}

/**
 * Set this to bypass the newer-database guard in `runMigrations()`.
 *
 * Escape hatch for the legitimate case: checking out an older revision to debug
 * while the shared database has already been migrated forward. Expect raw SQL
 * errors on any table the older code doesn't know about.
 */
const DRIFT_OVERRIDE_ENV = "VIBE_DASH_ALLOW_SCHEMA_DRIFT";

/**
 * Explicit `busy_timeout`, in milliseconds, applied to every SQLite connection
 * this codebase opens (server, stdio MCP, CLI, tests). better-sqlite3's own
 * default happens to be the same 5000ms, but spelling it out here means it no
 * longer depends on that default holding across a driver upgrade, and gives
 * one named place to change it (DATA-15).
 */
export const DB_BUSY_TIMEOUT_MS = 5000;

/**
 * Thrown when the database records migrations this build has never heard of,
 * which means it was written by a NEWER Vibe Dash than the one now opening it.
 *
 * Distinct from a corrupt or unreadable database so callers can tell the user
 * to update rather than to check their path.
 */
export class SchemaTooNewError extends Error {
  readonly unknownMigrations: string[];

  constructor(unknownMigrations: string[]) {
    const count = unknownMigrations.length;
    super(
      `Database schema is newer than this build: ${count} migration${count === 1 ? "" : "s"} ` +
        `applied that this code doesn't know about (${unknownMigrations.join(", ")}). ` +
        `It was written by a newer version of Vibe Dash — update this install. ` +
        `To proceed anyway, set ${DRIFT_OVERRIDE_ENV}=1 (expect SQL errors for missing columns).`
    );
    this.name = "SchemaTooNewError";
    this.unknownMigrations = unknownMigrations;
  }
}

/**
 * Thrown when a caller that must never run migrations (the CLI — DATA-5,
 * ARCH-11) finds the database behind the build's own migration list. Distinct
 * from `SchemaTooNewError` so the message points the user the opposite way:
 * start the server (which does own migration authority) rather than update.
 */
export class SchemaBehindError extends Error {
  readonly pendingMigrations: string[];

  constructor(pendingMigrations: string[]) {
    const count = pendingMigrations.length;
    super(
      `Database schema is behind this build: ${count} pending migration${count === 1 ? "" : "s"} ` +
        `(${pendingMigrations.join(", ")}) have not been applied. The CLI never runs migrations ` +
        `itself — start the vibe-dash server once (it applies them on startup), then re-run this command.`
    );
    this.name = "SchemaBehindError";
    this.pendingMigrations = pendingMigrations;
  }
}

/**
 * Thrown when migrations are pending but the snapshot that must precede them
 * could not be written or verified (DATA-1). No migration has been applied
 * when it is thrown: several migrations drop tables or merge rows, so
 * migrating without a way back is exactly what the snapshot exists to prevent.
 *
 * The message points at whichever side actually failed. When the database
 * itself fails `quick_check`, telling the operator to free space in the backup
 * folder would send them after the wrong problem.
 */
export class MigrationSnapshotError extends Error {
  readonly snapshotDir: string;
  readonly pendingMigrations: string[];
  /** `quick_check` findings on the database itself; empty unless it is the database that is damaged. */
  readonly databaseProblems: string[];

  constructor(
    snapshotDir: string,
    pendingMigrations: string[],
    cause: unknown,
    databaseProblems: string[] = []
  ) {
    const count = pendingMigrations.length;
    const refusing = `Refusing to apply ${count} pending migration${count === 1 ? "" : "s"} (${pendingMigrations.join(", ")})`;
    const reason = cause instanceof Error ? cause.message : String(cause);
    const message =
      databaseProblems.length > 0
        ? `${refusing}: the database itself is damaged (quick_check: ${databaseProblems.slice(0, 3).join(" | ")}), ` +
          `so the snapshot that must be taken first failed (${reason}). No migration has been applied. ` +
          `Copy it as it is with \`npm run backup\`, which backs up damaged databases on purpose, then repair it ` +
          `before starting again.`
        : `${refusing}: the snapshot that must be taken first could not be written to ${snapshotDir} (${reason}). ` +
          `No migration has been applied. Free space there, fix its permissions, or set VIBE_DASH_BACKUP_DIR to a ` +
          `writable directory, then start again.`;
    super(message, { cause });
    this.name = "MigrationSnapshotError";
    this.snapshotDir = snapshotDir;
    this.pendingMigrations = pendingMigrations;
    this.databaseProblems = databaseProblems;
  }
}

export interface MigrationOptions {
  /** Where the pre-migration snapshot goes. Defaults to VIBE_DASH_BACKUP_DIR/pre-migration. */
  snapshotDir?: string;
}

export interface MigrationReport {
  /** The migrations this call applied, in order. */
  applied: string[];
  /** The snapshot taken before applying them, or null when none was needed. */
  snapshot: PreMigrationSnapshot | null;
  /**
   * Warnings for the entry point to log: from the migrations applied, each
   * prefixed with its migration's name, and from the unique-index check that
   * runs on every open, which names the index instead.
   */
  warnings: string[];
}

/**
 * The tasks columns as migrations 001-026 leave them (015 dropped
 * recurrence_rule). Frozen, like every migration's SQL: 027 rebuilds tasks at
 * this fixed point in the sequence, so any column a later migration adds is
 * added after the rebuild and can never be dropped by it.
 */
const TASKS_COLUMNS_AT_026 = [
  "id", "project_id", "parent_task_id", "milestone_id", "assigned_agent_id",
  "title", "description", "status", "priority", "progress",
  "due_date", "start_date", "estimate", "task_type", "created_at", "updated_at",
];

interface ExpectedIndex {
  name: string;
  table: string;
  /** Columns the definition reads; the index is skipped if any is missing. */
  columns: string[];
  sql: string;
  /**
   * For a unique index: `count` returns { n }, how many values appear more
   * than once and would make creating it fail; `find` is the query to give an
   * operator for listing them.
   */
  duplicates?: { count: string; find: string };
}

/**
 * Every index migrations 001-026 create, with each definition copied verbatim
 * from the migration that made it, so a restored index is the same index
 * (024 and 025 explain why the julianday expressions must match exactly).
 * Frozen for the same reason TASKS_COLUMNS_AT_026 is.
 */
const INDEXES_AT_026: ExpectedIndex[] = [
  { name: "idx_activity_log_agent_id", table: "activity_log", columns: ["agent_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_activity_log_agent_id ON activity_log(agent_id)" },
  { name: "idx_activity_log_source", table: "activity_log", columns: ["source"],
    sql: "CREATE INDEX IF NOT EXISTS idx_activity_log_source ON activity_log(source)" },
  { name: "idx_activity_log_task_id", table: "activity_log", columns: ["task_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_activity_log_task_id ON activity_log(task_id)" },
  { name: "idx_activity_log_timestamp", table: "activity_log", columns: ["timestamp"],
    sql: "CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp)" },
  { name: "idx_activity_log_timestamp_jd", table: "activity_log", columns: ["timestamp"],
    sql: `CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp_jd
          ON activity_log(julianday(
            CASE WHEN timestamp GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
              THEN timestamp END
          ))` },
  { name: "idx_agent_sessions_agent_id", table: "agent_sessions", columns: ["agent_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent_id ON agent_sessions(agent_id)" },
  { name: "idx_agents_name_normalized", table: "agents", columns: ["name_normalized"],
    sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_name_normalized ON agents(name_normalized)",
    duplicates: {
      count:
        "SELECT COUNT(*) AS n FROM (SELECT 1 FROM agents WHERE name_normalized IS NOT NULL GROUP BY name_normalized HAVING COUNT(*) > 1)",
      find: "SELECT name_normalized, COUNT(*) FROM agents WHERE name_normalized IS NOT NULL GROUP BY name_normalized HAVING COUNT(*) > 1",
    } },
  { name: "idx_blockers_resolved_at", table: "blockers", columns: ["resolved_at"],
    sql: "CREATE INDEX IF NOT EXISTS idx_blockers_resolved_at ON blockers(resolved_at)" },
  { name: "idx_blockers_task_id", table: "blockers", columns: ["task_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_blockers_task_id ON blockers(task_id)" },
  { name: "idx_completion_metrics_agent_id", table: "completion_metrics", columns: ["agent_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_completion_metrics_agent_id ON completion_metrics(agent_id)" },
  { name: "idx_completion_metrics_created_at", table: "completion_metrics", columns: ["created_at"],
    sql: "CREATE INDEX IF NOT EXISTS idx_completion_metrics_created_at ON completion_metrics(created_at)" },
  { name: "idx_completion_metrics_task_id", table: "completion_metrics", columns: ["task_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_completion_metrics_task_id ON completion_metrics(task_id)" },
  { name: "idx_cost_entries_agent_id", table: "cost_entries", columns: ["agent_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_cost_entries_agent_id ON cost_entries(agent_id)" },
  { name: "idx_cost_entries_created_at", table: "cost_entries", columns: ["created_at"],
    sql: "CREATE INDEX IF NOT EXISTS idx_cost_entries_created_at ON cost_entries(created_at)" },
  { name: "idx_cost_entries_created_at_jd", table: "cost_entries", columns: ["created_at"],
    sql: `CREATE INDEX IF NOT EXISTS idx_cost_entries_created_at_jd
          ON cost_entries(julianday(
            CASE WHEN created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
              THEN created_at END
          ))` },
  { name: "idx_cost_entries_external_id", table: "cost_entries", columns: ["external_id"],
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_entries_external_id
          ON cost_entries(external_id) WHERE external_id IS NOT NULL`,
    duplicates: {
      count:
        "SELECT COUNT(*) AS n FROM (SELECT 1 FROM cost_entries WHERE external_id IS NOT NULL GROUP BY external_id HAVING COUNT(*) > 1)",
      find: "SELECT external_id, COUNT(*) FROM cost_entries WHERE external_id IS NOT NULL GROUP BY external_id HAVING COUNT(*) > 1",
    } },
  { name: "idx_cost_entries_milestone_id", table: "cost_entries", columns: ["milestone_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_cost_entries_milestone_id ON cost_entries(milestone_id)" },
  { name: "idx_cost_entries_project_id", table: "cost_entries", columns: ["project_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_cost_entries_project_id ON cost_entries(project_id)" },
  { name: "idx_cost_entries_source", table: "cost_entries", columns: ["source"],
    sql: `CREATE INDEX IF NOT EXISTS idx_cost_entries_source
          ON cost_entries(source)` },
  { name: "idx_cost_entries_task_id", table: "cost_entries", columns: ["task_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_cost_entries_task_id ON cost_entries(task_id)" },
  { name: "idx_milestones_project_id", table: "milestones", columns: ["project_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_milestones_project_id ON milestones(project_id)" },
  { name: "idx_project_paths_project", table: "project_paths", columns: ["project_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_project_paths_project ON project_paths(project_id)" },
  { name: "idx_projects_archived_at", table: "projects", columns: ["archived_at"],
    sql: "CREATE INDEX IF NOT EXISTS idx_projects_archived_at ON projects(archived_at)" },
  { name: "idx_task_dependencies_depends_on", table: "task_dependencies", columns: ["depends_on_task_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id)" },
  { name: "idx_task_worktrees_status", table: "task_worktrees", columns: ["status"],
    sql: "CREATE INDEX IF NOT EXISTS idx_task_worktrees_status ON task_worktrees(status)" },
  { name: "idx_task_worktrees_task_id", table: "task_worktrees", columns: ["task_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_task_worktrees_task_id ON task_worktrees(task_id)" },
  { name: "idx_tasks_assigned_agent_id", table: "tasks", columns: ["assigned_agent_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_tasks_assigned_agent_id ON tasks(assigned_agent_id)" },
  { name: "idx_tasks_milestone_id", table: "tasks", columns: ["milestone_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_tasks_milestone_id ON tasks(milestone_id)" },
  { name: "idx_tasks_priority", table: "tasks", columns: ["priority"],
    sql: "CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority)" },
  { name: "idx_tasks_project_id", table: "tasks", columns: ["project_id"],
    sql: "CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)" },
  { name: "idx_tasks_status", table: "tasks", columns: ["status"],
    sql: "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)" },
];

/** Columns of `table` that are missing, or null when the table itself is. */
function missingColumns(db: Database.Database, table: string, columns: string[]): string[] | null {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!exists) return null;
  const present = new Set((db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name));
  return columns.filter((c) => !present.has(c));
}

/**
 * Create `index` if it is missing and can be. Returns why it could not be,
 * or undefined when it exists afterwards.
 */
function restoreIndex(db: Database.Database, index: ExpectedIndex): string | undefined {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index.name)) {
    return undefined;
  }
  const missing = missingColumns(db, index.table, index.columns);
  if (missing === null) return `${index.name} not created: table ${index.table} does not exist`;
  if (missing.length > 0) return `${index.name} not created: ${index.table} has no ${missing.join(", ")} column`;
  if (index.duplicates) {
    const { n } = db.prepare(index.duplicates.count).get() as { n: number };
    if (n > 0) {
      return (
        `${index.name} is missing: ${n} value${n === 1 ? "" : "s"} in ${index.table}.${index.columns.join(", ")} ` +
        `${n === 1 ? "appears" : "appear"} more than once, so it cannot be created. It will be, on the first start ` +
        `after that is resolved; find them with: ${index.duplicates.find}`
      );
    }
  }
  db.prepare(index.sql).run();
  return undefined;
}

/**
 * The two unique indexes guard correctness, not only speed: without
 * idx_cost_entries_external_id, INSERT OR IGNORE no longer stops a transcript
 * that is read again from being counted twice, and without
 * idx_agents_name_normalized one agent can be registered twice. They are
 * ensured on every open rather than once by a migration, because the one thing
 * that can block them, duplicate values, can be put right by hand later, and
 * the index should then come back by itself. Until it does, every start warns.
 * When the index is there this is one catalogue lookup each.
 */
function ensureUniqueIndexes(db: Database.Database): string[] {
  const warnings: string[] = [];
  for (const index of INDEXES_AT_026.filter((i) => i.duplicates)) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index.name)) continue;
    // Best effort, and never a reason to refuse to start: the count and the
    // create share one write transaction so nothing can slip in between them,
    // and anything that goes wrong (a busy database, a full disk) is reported
    // and tried again next time.
    try {
      const warning = db.transaction(() => restoreIndex(db, index)).immediate();
      if (warning) warnings.push(warning);
    } catch (err) {
      warnings.push(
        `${index.name} is missing and could not be created this time ` +
          `(${err instanceof Error ? err.message : String(err)}); it will be tried again on the next start`
      );
    }
  }
  return warnings;
}

/**
 * Whether tasks.milestone_id still carries the foreign key to sprints that
 * 002's RENAME COLUMN left behind: 027's precondition. Case-insensitive,
 * because SQLite keeps whatever spelling the REFERENCES clause was written in.
 */
function tasksMilestoneKeyIsStale(db: Database.Database): boolean {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get()) return false;
  const fks = db.pragma("foreign_key_list(tasks)") as { from: string; table: string }[];
  return fks.some((fk) => fk.from === "milestone_id" && fk.table.toLowerCase() === "sprints");
}

const MIGRATIONS: Migration[] = [
  {
    name: "001_initial_schema",
    run(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS milestones (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
          name TEXT NOT NULL, description TEXT,
          acceptance_criteria TEXT NOT NULL DEFAULT '[]',
          target_date TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, model TEXT,
          capabilities TEXT NOT NULL DEFAULT '[]',
          role TEXT NOT NULL DEFAULT 'agent',
          parent_agent_id TEXT REFERENCES agents(id),
          registered_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
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
        CREATE TABLE IF NOT EXISTS activity_log (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          agent_id TEXT REFERENCES agents(id),
          message TEXT NOT NULL, timestamp TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS blockers (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          reason TEXT NOT NULL, reported_at TEXT NOT NULL, resolved_at TEXT
        );
        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id),
          name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6366f1',
          created_at TEXT NOT NULL,
          UNIQUE(project_id, name)
        );
        CREATE TABLE IF NOT EXISTS task_tags (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          tag_id TEXT NOT NULL REFERENCES tags(id),
          UNIQUE(task_id, tag_id)
        );
        CREATE TABLE IF NOT EXISTS agent_sessions (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id),
          started_at TEXT NOT NULL, ended_at TEXT,
          last_activity_at TEXT NOT NULL,
          tasks_touched INTEGER NOT NULL DEFAULT 0,
          activity_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS task_dependencies (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          depends_on_task_id TEXT NOT NULL REFERENCES tasks(id),
          created_at TEXT NOT NULL,
          UNIQUE(task_id, depends_on_task_id)
        );
        CREATE TABLE IF NOT EXISTS saved_filters (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          filter_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS webhooks (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          event_types TEXT NOT NULL DEFAULT '[]',
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          template_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS milestone_daily_stats (
          milestone_id TEXT NOT NULL REFERENCES milestones(id),
          date TEXT NOT NULL,
          completed_tasks INTEGER NOT NULL DEFAULT 0,
          total_tasks INTEGER NOT NULL DEFAULT 0,
          completion_pct REAL NOT NULL DEFAULT 0,
          PRIMARY KEY(milestone_id, date)
        );
        CREATE TABLE IF NOT EXISTS task_comments (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          agent_id TEXT REFERENCES agents(id),
          author_name TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agent_file_locks (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id),
          task_id TEXT NOT NULL REFERENCES tasks(id),
          file_path TEXT NOT NULL,
          started_at TEXT NOT NULL,
          UNIQUE(agent_id, file_path)
        );
        CREATE TABLE IF NOT EXISTS alert_rules (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          filter_json TEXT NOT NULL DEFAULT '{}',
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          rule_id TEXT REFERENCES alert_rules(id),
          message TEXT NOT NULL,
          read INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cost_entries (
          id TEXT PRIMARY KEY,
          agent_id TEXT REFERENCES agents(id),
          task_id TEXT REFERENCES tasks(id),
          milestone_id TEXT REFERENCES milestones(id),
          project_id TEXT REFERENCES projects(id),
          model TEXT NOT NULL,
          provider TEXT NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS task_reviews (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          reviewer_agent_id TEXT REFERENCES agents(id),
          reviewer_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          comments TEXT,
          diff_summary TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS completion_metrics (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          agent_id TEXT NOT NULL REFERENCES agents(id),
          lines_added INTEGER NOT NULL DEFAULT 0,
          lines_removed INTEGER NOT NULL DEFAULT 0,
          files_changed INTEGER NOT NULL DEFAULT 0,
          tests_added INTEGER NOT NULL DEFAULT 0,
          tests_passing INTEGER NOT NULL DEFAULT 0,
          duration_seconds INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS task_worktrees (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          repo_path TEXT NOT NULL,
          branch_name TEXT NOT NULL,
          worktree_path TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_milestones_project_id ON milestones(project_id);
        CREATE INDEX IF NOT EXISTS idx_cost_entries_agent_id ON cost_entries(agent_id);
        CREATE INDEX IF NOT EXISTS idx_cost_entries_project_id ON cost_entries(project_id);
        CREATE INDEX IF NOT EXISTS idx_cost_entries_created_at ON cost_entries(created_at);
        CREATE INDEX IF NOT EXISTS idx_task_reviews_task_id ON task_reviews(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_reviews_reviewer ON task_reviews(reviewer_agent_id);
        CREATE INDEX IF NOT EXISTS idx_completion_metrics_agent_id ON completion_metrics(agent_id);
        CREATE INDEX IF NOT EXISTS idx_completion_metrics_task_id ON completion_metrics(task_id);
        CREATE INDEX IF NOT EXISTS idx_activity_log_agent_id ON activity_log(agent_id);
        CREATE INDEX IF NOT EXISTS idx_activity_log_task_id ON activity_log(task_id);
        CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp);
        CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_blockers_task_id ON blockers(task_id);
        CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent_id ON agent_sessions(agent_id);
        CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
        CREATE INDEX IF NOT EXISTS idx_agent_file_locks_agent_id ON agent_file_locks(agent_id);
        CREATE INDEX IF NOT EXISTS idx_notifications_rule_id ON notifications(rule_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
        CREATE INDEX IF NOT EXISTS idx_task_tags_tag_id ON task_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);
        CREATE INDEX IF NOT EXISTS idx_tags_project_id ON tags(project_id);
        CREATE INDEX IF NOT EXISTS idx_task_comments_agent_id ON task_comments(agent_id);
        CREATE INDEX IF NOT EXISTS idx_agent_file_locks_task_id ON agent_file_locks(task_id);
        CREATE INDEX IF NOT EXISTS idx_cost_entries_task_id ON cost_entries(task_id);
        CREATE INDEX IF NOT EXISTS idx_completion_metrics_created_at ON completion_metrics(created_at);
        CREATE INDEX IF NOT EXISTS idx_blockers_resolved_at ON blockers(resolved_at);
        CREATE INDEX IF NOT EXISTS idx_task_worktrees_task_id ON task_worktrees(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_worktrees_status ON task_worktrees(status);
        CREATE INDEX IF NOT EXISTS idx_cost_entries_milestone_id ON cost_entries(milestone_id);
      `);
    },
  },
  {
    name: "002_tasks_columns",
    run(db) {
      const cols = db.pragma("table_info(tasks)") as { name: string }[];
      const has = (n: string) => cols.some((c) => c.name === n);
      if (!has("milestone_id")) {
        if (has("sprint_id")) {
          db.prepare("ALTER TABLE tasks RENAME COLUMN sprint_id TO milestone_id").run();
        } else {
          db.prepare("ALTER TABLE tasks ADD COLUMN milestone_id TEXT REFERENCES milestones(id)").run();
        }
      }
      if (!has("assigned_agent_id")) db.prepare("ALTER TABLE tasks ADD COLUMN assigned_agent_id TEXT REFERENCES agents(id)").run();
      if (!has("due_date")) db.prepare("ALTER TABLE tasks ADD COLUMN due_date TEXT").run();
      if (!has("estimate")) db.prepare("ALTER TABLE tasks ADD COLUMN estimate INTEGER").run();
      if (!has("recurrence_rule")) db.prepare("ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT").run();
      if (!has("start_date")) db.prepare("ALTER TABLE tasks ADD COLUMN start_date TEXT").run();
      if (!has("task_type")) db.prepare("ALTER TABLE tasks ADD COLUMN task_type TEXT").run();
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_milestone_id ON tasks(milestone_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_assigned_agent_id ON tasks(assigned_agent_id);
      `);
    },
  },
  {
    name: "003_agents_columns",
    run(db) {
      const cols = db.pragma("table_info(agents)") as { name: string }[];
      const has = (n: string) => cols.some((c) => c.name === n);
      if (!has("role")) db.prepare("ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'agent'").run();
      if (!has("parent_agent_id")) db.prepare("ALTER TABLE agents ADD COLUMN parent_agent_id TEXT REFERENCES agents(id)").run();
    },
  },
  {
    name: "004_sprints_to_milestones",
    run(db) {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sprints'").all();
      if (tables.length === 0) return;
      const milestoneCount = (db.prepare("SELECT COUNT(*) AS c FROM milestones").get() as { c: number }).c;
      if (milestoneCount === 0) {
        db.prepare(
          `INSERT INTO milestones (id, project_id, name, description, acceptance_criteria, target_date, status, created_at, updated_at)
           SELECT id, project_id, name, description, '[]', end_date,
             CASE WHEN status = 'completed' THEN 'achieved' ELSE 'open' END,
             created_at, updated_at FROM sprints`
        ).run();
      }
      const costCols = db.pragma("table_info(cost_entries)") as { name: string }[];
      if (costCols.some((c) => c.name === "sprint_id") && !costCols.some((c) => c.name === "milestone_id")) {
        db.prepare("ALTER TABLE cost_entries RENAME COLUMN sprint_id TO milestone_id").run();
      }
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
      db.exec("CREATE INDEX IF NOT EXISTS idx_cost_entries_milestone_id ON cost_entries(milestone_id);");
    },
  },
  {
    name: "005_ingestion_and_git_sync",
    run(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ingestion_sources (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          project_id TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          last_event_at TEXT
        );
        CREATE TABLE IF NOT EXISTS ingestion_events (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          received_at TEXT NOT NULL,
          raw_payload TEXT NOT NULL,
          normalized_kind TEXT NOT NULL,
          task_id TEXT,
          agent_id TEXT,
          processed INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_ingestion_events_processed ON ingestion_events(processed);
        CREATE TABLE IF NOT EXISTS git_integrations (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT 'github',
          owner TEXT NOT NULL,
          repo TEXT NOT NULL,
          token TEXT NOT NULL,
          auto_sync INTEGER NOT NULL DEFAULT 1,
          last_synced_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS git_linked_items (
          id TEXT PRIMARY KEY,
          integration_id TEXT NOT NULL,
          task_id TEXT,
          item_type TEXT NOT NULL,
          external_number INTEGER NOT NULL,
          external_id TEXT NOT NULL,
          external_title TEXT NOT NULL,
          external_state TEXT NOT NULL,
          external_url TEXT,
          pr_number INTEGER,
          pr_state TEXT,
          synced_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_git_linked_items_unique ON git_linked_items(integration_id, item_type, external_number);
      `);
    },
  },
  {
    name: "006_users",
    run(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          role TEXT NOT NULL DEFAULT 'viewer',
          api_key_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_users_api_key_hash ON users(api_key_hash);
      `);
    },
  },
  {
    name: "007_agents_name_normalized",
    run(db) {
      const cols = db.pragma("table_info(agents)") as { name: string }[];
      if (!cols.some((c) => c.name === "name_normalized")) {
        db.prepare("ALTER TABLE agents ADD COLUMN name_normalized TEXT").run();
      }
      db.prepare(
        `UPDATE agents SET name_normalized =
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             LOWER(TRIM(REPLACE(REPLACE(name, '_', ' '), '-', ' '))),
           '     ',' '),'    ',' '),'   ',' '),'  ',' '),'  ',' ')
         WHERE name_normalized IS NULL OR name_normalized = ''`
      ).run();
      db.prepare(
        "UPDATE agents SET name_normalized = name WHERE name_normalized IS NULL OR name_normalized = ''"
      ).run();
    },
  },
  {
    name: "008_agents_dedup_normalized",
    run(db) {
      interface DupeRow { name_normalized: string; survivor_id: string }
      const dupes = db.prepare(
        `SELECT name_normalized, id AS survivor_id
         FROM agents
         WHERE rowid IN (
           SELECT MIN(rowid) FROM agents GROUP BY name_normalized HAVING COUNT(*) > 1
         )`
      ).all() as DupeRow[];

      for (const { name_normalized, survivor_id } of dupes) {
        const dups = db.prepare(
          "SELECT id FROM agents WHERE name_normalized = ? AND id != ?"
        ).all(name_normalized, survivor_id) as { id: string }[];

        for (const { id: dupId } of dups) {
          const tables = db.pragma("table_list") as { name: string }[];
          if (tables.some((t) => t.name === "agent_file_locks")) {
            db.prepare(
              "DELETE FROM agent_file_locks WHERE agent_id = ? AND file_path IN (SELECT file_path FROM agent_file_locks WHERE agent_id = ?)"
            ).run(dupId, survivor_id);
          }

          const fkUpdates = [
            "UPDATE activity_log SET agent_id = ? WHERE agent_id = ?",
            "UPDATE agent_sessions SET agent_id = ? WHERE agent_id = ?",
            "UPDATE tasks SET assigned_agent_id = ? WHERE assigned_agent_id = ?",
            "UPDATE cost_entries SET agent_id = ? WHERE agent_id = ?",
            "UPDATE completion_metrics SET agent_id = ? WHERE agent_id = ?",
            "UPDATE task_reviews SET reviewer_agent_id = ? WHERE reviewer_agent_id = ?",
            "UPDATE task_comments SET agent_id = ? WHERE agent_id = ?",
            "UPDATE agents SET parent_agent_id = ? WHERE parent_agent_id = ?",
            "UPDATE ingestion_events SET agent_id = ? WHERE agent_id = ?",
          ];
          for (const sql of fkUpdates) {
            db.prepare(sql).run(survivor_id, dupId);
          }
          db.prepare("DELETE FROM agents WHERE id = ?").run(dupId);
        }
      }

      db.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_name_normalized ON agents(name_normalized)"
      ).run();
    },
  },
  {
    name: "009_activity_source",
    run(db) {
      const cols = db.pragma("table_info(activity_log)") as { name: string }[];
      if (!cols.some((c) => c.name === "source")) {
        db.prepare("ALTER TABLE activity_log ADD COLUMN source TEXT NOT NULL DEFAULT 'internal'").run();
        db.prepare("CREATE INDEX IF NOT EXISTS idx_activity_log_source ON activity_log(source)").run();
      }
    },
  },
  {
    name: "010_drop_saved_filters",
    run(db) {
      const tables = db.pragma("table_list") as { name: string }[];
      if (tables.some((t) => t.name === "saved_filters")) {
        db.prepare("DROP TABLE saved_filters").run();
      }
    },
  },
  {
    name: "011_drop_project_templates",
    run(db) {
      const tables = db.pragma("table_list") as { name: string }[];
      if (tables.some((t) => t.name === "project_templates")) {
        db.prepare("DROP TABLE project_templates").run();
      }
    },
  },
  {
    name: "012_drop_agent_file_locks",
    run(db) {
      const tables = db.pragma("table_list") as { name: string }[];
      if (tables.some((t) => t.name === "agent_file_locks")) {
        db.prepare("DROP TABLE agent_file_locks").run();
      }
    },
  },
  {
    name: "013_drop_alert_rules",
    run(db) {
      const tables = db.pragma("table_list") as { name: string }[];
      const hasAlertRules = tables.some((t) => t.name === "alert_rules");
      if (!hasAlertRules) return;

      if (tables.some((t) => t.name === "notifications")) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS notifications_new (
            id TEXT PRIMARY KEY,
            rule_id TEXT,
            message TEXT NOT NULL,
            read INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
          );
          INSERT INTO notifications_new SELECT id, rule_id, message, read, created_at FROM notifications;
          DROP TABLE notifications;
          ALTER TABLE notifications_new RENAME TO notifications;
        `);
      }
      db.prepare("DROP TABLE alert_rules").run();
    },
  },
  {
    name: "014_commits_and_milestone_history",
    run(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS commits (
          sha TEXT PRIMARY KEY,
          subject TEXT NOT NULL,
          author_email TEXT,
          authored_at TEXT NOT NULL,
          ingested_at TEXT NOT NULL,
          linked_task_id TEXT REFERENCES tasks(id)
        );
        CREATE INDEX IF NOT EXISTS idx_commits_authored_at ON commits(authored_at);
        CREATE INDEX IF NOT EXISTS idx_commits_linked_task_id ON commits(linked_task_id);

        CREATE TABLE IF NOT EXISTS milestone_history (
          id TEXT PRIMARY KEY,
          milestone_id TEXT NOT NULL REFERENCES milestones(id),
          field TEXT NOT NULL,
          old_value TEXT,
          new_value TEXT,
          changed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_milestone_history_milestone_id ON milestone_history(milestone_id);
        CREATE INDEX IF NOT EXISTS idx_milestone_history_changed_at ON milestone_history(changed_at);
      `);
    },
  },
  {
    name: "015_drop_orphan_tables_and_recurrence_column",
    run(db) {
      // Tables orphaned by Phases 1A-1C feature removals. All have only
      // outbound FKs to kept tables, so DROP succeeds under foreign_keys=ON.
      db.exec(`
        DROP TABLE IF EXISTS task_reviews;
        DROP TABLE IF EXISTS webhooks;
        DROP TABLE IF EXISTS commits;
        DROP TABLE IF EXISTS milestone_history;
        DROP TABLE IF EXISTS git_linked_items;
        DROP TABLE IF EXISTS git_integrations;
        DROP TABLE IF EXISTS ingestion_events;
        DROP TABLE IF EXISTS ingestion_sources;
        DROP TABLE IF EXISTS users;
      `);
      // Orphan column from the 1A recurring-tasks removal. SQLite has no
      // DROP COLUMN IF EXISTS, but this migration runs once and the column
      // exists by migrations 001/002. No index/trigger references it.
      db.exec(`ALTER TABLE tasks DROP COLUMN recurrence_rule;`);
    },
  },
  {
    name: "016_agent_current_status",
    run(db) {
      const cols = db.pragma("table_info(agents)") as { name: string }[];
      const has = (n: string) => cols.some((c) => c.name === n);
      if (!has("current_status")) db.prepare("ALTER TABLE agents ADD COLUMN current_status TEXT").run();
      if (!has("current_status_at")) db.prepare("ALTER TABLE agents ADD COLUMN current_status_at TEXT").run();
    },
  },
  {
    name: "017_drop_tags",
    run(db) {
      // Tags feature removed: it had REST endpoints + a human-only UI but no
      // MCP tool, so no agent ever wrote tags — dead weight against the
      // agent-first premise. Forward-only drop; existing tag rows are discarded.
      // Drop task_tags first (it FKs to tags) so the drop succeeds under
      // foreign_keys=ON. Dropping a table also drops its indexes.
      db.exec(`
        DROP TABLE IF EXISTS task_tags;
        DROP TABLE IF EXISTS tags;
      `);
    },
  },
  {
    name: "018_drop_comments_notifications",
    run(db) {
      // Comments + notifications removed together: both had REST endpoints but
      // no MCP tool, and notifications were only ever generated by comment
      // @mentions, so the two die as a unit. Neither is part of any agent
      // workflow. Forward-only drop; existing rows are discarded. Neither
      // table has inbound FKs, so drop order is unconstrained.
      db.exec(`
        DROP TABLE IF EXISTS task_comments;
        DROP TABLE IF EXISTS notifications;
      `);
    },
  },
  {
    name: "019_transcript_ingestion",
    run(db) {
      // Cost rows now come from two places: an agent calling log_cost ('mcp')
      // and Claude Code transcripts read off disk ('transcript'). The source
      // column records which, so a row's provenance is auditable and a future
      // change can filter or reconcile on it.
      //
      // On its own, a Claude Code session that both calls log_cost and gets
      // its transcript ingested is counted twice — a real upgrade hazard for
      // anyone whose per-project CLAUDE.md still carries the old log_cost
      // instruction, documented in docs/ingestion.md. Migration 021 adds the
      // fix: excludeObservedCondition() in server/db/costs.ts filters on this
      // column for every row whose agent's cost identity is marked
      // cost-observed. That marking is always an explicit human action through
      // POST /api/agents/:id/cost-observed — never inferred from source or
      // anything else, because guessing that an agent is Claude Code is
      // exactly the mistake this column exists to let a person correct
      // instead.
      //
      // external_id holds the transcript record's own uuid. The partial unique
      // index below is the whole idempotency guarantee: re-scanning a file can
      // never insert a row twice, and it is enforced by the database rather
      // than by application logic that could regress.
      //
      // Cache writes are split by TTL because they are priced differently
      // (1.25x input for 5-minute, 2x for 1-hour) and the transcript reports
      // them separately. Folding them together would make cost_usd
      // unauditable.
      //
      // Each column is guarded the way 002, 003, 016 and 021 guard theirs
      // (DATA-11, added after 019 shipped). Unguarded, a database that already
      // has these columns but not 019's record, such as one patched by hand or
      // salvaged, failed "duplicate column name" on every start, in every
      // entry point. The guard changes nothing for any database 019 could
      // already migrate, which is why amending a shipped migration is safe here.
      const costCols = db.pragma("table_info(cost_entries)") as { name: string }[];
      const hasCostCol = (name: string): boolean => costCols.some((c) => c.name === name);
      if (!hasCostCol("source")) {
        db.prepare("ALTER TABLE cost_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'mcp'").run();
      }
      if (!hasCostCol("external_id")) {
        db.prepare("ALTER TABLE cost_entries ADD COLUMN external_id TEXT").run();
      }
      if (!hasCostCol("cache_creation_5m_tokens")) {
        db.prepare("ALTER TABLE cost_entries ADD COLUMN cache_creation_5m_tokens INTEGER NOT NULL DEFAULT 0").run();
      }
      if (!hasCostCol("cache_creation_1h_tokens")) {
        db.prepare("ALTER TABLE cost_entries ADD COLUMN cache_creation_1h_tokens INTEGER NOT NULL DEFAULT 0").run();
      }

      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_entries_external_id
          ON cost_entries(external_id) WHERE external_id IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_cost_entries_source
          ON cost_entries(source);

        -- One project has many directories once git worktrees are in use, so
        -- this is a table rather than a column on projects. Paths are stored
        -- already normalised (see attribute.ts) so lookup is string equality.
        CREATE TABLE IF NOT EXISTS project_paths (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id),
          path TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_project_paths_project ON project_paths(project_id);

        -- The incremental cursor. byte_offset is where the last scan stopped,
        -- so a steady-state scan costs time proportional to new bytes rather
        -- than to the number of transcripts on disk.
        CREATE TABLE IF NOT EXISTS transcript_files (
          path TEXT PRIMARY KEY,
          size INTEGER NOT NULL,
          mtime TEXT NOT NULL,
          byte_offset INTEGER NOT NULL DEFAULT 0,
          last_uuid TEXT,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    name: "020_cost_usd_nullable",
    run(db) {
      // An unpriced record must store NULL, not 0: NULL means "we do not know
      // what this cost", 0 means "this was free". Conflating them understates
      // spend, which is the exact failure transcript ingestion exists to
      // prevent. cost_usd was declared NOT NULL in the original schema, and
      // SQLite cannot drop NOT NULL with ALTER TABLE, so the table is rebuilt.
      //
      // The copy below can raise FOREIGN KEY constraint failed, and the usual
      // `PRAGMA foreign_keys = OFF` rescue is not available: schema.ts turns
      // foreign_keys ON before runMigrations, and the pragma is inert inside a
      // transaction — which is exactly where every migration runs. So dangling
      // references are nulled out first instead.
      //
      // This is not hypothetical. A database that has been through manual
      // corruption salvage can hold a cost_entries row whose agent_id (or
      // task_id, milestone_id, project_id) names a row that no longer exists.
      // The old table never re-validated it, but INSERTing into the new table
      // does: the constraint fails, the migration rolls back, runMigrations
      // throws, initDb throws, and the server, the stdio MCP transport and the
      // CLI all refuse to open that database on every start from then on.
      // Recovery would need manual sqlite3 surgery.
      //
      // All four columns are nullable, so nulling a dangling reference keeps
      // the row and its money and drops only a pointer that already pointed at
      // nothing.
      db.exec(`
        UPDATE cost_entries SET agent_id = NULL
          WHERE agent_id IS NOT NULL AND agent_id NOT IN (SELECT id FROM agents);
        UPDATE cost_entries SET task_id = NULL
          WHERE task_id IS NOT NULL AND task_id NOT IN (SELECT id FROM tasks);
        UPDATE cost_entries SET milestone_id = NULL
          WHERE milestone_id IS NOT NULL AND milestone_id NOT IN (SELECT id FROM milestones);
        UPDATE cost_entries SET project_id = NULL
          WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects);
      `);

      // DEFAULT 0 is retained so an INSERT that omits the column behaves exactly
      // as before; only the NOT NULL constraint is lifted.
      db.exec(`
        CREATE TABLE cost_entries_new (
          id TEXT PRIMARY KEY,
          agent_id TEXT REFERENCES agents(id),
          task_id TEXT REFERENCES tasks(id),
          milestone_id TEXT REFERENCES milestones(id),
          project_id TEXT REFERENCES projects(id),
          model TEXT NOT NULL,
          provider TEXT NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL DEFAULT 0,
          created_at TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'mcp',
          external_id TEXT,
          cache_creation_5m_tokens INTEGER NOT NULL DEFAULT 0,
          cache_creation_1h_tokens INTEGER NOT NULL DEFAULT 0
        );

        INSERT INTO cost_entries_new
          (id, agent_id, task_id, milestone_id, project_id, model, provider,
           input_tokens, output_tokens, cost_usd, created_at,
           source, external_id, cache_creation_5m_tokens, cache_creation_1h_tokens)
        SELECT
           id, agent_id, task_id, milestone_id, project_id, model, provider,
           input_tokens, output_tokens, cost_usd, created_at,
           source, external_id, cache_creation_5m_tokens, cache_creation_1h_tokens
        FROM cost_entries;

        DROP TABLE cost_entries;
        ALTER TABLE cost_entries_new RENAME TO cost_entries;

        -- Indexes live with the table, so dropping it dropped these too.
        CREATE INDEX IF NOT EXISTS idx_cost_entries_agent_id ON cost_entries(agent_id);
        CREATE INDEX IF NOT EXISTS idx_cost_entries_project_id ON cost_entries(project_id);
        CREATE INDEX IF NOT EXISTS idx_cost_entries_created_at ON cost_entries(created_at);
        CREATE INDEX IF NOT EXISTS idx_cost_entries_task_id ON cost_entries(task_id);
        CREATE INDEX IF NOT EXISTS idx_cost_entries_milestone_id ON cost_entries(milestone_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_entries_external_id
          ON cost_entries(external_id) WHERE external_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_cost_entries_source
          ON cost_entries(source);
      `);
    },
  },
  {
    name: "021_agent_cost_observed",
    run(db) {
      // Marks a CLIENT whose spend we already read from its transcripts, so its
      // self-reported log_cost rows are duplicates rather than new spend.
      // Excluded at query time in server/db/costs.ts; the rows are never
      // deleted, because destroying money records to fix a reporting bug
      // removes the audit trail that makes the fix checkable.
      //
      // Keyed to the client rather than to a row in `agents` because agent
      // identity is per-connection: server/mcp/server.ts names each connection
      // `${clientName}-${suffix}` with a random suffix, so a mark on one row
      // stopped applying the next time the client started. See section 14 of
      // the design.
      //
      // `client_name` is recorded at registration rather than recovered later
      // by stripping the suffix. Stripping would work on rows written before
      // this change, which is its appeal, but it is a guess and it is wrong for
      // an agent legitimately named that way. This feature does not guess.
      const cols = db.pragma("table_info(agents)") as { name: string }[];
      const has = (name: string): boolean => cols.some((c) => c.name === name);
      if (!has("client_name")) {
        db.prepare("ALTER TABLE agents ADD COLUMN client_name TEXT").run();
      }

      // NOT NULL is spelled out: SQLite permits NULLs in a non-INTEGER PRIMARY
      // KEY, and a NULL identity would make the IN test below behave oddly.
      db.exec(`
        CREATE TABLE IF NOT EXISTS cost_observed_identities (
          identity  TEXT PRIMARY KEY NOT NULL,
          marked_at TEXT NOT NULL
        )
      `);
    },
  },
  {
    name: "022_otlp_series",
    run(db) {
      // Remembers the last value seen for each cumulative OTLP metric series,
      // so an export carrying a running total contributes only its increase.
      //
      // Same purpose as transcript_files: a record of what has already been
      // counted, so re-reading a source does not recount it. Without it, a
      // cumulative sender's spend is multiplied by the number of exports and
      // nothing fails to make that visible.
      //
      // start_time_nano is stored for diagnostics but is NOT what identifies a
      // restart -- that is judged purely by last_value going backwards. See
      // seriesIncrement's doc comment in server/ingest/otlp/series.ts.
      //
      // last_time_unix_nano (Finding 2) is the point's own clock, stored so an
      // out-of-order delivery -- a retried export arriving after a later one
      // has already been processed -- can be told apart from real forward
      // progress. A cumulative point whose timeUnixNano is not strictly
      // greater than what is stored here carries no new information about the
      // running total and must be ignored rather than perturbing it; see
      // seriesIncrement. Defaults to '' rather than NOT NULL alone so the
      // guarded ALTER TABLE below can add it to a database where this table
      // already exists.
      //
      // Migration 022 has not shipped anywhere yet, so this column is added by
      // amending 022 in place rather than adding an 023. The CREATE TABLE
      // covers a fresh database; the guarded ALTER TABLE below covers a
      // developer database where 022 already ran before this column existed,
      // following the pragma table_info + has(name) pattern used by 021's
      // agent-column addition above.
      db.exec(`
        CREATE TABLE IF NOT EXISTS otlp_series (
          series_key          TEXT PRIMARY KEY NOT NULL,
          start_time_nano      TEXT NOT NULL,
          last_value            REAL NOT NULL,
          last_time_unix_nano  TEXT NOT NULL DEFAULT '',
          updated_at            TEXT NOT NULL
        )
      `);

      const cols = db.pragma("table_info(otlp_series)") as { name: string }[];
      const has = (name: string): boolean => cols.some((c) => c.name === name);
      if (!has("last_time_unix_nano")) {
        db.prepare("ALTER TABLE otlp_series ADD COLUMN last_time_unix_nano TEXT NOT NULL DEFAULT ''").run();
      }
    },
  },
  {
    name: "023_agent_sessions_last_activity_at",
    run(db) {
      // `agent_sessions.last_activity_at` has only ever been created by a
      // CREATE TABLE statement -- first in `schema.ts`, then in
      // `001_initial_schema` -- and it was added to that statement AFTER the
      // table already existed in live databases (the first release with
      // `agent_sessions` did not have the column). CREATE TABLE IF NOT EXISTS
      // never alters an existing table, so those databases could never receive
      // it: 001 is recorded as applied, the CREATE is skipped, and no migration
      // ever reached the column.
      //
      // It stays invisible until a build that writes the column is deployed
      // over such a database, at which point `startOrGetSession()` fails with
      // "table agent_sessions has no column named last_activity_at". That call
      // sits in the MCP per-tool-call wrapper, so EVERY tool fails, reads
      // included -- the failure looks nothing like a schema problem.
      //
      // Guarded ALTER rather than an amendment to 001, because 001 has shipped:
      // renaming or re-running a shipped migration is what the newer-database
      // guard in runMigrations() exists to prevent.
      //
      // DEFAULT '' is required for a NOT NULL ADD COLUMN in SQLite; the UPDATE
      // below immediately replaces it with the row's own start time, which is
      // the most truthful value available for a session nobody was tracking.
      // A fresh database's column carries no default, which is a harmless DDL
      // difference as long as every writer names the column: a fresh database
      // rejects an INSERT that omits it, a migrated one silently stores ''.
      // startOrGetSession is the only insert path and it names the column, and
      // tests run on fresh databases -- the stricter variant -- so an omission
      // added later fails there rather than only in a migrated database.
      //
      // A salvaged database can reach here without the table at all, with 001
      // already recorded as applied so nothing will create it. pragma
      // table_info returns an empty list for a missing table, which is
      // indistinguishable from a table with no matching column, so ask
      // sqlite_master directly before trusting it -- same guard shape as 004.
      const exists = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_sessions'")
        .all();
      if (exists.length === 0) return;

      const cols = db.pragma("table_info(agent_sessions)") as { name: string }[];
      if (!cols.some((c) => c.name === "last_activity_at")) {
        db.prepare(
          "ALTER TABLE agent_sessions ADD COLUMN last_activity_at TEXT NOT NULL DEFAULT ''"
        ).run();
        db.prepare(
          "UPDATE agent_sessions SET last_activity_at = started_at WHERE last_activity_at = ''"
        ).run();
      }
    },
  },
  {
    name: "024_cost_entries_created_at_julianday_index",
    run(db) {
      // The cost queries that ask "inside this window" now compare
      // julianday(created_at), not the raw string, so that a row whose
      // timestamp cannot be read stops being counted as today's spend. That
      // makes the predicate non-sargable: idx_cost_entries_created_at indexes
      // the column, not the expression, so getSpendToday, getSpendTodayUnpriced
      // and the unfiltered getCostTimeseries all went from
      //   SEARCH cost_entries USING INDEX idx_cost_entries_created_at (created_at>?)
      // to a full SCAN of the largest and fastest-growing table in the
      // database. GET /api/stats runs the first two back to back and the
      // dashboard polls it every 3 seconds, and better-sqlite3 is synchronous,
      // so each scan blocks the event loop. (A timeseries filtered by agent,
      // milestone or project resolves through that filter's own index and never
      // depended on this one.)
      //
      // An index on the expression restores the range scan for exactly the
      // form those queries use. Additive and IF NOT EXISTS, so it is safe on
      // every existing database and costs only the usual per-insert index
      // maintenance (measured: about 400ms to build over 10^6 rows, inside the
      // per-migration transaction, before the server serves anything).
      //
      // Not folded into 001 or 020 alongside the plain column index: those have
      // shipped, and CREATE TABLE/INDEX statements inside an already-recorded
      // migration never run again, so a live database would never receive it.
      // The same reason 023 exists. A future migration that rebuilds
      // cost_entries the way 020 did must re-create this index, because an
      // index lives with its table.
      //
      // The expression is spelled out here rather than imported from
      // julianDaySql(), because a migration's SQL has to be frozen: a later
      // edit to that helper would leave every existing database holding an
      // index over the old expression, silently unused. They must stay
      // identical, and the "cost window stays sargable" test is what enforces
      // it by explaining the real queries.
      //
      // The GLOB guard is load-bearing, not defensive noise: without it a
      // single stored value that reads the clock ('now', 'subsec') makes this
      // CREATE INDEX throw and, because the failure repeats on every start,
      // leaves a database nothing can open. julianDaySql() in helpers.ts is
      // where that is explained; this migration only has to match it.
      //
      // A prefilter on the raw column (`created_at >= ? AND julianday(...)`)
      // would have kept the old index without a migration, and it is wrong:
      // '2026-09-18 05:00:00' and '2026-09-18' are both readable dates that
      // sort BELOW an ISO cutoff, because ' ' (0x20) and the end of a short
      // string rank under 'T' (0x54). The prefilter would drop them from today,
      // trading a fail-open bug for a fail-closed one.
      //
      // Missing-table guard for the same reason 023 carries one: a database
      // salvaged from corruption can reach here with 001 recorded but the table
      // gone, and an unguarded CREATE INDEX would wedge startup the same way.
      const exists = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cost_entries'")
        .all();
      if (exists.length === 0) return;

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_cost_entries_created_at_jd
          ON cost_entries(julianday(
            CASE WHEN created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
              THEN created_at END
          ));
      `);
    },
  },
  {
    name: "025_activity_log_timestamp_julianday_index",
    run(db) {
      // getActivityStream's `since` filter compares julianday(timestamp), not
      // the raw string, so an activity row with an unreadable timestamp stops
      // passing every `since` (see julianDaySql in helpers.ts). That makes the
      // predicate non-sargable against idx_activity_log_timestamp, which indexes
      // the column, not the expression: `since` went from
      //   SEARCH a USING INDEX idx_activity_log_timestamp (timestamp>?)
      // to a SCAN, and a `since` matching few rows walks all of activity_log on
      // an unauthenticated route, blocking the event loop. Same problem and same
      // remedy as 024, whose comments explain the reasoning in full: an
      // expression index spelled out here (frozen, not imported from
      // julianDaySql), guarded by the date-shaped GLOB so one stored 'now' or
      // 'subsec' cannot make this CREATE INDEX throw and wedge startup, plus the
      // missing-table guard for salvaged databases. The two expressions must
      // stay identical; the "since window stays sargable" test enforces it.
      // A future migration that rebuilds activity_log must re-create this index,
      // because an index lives with its table (see 024).
      const exists = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'activity_log'")
        .all();
      if (exists.length === 0) return;

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp_jd
          ON activity_log(julianday(
            CASE WHEN timestamp GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
              THEN timestamp END
          ));
      `);
    },
  },
  {
    name: "026_projects_archived_at",
    run(db) {
      // Soft archive for projects: cost rows are never deleted (020's doc
      // comment), and the same principle applies here — archiving hides a
      // project from default listings and top-bar counts without destroying
      // its tasks, milestones or cost history. NULL means active; a non-null
      // ISO timestamp records when it was archived, so "archived" and "when"
      // are the same column instead of a separate boolean plus a timestamp
      // that could disagree with each other.
      //
      // Two guard patterns, both already established elsewhere in this file:
      //   - missing-table guard (SELECT ... FROM sqlite_master), the same as
      //     023/024/025, for a salvaged database where `projects` itself is
      //     gone despite 001 being recorded as applied;
      //   - table_info + has() column guard, the same idempotent pattern
      //     002/003/016/021 use, so re-running (or a database already patched
      //     by hand) never throws "duplicate column name".
      const exists = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'")
        .all();
      if (exists.length === 0) return;

      const cols = db.pragma("table_info(projects)") as { name: string }[];
      if (!cols.some((c) => c.name === "archived_at")) {
        db.prepare("ALTER TABLE projects ADD COLUMN archived_at TEXT").run();
      }

      // Default project listings filter on `archived_at IS NULL`. This index
      // is a small, defensive addition rather than a measured fix (contrast
      // with 024/025, which cite before/after query plans): `projects` is a
      // low-row-count table, and whether SQLite's planner actually chooses
      // this index over a full scan depends on what fraction of rows end up
      // archived. It costs almost nothing to maintain and gives the planner
      // the option, which matters more as an install's archived population
      // grows (see CI-1/PROD-2 in docs/analysis/2026-09-18-project-audit.md
      // — the live database already carries dozens of junk projects this
      // feature exists to let an operator hide).
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_projects_archived_at ON projects(archived_at);
      `);
    },
  },
  {
    name: "027_tasks_milestone_fk_to_milestones",
    foreignKeysOff: true,
    isNeeded: tasksMilestoneKeyIsStale,
    run(db) {
      // 002 renamed tasks.sprint_id to milestone_id with ALTER TABLE RENAME
      // COLUMN, which keeps the column's foreign key pointing at sprints. On a
      // database old enough to have had sprints, every write of a milestone_id
      // is then checked against the wrong table. SQLite cannot change a
      // foreign key in place, so the table is rebuilt.
      //
      // This replaces rebuildTasksIfFkStale(), which schema.ts ran after the
      // migrations on every open. As a post-migration step it copied a literal
      // column list, so any tasks column a later migration added would have
      // been dropped from a legacy database with that migration already
      // recorded (DATA-2); it dropped all five tasks indexes without recreating
      // them (DATA-3); it ran a raw BEGIN/COMMIT that could leave foreign keys
      // off and a write lock held on failure (DATA-6); and it never ran
      // foreign_key_check (DATA-7). As a numbered migration it runs once, at a
      // fixed point in the sequence, inside the runner's transaction, and
      // foreignKeysOff gives it the documented rebuild procedure, including the
      // check. It is a no-op on every database whose key is already right, and
      // isNeeded lets the runner skip the check there too.
      if (!tasksMilestoneKeyIsStale(db)) return;

      // The column list is frozen at 026, so a tasks table that differs from it
      // is refused rather than rebuilt: copying the known columns would drop
      // any other one along with its data. Only a hand-altered table can get
      // here, so the way forward is by hand too.
      const columns = (db.pragma("table_info(tasks)") as { name: string }[]).map((c) => c.name);
      const unknown = columns.filter((c) => !TASKS_COLUMNS_AT_026.includes(c));
      const missing = TASKS_COLUMNS_AT_026.filter((c) => !columns.includes(c));
      if (unknown.length > 0 || missing.length > 0) {
        throw new Error(
          `027_tasks_milestone_fk_to_milestones: the tasks table has columns this rebuild does not know ` +
            `(${unknown.join(", ") || "none"}) or lacks some it needs (${missing.join(", ") || "none"}), ` +
            `so rebuilding it could lose data. This migration has changed nothing. Copy out any data in the ` +
            `unknown columns and drop them, or add the missing ones back, then start again.`
        );
      }

      // Indexes live with their table: note them to recreate afterwards.
      const indexes = (
        db
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks' AND sql IS NOT NULL")
          .all() as { sql: string }[]
      ).map((r) => r.sql);
      // Views and triggers are parsed again when tasks_new is renamed, and one
      // that names tasks while it does not exist makes that rename fail. The
      // documented procedure drops them first and recreates them afterwards;
      // doing it for all of them, in the order they were made, covers views
      // built on other views. This codebase defines none: these are anyone's own.
      const dependents = db
        .prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('view', 'trigger') AND sql IS NOT NULL ORDER BY rowid")
        .all() as { type: "view" | "trigger"; name: string; sql: string }[];
      for (const d of dependents) {
        db.prepare(`DROP ${d.type === "view" ? "VIEW" : "TRIGGER"} IF EXISTS "${d.name.replace(/"/g, '""')}"`).run();
      }

      // A milestone_id naming a sprint that 004 never copied into milestones
      // (it copies only into an empty milestones table) has nothing to point
      // at under the new key. It is nulled, as 020 nulls a dangling cost
      // reference: the task stays, and only a pointer no milestone answers to
      // goes. The sprints table itself is not touched, and the warning says so.
      const cleared = db
        .prepare(
          "UPDATE tasks SET milestone_id = NULL WHERE milestone_id IS NOT NULL AND milestone_id NOT IN (SELECT id FROM milestones)"
        )
        .run().changes;

      // rowid is copied explicitly so every row keeps it.
      const list = TASKS_COLUMNS_AT_026.join(", ");
      db.exec(`
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
          task_type TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        INSERT INTO tasks_new (rowid, ${list}) SELECT rowid, ${list} FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;
      `);
      // prepare() takes exactly one statement, so DDL read back from the file
      // can only ever recreate that one object, however the file was edited.
      for (const sql of indexes) db.prepare(sql).run();
      for (const d of dependents) db.prepare(d.sql).run();

      return cleared > 0
        ? [
            `${cleared} task${cleared === 1 ? "" : "s"} pointed at a sprint that never became a milestone; ` +
              `that link was cleared, and the sprint is still in the sprints table`,
          ]
        : [];
    },
  },
  {
    name: "028_restore_missing_indexes",
    run(db) {
      // Every migration's indexes are created with IF NOT EXISTS inside a
      // migration that runs once, so an index that goes missing afterwards
      // never comes back: the same bug class as 023's column, for indexes.
      // They do go missing. The old post-migration tasks rebuild dropped all
      // five tasks indexes (DATA-3), and a database recovered from corruption
      // by copying rows into freshly created tables has none at all: the
      // maintainer's live database was missing 20 of the 31 below across nine
      // tables, including the unique index on agents.name_normalized, when
      // this migration was written. Nothing errors without them; every
      // lookup just scans.
      //
      // Each index is created only where its table and columns exist (a
      // salvaged database can lack a table), with a warning for any that
      // cannot be. The two unique indexes are not handled here but by
      // ensureUniqueIndexes() on every open: duplicate values can block them,
      // which duplicate row is the right one is not something a migration can
      // know, and once someone resolves them the index has to come back
      // without a migration left to run.
      return INDEXES_AT_026.filter((index) => !index.duplicates)
        .map((index) => restoreIndex(db, index))
        .filter((warning): warning is string => warning !== undefined);
    },
  },
];

/**
 * Migration names recorded in `_migrations` that this build's `MIGRATIONS`
 * list has never heard of — the signature of a database written by a newer
 * Vibe Dash. Locale pinned in the sort so the message order is identical on
 * every runtime; the default locale varies with the host and Node's ICU
 * build. Shared by `runMigrations()` and `assertSchemaCurrent()` so the two
 * checks can't drift apart.
 */
function findUnknownMigrations(
  ran: ReadonlySet<string>,
  migrations: readonly Migration[] = MIGRATIONS
): string[] {
  const known = new Set(migrations.map((m) => m.name));
  return [...ran].filter((name) => !known.has(name)).sort((a, b) => a.localeCompare(b, "en"));
}

/**
 * Whether `db` holds anything a snapshot would protect. An in-memory database
 * cannot be restored from a file anyway, and a file with no tables beyond
 * `_migrations` is a brand-new install whose first migration is about to
 * create them all.
 */
function hasDataToProtect(db: Database.Database): boolean {
  if (db.memory) return false;
  const table = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_migrations' LIMIT 1"
    )
    .get();
  return table !== undefined;
}

/**
 * `quick_check` findings for the database being migrated, empty when it is
 * healthy. Run only after copying or verifying the snapshot has failed, to
 * tell a damaged database apart from a bad backup folder. It reads the whole
 * file, so it is skipped when the failure was creating the folder or file,
 * which the database cannot have caused.
 */
function databaseProblems(db: Database.Database, err: unknown): string[] {
  if (!(err instanceof SnapshotError) || err.stage === "destination") return [];
  try {
    const findings = (db.pragma("quick_check") as { quick_check: string }[]).map((r) => r.quick_check);
    return findings.length === 1 && findings[0] === "ok" ? [] : findings;
  } catch (checkErr) {
    return [checkErr instanceof Error ? checkErr.message : String(checkErr)];
  }
}

function snapshotBeforeMigrating(
  db: Database.Database,
  pending: string[],
  root: string
): PreMigrationSnapshot {
  try {
    return takePreMigrationSnapshot(db, pending, root);
  } catch (err) {
    throw new MigrationSnapshotError(preMigrationFolder(root, db.name), pending, err, databaseProblems(db, err));
  }
}

/**
 * Every current foreign-key violation, one entry per violating row and key,
 * as "child#rowid.column->parent". The key is named by its child column(s),
 * not by SQLite's fkid, because a rebuild that declares its keys in another
 * order renumbers the fkids, which would make old violations look new.
 * SQLite cannot run the check at all on a schema where a foreign key names a
 * parent column that is not its primary key or unique; that is reported as
 * what it is rather than as a raw "foreign key mismatch".
 */
function foreignKeyViolations(db: Database.Database, migration: string): Set<string> {
  try {
    const rows = db.pragma("foreign_key_check") as { table: string; rowid: number; parent: string; fkid: number }[];
    const keyColumns = new Map<string, Map<number, string>>();
    const columnsOf = (table: string, fkid: number): string => {
      let keys = keyColumns.get(table);
      if (!keys) {
        keys = new Map();
        // The table name comes from this database's own schema, quoted.
        const fks = db.pragma(`foreign_key_list("${table.replace(/"/g, '""')}")`) as { id: number; from: string }[];
        for (const fk of fks) keys.set(fk.id, keys.has(fk.id) ? `${keys.get(fk.id)},${fk.from}` : fk.from);
        keyColumns.set(table, keys);
      }
      return keys.get(fkid) ?? `#${fkid}`;
    };
    return new Set(rows.map((r) => `${r.table}#${r.rowid}.${columnsOf(r.table, r.fkid)}->${r.parent}`));
  } catch (err) {
    throw new Error(
      `Migration ${migration} rebuilds a table with foreign-key enforcement off and needs foreign_key_check to ` +
        `prove it lost nothing, but SQLite cannot run that check on this database ` +
        `(${err instanceof Error ? err.message : String(err)}). A foreign key there names a parent column that is ` +
        `not its primary key or unique; repair that table's definition, then start again.`,
      { cause: err }
    );
  }
}

/**
 * Throws, rolling the enclosing migration back, if foreign_key_check reports
 * a violating row that it did not report before the migration ran. Row by
 * row, so fixing one violation cannot hide creating another.
 */
function assertNoNewViolations(db: Database.Database, before: Set<string>, migration: string): void {
  const added = [...foreignKeyViolations(db, migration)].filter((v) => !before.has(v));
  if (added.length > 0) {
    throw new Error(
      `Migration ${migration} left ${added.length} foreign-key violation${added.length === 1 ? "" : "s"} that ` +
        `were not there before (${added.slice(0, 5).join(", ")}), so it has been rolled back.`
    );
  }
}

/**
 * Run `work` with foreign-key enforcement off, restoring it afterwards. The
 * pragma is silently ignored inside a transaction, so an open one would leave
 * enforcement on and the rebuild failing, or worse, half-reasoned about:
 * refuse rather than guess. `work` has committed or rolled back its own
 * transaction by the time the pragma is restored, so the restore takes effect
 * (DATA-6: the old rebuild restored it while its own transaction could still
 * be open, where the pragma is a no-op).
 */
function withForeignKeysOff(db: Database.Database, migration: string, work: () => void): void {
  if (db.inTransaction) {
    throw new Error(
      `Migration ${migration} must run with foreign-key enforcement off, which SQLite cannot switch inside ` +
        `the transaction already open on this connection. Apply migrations outside a transaction.`
    );
  }
  const enforced = db.pragma("foreign_keys", { simple: true }) === 1;
  if (enforced) db.pragma("foreign_keys = OFF");
  try {
    work();
  } finally {
    if (enforced) db.pragma("foreign_keys = ON");
  }
  if (enforced && db.pragma("foreign_keys", { simple: true }) !== 1) {
    throw new Error(`Foreign-key enforcement did not come back on after migration ${migration}.`);
  }
}

/**
 * Apply `migrations` in order to `db`: the runner behind runMigrations(),
 * which passes this build's list. Exported so the runner's own behaviour
 * (foreignKeysOff in particular) can be exercised with purpose-built
 * migrations.
 */
export function applyMigrations(
  db: Database.Database,
  migrations: readonly Migration[],
  options: MigrationOptions = {}
): MigrationReport {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      run_at TEXT NOT NULL
    )
  `);

  const ran = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name)
  );

  // Refuse to run against a database written by a newer build. Migrations are
  // forward-only, so an older build silently applies nothing and then queries
  // columns that don't exist in its worldview — surfacing as raw SQLite errors
  // ("no such column: ...") far from the real cause. A name in `_migrations`
  // that isn't in MIGRATIONS can only mean the writer knew more migrations than
  // we do. This is why migration names are append-only and MUST NOT be renamed
  // once shipped: a rename makes every existing database look like the future.
  if (!process.env[DRIFT_OVERRIDE_ENV]) {
    const unknown = findUnknownMigrations(ran, migrations);
    if (unknown.length > 0) throw new SchemaTooNewError(unknown);
  }

  const pending = migrations.filter((m) => !ran.has(m.name));

  // Snapshot before touching anything (DATA-1). Migrations 008, 010-013, 015,
  // 017 and 018 drop tables or merge rows and none of them can be reversed, so
  // every upgrade that has something to lose gets a verified copy first, and
  // one that cannot get a copy does not happen. This covers every pending
  // migration rather than a hand-kept list of destructive ones, which is one
  // more thing a future migration could forget to join.
  const snapshot =
    pending.length > 0 && hasDataToProtect(db)
      ? snapshotBeforeMigrating(
          db,
          pending.map((m) => m.name),
          options.snapshotDir ?? preMigrationSnapshotDir()
        )
      : null;

  const insert = db.prepare("INSERT INTO _migrations (name, run_at) VALUES (?, ?)");
  const alreadyRan = db.prepare("SELECT 1 FROM _migrations WHERE name = ?");
  const applied: string[] = [];
  const warnings: string[] = [];

  // BEGIN IMMEDIATE (rather than the default deferred BEGIN) takes the write
  // lock up front, so two processes starting together serialise on it —
  // combined with the explicit busy_timeout above, the loser blocks and
  // waits instead of racing to read the same "not yet applied" state. The
  // re-check of `alreadyRan` *inside* the transaction is what actually
  // avoids the crash: once the loser's BEGIN IMMEDIATE finally acquires the
  // lock, the winner has already committed the INSERT into `_migrations`,
  // so without this guard the loser would still hit the UNIQUE constraint
  // on `name`. The outer `ran` set is only a fast-path skip; this is the
  // check that matters under contention (DATA-15).
  const applyOne = (m: Migration, checkForeignKeys: boolean): void =>
    db.transaction(() => {
      if (alreadyRan.get(m.name)) return;
      const violationsBefore = checkForeignKeys ? foreignKeyViolations(db, m.name) : undefined;
      const result = m.run(db);
      const migrationWarnings = Array.isArray(result) ? result : [];
      if (violationsBefore) assertNoNewViolations(db, violationsBefore, m.name);
      insert.run(m.name, new Date().toISOString());
      applied.push(m.name);
      warnings.push(...migrationWarnings.map((w) => `${m.name}: ${w}`));
    }).immediate();

  for (const m of pending) {
    const rebuilds = m.foreignKeysOff === true && (m.isNeeded?.(db) ?? true);
    if (rebuilds) withForeignKeysOff(db, m.name, () => applyOne(m, true));
    else applyOne(m, false);
  }

  return { applied, snapshot, warnings };
}

export function runMigrations(db: Database.Database, options: MigrationOptions = {}): MigrationReport {
  const report = applyMigrations(db, MIGRATIONS, options);
  // With VIBE_DASH_ALLOW_SCHEMA_DRIFT a newer build's database can be open
  // here, and its schema is not this build's to repair: an index a later
  // release dropped on purpose must not come back.
  if (getUnknownMigrations(db).length === 0) report.warnings.push(...ensureUniqueIndexes(db));
  return report;
}

/**
 * Verify the database carries every migration this build knows about,
 * without applying any of them. For callers that must never run migrations
 * themselves (the CLI — DATA-5, ARCH-11): they should fail loudly and
 * actionably instead of either silently skipping columns or, worse, racing
 * the server to apply migrations concurrently.
 *
 * Throws `SchemaBehindError` if migrations are pending, or `SchemaTooNewError`
 * if the database has migrations this build doesn't know (same check as
 * `runMigrations`, respecting the same `VIBE_DASH_ALLOW_SCHEMA_DRIFT` escape
 * hatch).
 */
export function assertSchemaCurrent(db: Database.Database): void {
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'")
    .get();
  const ran = new Set(
    tableExists
      ? (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name)
      : []
  );

  const pending = MIGRATIONS.filter((m) => !ran.has(m.name)).map((m) => m.name);
  if (pending.length > 0) throw new SchemaBehindError(pending);

  if (!process.env[DRIFT_OVERRIDE_ENV]) {
    const unknown = findUnknownMigrations(ran);
    if (unknown.length > 0) throw new SchemaTooNewError(unknown);
  }
}

/**
 * Names in `_migrations` that this build doesn't know, without throwing.
 *
 * `runMigrations()` throws `SchemaTooNewError` for exactly this condition
 * unless `VIBE_DASH_ALLOW_SCHEMA_DRIFT` is set — which means the only way this
 * function can ever find a non-empty result at runtime is that the override
 * was used to open the database anyway (LIVE-3's optional "warn when the
 * database carries newer migrations than the build expects" — the guard
 * already knows this, it just never told anyone once startup let it through).
 * Cheap: one query against a table `runMigrations()` already guarantees
 * exists by the time any caller can reach this.
 */
export function getUnknownMigrations(db: Database.Database): string[] {
  const ran = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name)
  );
  return findUnknownMigrations(ran);
}
