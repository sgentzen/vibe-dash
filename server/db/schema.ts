import Database from "better-sqlite3";
import { runMigrations, assertSchemaCurrent, DB_BUSY_TIMEOUT_MS } from "./migrator.js";
import { acquireOwnerLock } from "./ownerLock.js";

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
        task_type TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO tasks_new
        (id, project_id, parent_task_id, milestone_id, assigned_agent_id,
         title, description, status, priority, progress,
         due_date, start_date, estimate, task_type, created_at, updated_at)
      SELECT id, project_id, parent_task_id, milestone_id, assigned_agent_id,
         title, description, status, priority, progress,
         due_date, start_date, estimate, task_type, created_at, updated_at
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
  // Explicit rather than relying on the driver default (DATA-15): see
  // DB_BUSY_TIMEOUT_MS's own comment for why this matters for concurrent
  // migration runs specifically.
  db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  // Fix stale tasks.milestone_id FK after column rename migration may have run
  rebuildTasksIfFkStale(db);
}

/**
 * Open the database read-write and bring it up to date, taking the advisory
 * owner lock first (ARCH-1). This is migration authority: only the server and
 * the stdio MCP process should call it. `entryPoint` names the caller in the
 * lock file and in any `DbOwnershipError` a second caller hits.
 */
export function openDb(path: string, entryPoint: string): Database.Database {
  const releaseLock = acquireOwnerLock(path, entryPoint);
  let db: Database.Database | undefined;
  try {
    db = new Database(path);
    initDb(db);
    return db;
  } catch (err) {
    db?.close();
    releaseLock();
    throw err;
  }
}

/**
 * Open the database read-only for the CLI's read commands (DATA-5, ARCH-11).
 * Never migrates and never takes the owner lock — a reader is not a writer,
 * and better-sqlite3 refuses migration DDL against a readonly connection
 * anyway. Throws `SchemaBehindError` if migrations are pending (the fix is to
 * start the server once) or `SchemaTooNewError` if the database is ahead of
 * this build.
 */
export function openReadOnlyDb(path: string): Database.Database {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
    assertSchemaCurrent(db);
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

/**
 * Open the database read-write for the CLI's one writer, `add-task`
 * (DATA-5, ARCH-11), without running migrations and without taking the
 * owner lock — the CLI is a short-lived process making one write, not a
 * long-lived owner, and the lock is scoped to the server and stdio MCP.
 * Throws the same schema errors as `openReadOnlyDb`.
 */
export function openWritableForCli(path: string): Database.Database {
  // fileMustExist: a mistyped --db path with no existing database would
  // otherwise fail with SchemaBehindError as soon as assertSchemaCurrent()
  // runs anyway (an empty file has no _migrations table, so every migration
  // reads as pending) — but not before better-sqlite3 has already created and
  // left behind an empty .db file at the wrong path. Fail before that happens.
  const db = new Database(path, { fileMustExist: true });
  try {
    db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
    assertSchemaCurrent(db);
    db.pragma("foreign_keys = ON");
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}
