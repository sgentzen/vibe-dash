import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../server/db/migrator.js";
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
      "task_comments",
      "notifications",
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
    expect([...tableNames(db)].sort()).toEqual([...tablesBefore].sort());
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
