import Database from "better-sqlite3";

interface Migration {
  name: string;
  run: (db: Database.Database) => void;
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
      // Backfill: lowercase + trim + collapse _ and - to space, then collapse runs of spaces.
      // Five nested REPLACE calls collapse up to 32 consecutive spaces — sufficient for real names.
      db.prepare(
        `UPDATE agents SET name_normalized =
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             LOWER(TRIM(REPLACE(REPLACE(name, '_', ' '), '-', ' '))),
           '     ',' '),'    ',' '),'   ',' '),'  ',' '),'  ',' ')
         WHERE name_normalized IS NULL OR name_normalized = ''`
      ).run();
      // Final fallback: if anything still null/empty, use the raw name
      db.prepare(
        "UPDATE agents SET name_normalized = name WHERE name_normalized IS NULL OR name_normalized = ''"
      ).run();
    },
  },
  {
    name: "008_agents_dedup_normalized",
    run(db) {
      interface DupeRow { name_normalized: string; survivor_id: string }
      // Use rowid (SQLite auto-increment) to pick the chronologically earliest row reliably.
      // registered_at is a string and could collide; rowid never does.
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
          // Remove file locks on the duplicate that would conflict with survivor's locks
          // (UNIQUE(agent_id, file_path) constraint would fail otherwise)
          db.prepare(
            "DELETE FROM agent_file_locks WHERE agent_id = ? AND file_path IN (SELECT file_path FROM agent_file_locks WHERE agent_id = ?)"
          ).run(dupId, survivor_id);

          const fkUpdates = [
            "UPDATE activity_log SET agent_id = ? WHERE agent_id = ?",
            "UPDATE agent_sessions SET agent_id = ? WHERE agent_id = ?",
            "UPDATE agent_file_locks SET agent_id = ? WHERE agent_id = ?",
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
];

export function runMigrations(db: Database.Database): void {
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

  const insert = db.prepare("INSERT INTO _migrations (name, run_at) VALUES (?, ?)");

  for (const m of MIGRATIONS) {
    if (ran.has(m.name)) continue;
    db.transaction(() => {
      m.run(db);
      insert.run(m.name, new Date().toISOString());
    })();
  }
}
