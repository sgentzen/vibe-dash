import Database from "better-sqlite3";
import { seedBuiltInTemplates } from "./templates.js";
import { runMigrations } from "./migrator.js";

// ─── Stale FK Guard ───────────────────────────────────────────────────────────
// Retained for legacy databases where tasks.milestone_id still points at
// the now-dropped sprints table. Runs once per open; is a no-op for healthy DBs.

interface ForeignKeyRow { id: number; seq: number; table: string; from: string; to: string; on_update: string; on_delete: string; match: string }

function rebuildTasksIfFkStale(db: Database.Database): void {
  const fks = db.pragma("foreign_key_list(tasks)") as ForeignKeyRow[];
  const hasStaleSprintFk = fks.some((fk) => fk.from === "milestone_id" && fk.table === "sprints");
  if (!hasStaleSprintFk) return;

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

export function initDb(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  // Fix stale tasks.milestone_id FK after column rename migration may have run
  rebuildTasksIfFkStale(db);
  seedBuiltInTemplates(db);
}

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  initDb(db);
  return db;
}
