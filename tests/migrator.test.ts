import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, SchemaTooNewError, getUnknownMigrations } from "../server/db/migrator.js";
import { initDb, startOrGetSession } from "../server/db/index.js";
import { createTestDb } from "./setup.js";

function tableNames(db: Database.Database): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function columnNames(db: Database.Database, table: string): Set<string> {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[];
  return new Set(cols.map((c) => c.name));
}

function migrationCount(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM _migrations").get() as { n: number }).n;
}

describe("runMigrations", () => {
  let db: Database.Database;
  beforeEach(() => {
    // createTestDb() runs initDb() -> runMigrations() on a fresh :memory: DB
    db = createTestDb();
  });

  it("creates the core tables", () => {
    const tables = tableNames(db);
    for (const t of [
      "projects",
      "tasks",
      "milestones",
      "agents",
      "agent_sessions",
      "activity_log",
      "cost_entries",
      "blockers",
      "milestone_daily_stats",
      "_migrations",
    ]) {
      expect(tables, `expected table "${t}"`).toContain(t);
    }
  });

  it("drops every table removed by the Phase 1 cuts", () => {
    const tables = tableNames(db);
    for (const t of [
      "saved_filters",
      "project_templates",
      "agent_file_locks",
      "alert_rules",
      "task_reviews",
      "webhooks",
      "commits",
      "milestone_history",
      "git_integrations",
      "git_linked_items",
      "ingestion_events",
      "ingestion_sources",
      "users",
      "tags",
      "task_tags",
      "task_comments",
      "notifications",
    ]) {
      expect(tables, `orphan table "${t}" should be gone`).not.toContain(t);
    }
  });

  it("drops the recurrence_rule column from tasks", () => {
    expect(columnNames(db, "tasks")).not.toContain("recurrence_rule");
  });

  it("applies migration 016 (agents.current_status)", () => {
    const cols = columnNames(db, "agents");
    expect(cols).toContain("current_status");
    expect(cols).toContain("current_status_at");
  });

  it("applies migration 026 (projects.archived_at)", () => {
    const cols = columnNames(db, "projects");
    expect(cols).toContain("archived_at");
  });

  it("records each migration exactly once", () => {
    const names = (
      db.prepare("SELECT name FROM _migrations").all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toContain("001_initial_schema");
    expect(names).toContain("016_agent_current_status");
    // No duplicates — the table has a UNIQUE(name) constraint, but assert anyway.
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(16);
  });

  it("is idempotent — re-running applies nothing new and does not throw", () => {
    const before = migrationCount(db);
    const tablesBefore = tableNames(db);
    expect(() => runMigrations(db)).not.toThrow();
    expect(() => runMigrations(db)).not.toThrow();
    expect(migrationCount(db)).toBe(before);
    const byName = (a: string, b: string) => a.localeCompare(b);
    expect([...tableNames(db)].sort(byName)).toEqual([...tablesBefore].sort(byName));
  });

  it("brings a raw empty database fully up to date on its own", () => {
    const raw = new Database(":memory:");
    runMigrations(raw);
    const tables = tableNames(raw);
    expect(tables).toContain("projects");
    expect(tables).toContain("_migrations");
    expect(tables).not.toContain("users");
    // Second run is a no-op.
    const n = migrationCount(raw);
    runMigrations(raw);
    expect(migrationCount(raw)).toBe(n);
    raw.close();
  });
});

describe("newer-database guard", () => {
  let db: Database.Database;

  /** Forge a migration record from a build that knows more than we do. */
  function recordFutureMigration(target: Database.Database, name: string): void {
    target
      .prepare("INSERT INTO _migrations (name, run_at) VALUES (?, ?)")
      .run(name, new Date().toISOString());
  }

  beforeEach(() => {
    db = createTestDb();
    delete process.env.VIBE_DASH_ALLOW_SCHEMA_DRIFT;
  });

  afterEach(() => {
    delete process.env.VIBE_DASH_ALLOW_SCHEMA_DRIFT;
    db.close();
  });

  it("throws SchemaTooNewError when the database has migrations this build doesn't know", () => {
    recordFutureMigration(db, "999_from_the_future");
    expect(() => runMigrations(db)).toThrow(SchemaTooNewError);
  });

  it("names the unknown migrations so the operator can see what is missing", () => {
    recordFutureMigration(db, "998_earlier_future");
    recordFutureMigration(db, "999_later_future");

    try {
      runMigrations(db);
      expect.unreachable("expected runMigrations to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaTooNewError);
      const e = err as SchemaTooNewError;
      // Sorted, so the message is stable regardless of insertion order.
      expect(e.unknownMigrations).toEqual(["998_earlier_future", "999_later_future"]);
      expect(e.message).toContain("998_earlier_future");
      expect(e.message).toContain("999_later_future");
      // The message must point at the actual remedy, not at the file path.
      expect(e.message).toContain("update this install");
      expect(e.message).toContain("VIBE_DASH_ALLOW_SCHEMA_DRIFT");
    }
  });

  it("does not fire on a database this build is fully up to date with", () => {
    expect(() => runMigrations(db)).not.toThrow();
  });

  // LIVE-3's optional /api/health schemaDrift field: getUnknownMigrations()
  // computes the same set runMigrations() throws on, without throwing, so a
  // database opened with VIBE_DASH_ALLOW_SCHEMA_DRIFT can still surface the
  // drift after startup instead of the guard's information being lost the
  // moment the override lets it through.
  describe("getUnknownMigrations", () => {
    it("is empty on a database this build is fully up to date with", () => {
      expect(getUnknownMigrations(db)).toEqual([]);
    });

    it("names unknown migrations, sorted, without throwing", () => {
      recordFutureMigration(db, "999_later_future");
      recordFutureMigration(db, "998_earlier_future");
      expect(getUnknownMigrations(db)).toEqual(["998_earlier_future", "999_later_future"]);
    });
  });

  it("does not fire when the database is OLDER — migrations still run forward", () => {
    // The guard is one-directional by design: a database with FEWER migrations
    // than this build knows is the normal upgrade path, not drift. An empty
    // database is that case at its limit — zero applied, all of them pending.
    const old = new Database(":memory:");
    expect(() => runMigrations(old)).not.toThrow();
    expect(migrationCount(old)).toBeGreaterThan(1);
    expect(tableNames(old)).toContain("projects");

    // And having caught up, it is now clean on a second pass.
    expect(() => runMigrations(old)).not.toThrow();
    old.close();
  });

  it("still fires when the database is both behind AND ahead", () => {
    // The realistic drift shape: two builds diverged, so the database carries a
    // migration we lack while we carry migrations it lacks. Being behind must
    // not excuse being ahead.
    const mixed = new Database(":memory:");
    mixed.exec(`
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        run_at TEXT NOT NULL
      )
    `);
    recordFutureMigration(mixed, "999_from_the_future");

    expect(() => runMigrations(mixed)).toThrow(SchemaTooNewError);
    // It refused before applying anything.
    expect(tableNames(mixed)).not.toContain("projects");
    mixed.close();
  });

  it("can be bypassed with VIBE_DASH_ALLOW_SCHEMA_DRIFT", () => {
    recordFutureMigration(db, "999_from_the_future");
    process.env.VIBE_DASH_ALLOW_SCHEMA_DRIFT = "1";
    expect(() => runMigrations(db)).not.toThrow();
  });

  it("surfaces through openDb, which is what every entry point actually calls", () => {
    const file = new Database(":memory:");
    runMigrations(file);
    recordFutureMigration(file, "999_from_the_future");
    // initDb() is openDb()'s second half; call it directly since openDb takes a path.
    expect(() => initDb(file)).toThrow(SchemaTooNewError);
    file.close();
  });
});

describe("agent_sessions.last_activity_at on a pre-column database", () => {
  const MIGRATION_NAME = "023_agent_sessions_last_activity_at";

  /**
   * A database whose `agent_sessions` table was created before
   * `last_activity_at` was part of the CREATE TABLE statement.
   *
   * The column has only ever been created by CREATE TABLE — first in
   * `schema.ts`, later in `001_initial_schema` — and CREATE TABLE IF NOT EXISTS
   * never touches a table that already exists. So a database created by the
   * first release that had `agent_sessions` at all keeps the column-less table
   * through every later migration, and every code path that writes the column
   * fails on it with "table agent_sessions has no column named
   * last_activity_at".
   */
  function preColumnDb(): Database.Database {
    const raw = new Database(":memory:");
    raw.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, model TEXT,
        capabilities TEXT NOT NULL DEFAULT '[]',
        registered_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
      );
      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        started_at TEXT NOT NULL, ended_at TEXT,
        tasks_touched INTEGER NOT NULL DEFAULT 0,
        activity_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    raw
      .prepare(
        "INSERT INTO agents (id, name, model, capabilities, registered_at, last_seen_at) VALUES (?, ?, NULL, '[]', ?, ?)"
      )
      .run("agent-1", "legacy-agent", "2026-04-24T02:14:41.888Z", "2026-04-24T02:14:41.888Z");
    const insertSession = raw.prepare(
      "INSERT INTO agent_sessions (id, agent_id, started_at, ended_at, tasks_touched, activity_count) VALUES (?, ?, ?, ?, 1, 1)"
    );
    insertSession.run("session-1", "agent-1", "2026-04-24T02:14:41.888Z", null);
    // A closed session too: the backfill must not care whether a session ended.
    insertSession.run("session-2", "agent-1", "2026-05-01T09:00:00.000Z", "2026-05-01T10:00:00.000Z");
    return raw;
  }

  it("adds the column the CREATE TABLE could never reach", () => {
    const db = preColumnDb();
    expect(columnNames(db, "agent_sessions")).not.toContain("last_activity_at");

    runMigrations(db);

    expect(columnNames(db, "agent_sessions")).toContain("last_activity_at");
    db.close();
  });

  it("backfills every existing row from started_at, open or closed", () => {
    const db = preColumnDb();
    runMigrations(db);

    const rows = db
      .prepare("SELECT id, started_at, ended_at, last_activity_at FROM agent_sessions ORDER BY id")
      .all() as { id: string; started_at: string; ended_at: string | null; last_activity_at: string }[];

    expect(rows.map((r) => r.id)).toEqual(["session-1", "session-2"]);
    for (const row of rows) {
      expect(row.last_activity_at, `row ${row.id}`).toBe(row.started_at);
    }
    // The closed row is in there, so the backfill is not quietly scoped to open
    // sessions.
    expect(rows.some((r) => r.ended_at !== null)).toBe(true);
    db.close();
  });

  it("leaves session tracking working, which is what every MCP tool call needs", () => {
    const db = preColumnDb();
    runMigrations(db);

    // The seeded session is far older than SESSION_TIMEOUT_MS, so this reads
    // last_activity_at, closes the stale session and INSERTs a new one. The
    // backfill must not resurrect a months-old session: that is the property
    // that makes started_at the safe value to backfill from, so assert it
    // directly rather than inferring it from the activity counter.
    const first = startOrGetSession(db, "agent-1");
    expect(first.id).not.toBe("session-1");
    expect(first.last_activity_at).not.toBe("");
    const legacy = db
      .prepare("SELECT ended_at FROM agent_sessions WHERE id = ?")
      .get("session-1") as { ended_at: string | null };
    expect(legacy.ended_at).not.toBeNull();

    // Immediately again, which is what a second tool call in one connection
    // does: the fresh session is still live, so this takes the UPDATE ...
    // RETURNING branch and writes the column rather than inserting it.
    const second = startOrGetSession(db, "agent-1");
    expect(second.id).toBe(first.id);
    expect(second.activity_count).toBe(2);
    expect(second.last_activity_at).not.toBe("");
    db.close();
  });

  it("does not re-add the column when the table already has it", () => {
    const db = createTestDb();
    expect(columnNames(db, "agent_sessions")).toContain("last_activity_at");
    const before = columnNames(db, "agent_sessions").size;

    // A session row with a value already in the column, as an operator's hand
    // patch would leave behind.
    const ts = "2026-09-19T00:46:47.122Z";
    db.prepare(
      "INSERT INTO agents (id, name, model, capabilities, registered_at, last_seen_at) VALUES (?, ?, NULL, '[]', ?, ?)"
    ).run("agent-live", "live-agent", ts, ts);
    db.prepare(
      "INSERT INTO agent_sessions (id, agent_id, started_at, last_activity_at, tasks_touched, activity_count) VALUES (?, ?, ?, ?, 1, 1)"
    ).run("session-live", "agent-live", "2026-09-19T00:40:00.000Z", ts);

    // Forget that 023 ran, so runMigrations actually executes its body again
    // instead of skipping it by name. This is the path the live database takes
    // on the next rebuild, having been patched by hand. Without the
    // column-presence guard it is a "duplicate column name" error.
    db.prepare("DELETE FROM _migrations WHERE name = ?").run(MIGRATION_NAME);
    expect(() => runMigrations(db)).not.toThrow();

    expect(columnNames(db, "agent_sessions").size).toBe(before);
    // Recorded again, so the database stops looking behind.
    const recorded = db
      .prepare("SELECT COUNT(*) AS n FROM _migrations WHERE name = ?")
      .get(MIGRATION_NAME) as { n: number };
    expect(recorded.n).toBe(1);
    // And the value already in the column is left alone, not re-backfilled to
    // started_at.
    const row = db
      .prepare("SELECT last_activity_at FROM agent_sessions WHERE id = ?")
      .get("session-live") as { last_activity_at: string };
    expect(row.last_activity_at).toBe(ts);
    db.close();
  });

  it("does nothing on a salvaged database that has no agent_sessions table", () => {
    const db = createTestDb();
    // A salvaged database: the table is gone, and nothing will recreate it
    // because 001 is already recorded as applied.
    db.exec("DROP TABLE agent_sessions");
    db.prepare("DELETE FROM _migrations WHERE name = ?").run(MIGRATION_NAME);

    expect(() => runMigrations(db)).not.toThrow();
    expect(tableNames(db)).not.toContain("agent_sessions");
    db.close();
  });

  it("leaves a migrated legacy database schema-identical to a fresh one", () => {
    // The regression this whole migration exists for was a single column that
    // no migration reached. This asserts the general property rather than that
    // one column, so the next such omission fails here instead of in
    // production.
    const migrated = preColumnDb();
    runMigrations(migrated);
    const fresh = createTestDb();

    const byName = (a: string, b: string) => a.localeCompare(b);
    expect([...tableNames(migrated)].sort(byName)).toEqual([...tableNames(fresh)].sort(byName));
    for (const table of [...tableNames(fresh)].sort(byName)) {
      expect([...columnNames(migrated, table)].sort(byName), `columns of "${table}"`).toEqual(
        [...columnNames(fresh, table)].sort(byName)
      );
    }
    migrated.close();
    fresh.close();
  });
});

describe("migration 026 — projects.archived_at", () => {
  const MIGRATION_NAME = "026_projects_archived_at";

  it("does not re-add the column when the table already has it", () => {
    const db = createTestDb();
    expect(columnNames(db, "projects")).toContain("archived_at");
    const before = columnNames(db, "projects").size;

    // Forget that 026 ran, so runMigrations actually executes its body again
    // instead of skipping it by name — the path a hand-patched or
    // hand-rolled-ahead database takes. Without the column-presence guard
    // this is a "duplicate column name" error.
    db.prepare("DELETE FROM _migrations WHERE name = ?").run(MIGRATION_NAME);
    expect(() => runMigrations(db)).not.toThrow();

    expect(columnNames(db, "projects").size).toBe(before);
    const recorded = db
      .prepare("SELECT COUNT(*) AS n FROM _migrations WHERE name = ?")
      .get(MIGRATION_NAME) as { n: number };
    expect(recorded.n).toBe(1);
  });

  it("does nothing on a salvaged database that has no projects table", () => {
    const db = createTestDb();
    // A salvaged database: the table is gone, and nothing will recreate it
    // because 001 is already recorded as applied. DROP TABLE succeeds under
    // foreign_keys=ON here because the database is otherwise empty — SQLite
    // performs an implicit DELETE FROM projects first, which deletes zero
    // rows, so no other table's FK reference is actually violated.
    db.exec("DROP TABLE projects");
    db.prepare("DELETE FROM _migrations WHERE name = ?").run(MIGRATION_NAME);

    expect(() => runMigrations(db)).not.toThrow();
    expect(tableNames(db)).not.toContain("projects");
    db.close();
  });

  it("creates idx_projects_archived_at", () => {
    const db = createTestDb();
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'projects'")
      .all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain("idx_projects_archived_at");
    db.close();
  });
});
