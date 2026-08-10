import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { runMigrations } from "../server/db/migrator.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

interface ColumnRow { name: string; notnull: number; dflt_value: string | null }

describe("migration 019_transcript_ingestion", () => {
  it("adds the source and cache-token columns to cost_entries", () => {
    const cols = db.pragma("table_info(cost_entries)") as ColumnRow[];
    const byName = new Map(cols.map((c) => [c.name, c]));

    expect(byName.has("source")).toBe(true);
    expect(byName.get("source")!.dflt_value).toBe("'mcp'");
    expect(byName.has("external_id")).toBe(true);
    expect(byName.has("cache_creation_5m_tokens")).toBe(true);
    expect(byName.has("cache_creation_1h_tokens")).toBe(true);
  });

  it("enforces uniqueness on external_id but allows many NULLs", () => {
    const insert = db.prepare(
      `INSERT INTO cost_entries (id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
       VALUES (?, 'claude-opus-5', 'anthropic', 1, 1, 0.1, '2026-08-09T00:00:00.000Z', ?, ?)`
    );

    // Many NULL external_ids are fine — that is every pre-existing MCP row.
    insert.run("a", "mcp", null);
    insert.run("b", "mcp", null);

    insert.run("c", "transcript", "uuid-1");
    expect(() => insert.run("d", "transcript", "uuid-1")).toThrow(/UNIQUE/i);
  });

  it("creates project_paths with a unique path", () => {
    db.prepare(`INSERT INTO projects (id, name, description, created_at, updated_at)
                VALUES ('p1', 'demo', NULL, '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z')`).run();
    const insert = db.prepare(
      `INSERT INTO project_paths (id, project_id, path, created_at)
       VALUES (?, 'p1', ?, '2026-08-09T00:00:00.000Z')`
    );
    insert.run("pp1", "c:/users/sgent/projects/demo");
    expect(() => insert.run("pp2", "c:/users/sgent/projects/demo")).toThrow(/UNIQUE/i);
  });

  it("creates transcript_files keyed by path", () => {
    const cols = db.pragma("table_info(transcript_files)") as ColumnRow[];
    expect(cols.map((c) => c.name).sort()).toEqual(
      ["byte_offset", "last_uuid", "mtime", "path", "size", "updated_at"]
    );
  });
});

describe("migration 020_cost_usd_nullable", () => {
  const insert = (db: Database.Database, id: string, cost: number | null): void => {
    db.prepare(
      `INSERT INTO cost_entries (id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
       VALUES (?, 'claude-opus-5', 'anthropic', 10, 20, ?, '2026-08-09T00:00:00.000Z', 'transcript', ?)`
    ).run(id, cost, `ext-${id}`);
  };

  it("accepts NULL cost_usd for an unpriced record", () => {
    expect(() => insert(db, "unpriced", null)).not.toThrow();
    const row = db.prepare(`SELECT cost_usd FROM cost_entries WHERE id = 'unpriced'`).get() as { cost_usd: number | null };
    expect(row.cost_usd).toBeNull();
  });

  it("still stores a real cost when one is supplied", () => {
    insert(db, "priced", 1.5);
    const row = db.prepare(`SELECT cost_usd FROM cost_entries WHERE id = 'priced'`).get() as { cost_usd: number | null };
    expect(row.cost_usd).toBeCloseTo(1.5, 10);
  });

  it("still defaults an omitted cost to 0, so existing writers are unaffected", () => {
    db.prepare(
      `INSERT INTO cost_entries (id, model, provider, created_at)
       VALUES ('defaulted', 'claude-opus-5', 'anthropic', '2026-08-09T00:00:00.000Z')`
    ).run();
    const row = db.prepare(`SELECT cost_usd FROM cost_entries WHERE id = 'defaulted'`).get() as { cost_usd: number };
    expect(row.cost_usd).toBe(0);
  });

  it("keeps the partial unique index on external_id after the rebuild", () => {
    insert(db, "a", 1);
    // Same external_id as row "a" — the index must still reject it.
    expect(() =>
      db.prepare(
        `INSERT INTO cost_entries (id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
         VALUES ('b', 'claude-opus-5', 'anthropic', 1, 1, 1, '2026-08-09T00:00:00.000Z', 'transcript', 'ext-a')`
      ).run()
    ).toThrow(/UNIQUE/i);
  });

  it("preserves the columns migration 019 added", () => {
    const cols = (db.pragma("table_info(cost_entries)") as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      "source", "external_id", "cache_creation_5m_tokens", "cache_creation_1h_tokens",
      "agent_id", "task_id", "milestone_id", "project_id",
    ]));
  });
});

