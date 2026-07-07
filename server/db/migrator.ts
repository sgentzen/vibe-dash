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
