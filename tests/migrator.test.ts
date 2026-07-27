import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, SchemaTooNewError } from "../server/db/migrator.js";
import { initDb } from "../server/db/index.js";
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