// Migration 020 rebuilds cost_entries, and the rebuild re-validates foreign
// keys that the old table never re-checked. A database that has been through
// manual corruption salvage can hold a row pointing at a parent that is gone,
// and before the dangling-reference cleanup that row failed the copy, rolled
// the migration back, and left the database permanently unopenable.
describe("migration 020 against a salvaged pre-019 database", () => {
  const MIGRATIONS_BEFORE_019 = [
    "001_initial_schema", "002_tasks_columns", "003_agents_columns",
    "004_sprints_to_milestones", "005_ingestion_and_git_sync", "006_users",
    "007_agents_name_normalized", "008_agents_dedup_normalized", "009_activity_source",
    "010_drop_saved_filters", "011_drop_project_templates", "012_drop_agent_file_locks",
    "013_drop_alert_rules", "014_commits_and_milestone_history",
    "015_drop_orphan_tables_and_recurrence_column", "016_agent_current_status",
    "017_drop_tags", "018_drop_comments_notifications",
  ];

  const TS = "2026-08-09T00:00:00.000Z";

  /**
   * The subset of the pre-019 schema that migrations 019 and 020 touch, with
   * 001-018 recorded as already run so runMigrations picks up at 019. Only the
   * parent tables the cost_entries foreign keys name are needed.
   */
  function createPre019Db(): Database.Database {
    const fresh = new Database(":memory:");
    fresh.pragma("foreign_keys = ON"); // Exactly what schema.ts does before migrating.
    fresh.exec(`
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, run_at TEXT NOT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE milestones (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE agents (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE cost_entries (
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
    `);
    const record = fresh.prepare("INSERT INTO _migrations (name, run_at) VALUES (?, ?)");
    for (const name of MIGRATIONS_BEFORE_019) record.run(name, TS);
    return fresh;
  }

  const insertCost = (target: Database.Database, id: string, agentId: string | null): void => {
    target.prepare(
      `INSERT INTO cost_entries
         (id, agent_id, task_id, milestone_id, project_id, model, provider,
          input_tokens, output_tokens, cost_usd, created_at)
       VALUES (?, ?, NULL, NULL, NULL, 'claude-opus-5', 'anthropic', 10, 20, 1.25, ?)`
    ).run(id, agentId, TS);
  };

  let legacy: Database.Database;

  beforeEach(() => {
    legacy = createPre019Db();
    // Foreign keys off is how the orphan gets there in the first place: manual
    // salvage of a corrupt database, which is exactly the history this owner's
    // database has.
    legacy.pragma("foreign_keys = OFF");
    insertCost(legacy, "salvaged", "agent-that-no-longer-exists");
    legacy.pragma("foreign_keys = ON");
  });

  it("completes rather than bricking the database", () => {
    expect(() => runMigrations(legacy)).not.toThrow();
    const applied = legacy
      .prepare("SELECT name FROM _migrations WHERE name IN ('019_transcript_ingestion', '020_cost_usd_nullable')")
      .all() as { name: string }[];
    expect(applied).toHaveLength(2);
  });

  it("keeps the row and its money, dropping only the broken reference", () => {
    runMigrations(legacy);
    const row = legacy
      .prepare("SELECT agent_id, cost_usd, input_tokens FROM cost_entries WHERE id = 'salvaged'")
      .get() as { agent_id: string | null; cost_usd: number; input_tokens: number };

    expect(row).toBeDefined();
    expect(row.cost_usd).toBeCloseTo(1.25, 10);
    expect(row.input_tokens).toBe(10);
    expect(row.agent_id).toBeNull();
  });

  it("leaves a reference that still resolves alone", () => {
    legacy.prepare("INSERT INTO agents (id, name, created_at, updated_at) VALUES ('real', 'real-agent', ?, ?)").run(TS, TS);
    insertCost(legacy, "healthy", "real");

    runMigrations(legacy);

    const row = legacy.prepare("SELECT agent_id FROM cost_entries WHERE id = 'healthy'").get() as { agent_id: string | null };
    expect(row.agent_id).toBe("real");
  });
});
