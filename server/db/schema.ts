import Database from "better-sqlite3";
import {
  runMigrations,
  assertSchemaCurrent,
  DB_BUSY_TIMEOUT_MS,
  type MigrationOptions,
  type MigrationReport,
} from "./migrator.js";
import { acquireOwnerLock } from "./ownerLock.js";
import type { PreMigrationSnapshot } from "./snapshot.js";

export function initDb(db: Database.Database, options: MigrationOptions = {}): MigrationReport {
  // Explicit rather than relying on the driver default (DATA-15): see
  // DB_BUSY_TIMEOUT_MS's own comment for why this matters for concurrent
  // migration runs specifically.
  db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return runMigrations(db, options);
}

export interface OpenDbOptions extends MigrationOptions {
  /**
   * Called when a snapshot was taken before migrating, so the entry point can
   * say where it went. The db layer does not log it itself: the stdio MCP
   * process speaks JSON-RPC on stdout and must keep diagnostics on stderr,
   * while the server logs through pino.
   */
  onSnapshot?: (snapshot: PreMigrationSnapshot) => void;
  /** Called once per warning in the migration report; see MigrationReport.warnings. */
  onWarning?: (warning: string) => void;
}

/**
 * Open the database read-write and bring it up to date, taking the advisory
 * owner lock first (ARCH-1). This is migration authority: only the server and
 * the stdio MCP process should call it. `entryPoint` names the caller in the
 * lock file and in any `DbOwnershipError` a second caller hits.
 */
export function openDb(path: string, entryPoint: string, options: OpenDbOptions = {}): Database.Database {
  const releaseLock = acquireOwnerLock(path, entryPoint);
  let db: Database.Database | undefined;
  try {
    db = new Database(path);
    const { snapshot, warnings } = initDb(db, { snapshotDir: options.snapshotDir });
    if (snapshot) options.onSnapshot?.(snapshot);
    for (const warning of warnings) options.onWarning?.(warning);
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
